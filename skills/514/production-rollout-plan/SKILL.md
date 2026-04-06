---
name: 514-production-rollout-plan
argument-hint: "[project-slug]"
allowed-tools:
  - Bash
  - Read
  - Glob
  - Grep
  - AskUserQuestion
description: >
  Use when a developer has a chosen schema, model, or query change in a
  514/Moose project and needs a safe path to production, including rollout
  classification, validation steps, rollback guidance, backfill expectations,
  cutover planning, and explicit approval gates.
---

# Production Rollout Planning

Run through three stages sequentially: **SETUP -> MIGRATION PLANNING -> REVIEW AND SHIP**.

If the user provided a project slug as an argument, use it to skip the project selection prompt in Stage 1.

## Command safety

Commands fall into three categories:

**Guardrailed read-only:** `514 agent auth whoami`, `514 agent project list`, `514 agent deployment list`, `514 agent table list`, `514 agent materialized-view list`, `514 agent sql-resource list`, `514 deployment list`, `514 env list`, `514 env get`, `git branch --show-current`, `git status --short`, `git diff --name-only`, `gh pr view`, `moose ls`

**Raw ClickHouse (require user approval):** Any `514 clickhouse query` invocation used to inspect current production state or define validation SQL.

Before running any `514 clickhouse query` command, use AskUserQuestion to show the user the exact command or SQL and get explicit approval.

---

## Stage 1 — SETUP

Goal: Identify the project, exact target deployment, local change context, and remote Moose auth readiness before migration planning.

1. Verify authentication:

   ```
   514 agent auth whoami --json
   ```

2. Resolve the target project:

   ```
   514 agent project list --json
   ```

3. Capture the branch and change context:

   ```bash
   git branch --show-current
   git status --short
   git diff --name-only
   ```

4. Resolve the target branch before looking up deployments.

   First, check whether the current branch has an open pull request:

   ```bash
   gh pr view --json baseRefName --jq '.baseRefName' 2>/dev/null
   ```

   - If a PR exists, use its base branch as the target (e.g., `perf/baseline`, `main`).
   - If no PR exists, fall back to `main`.
   - Use AskUserQuestion to confirm the resolved target branch with the user before proceeding.

5. Resolve the exact target deployment before touching auth or migration generation:

   ```bash
   514 deployment list --project <PROJECT> --json
   ```

   Choose the target deployment with these rules:
   - choose the latest deployment where `branch = <TARGET_BRANCH>` and `status = "Deployed"`
   - if none qualify, or "latest" cannot be determined unambiguously from the returned deployment data, stop and carry a blocker instead of guessing

   Capture:
   - `TARGET_DEPLOY_ID`
   - `TARGET_DEPLOY_BRANCH`
   - `TARGET_DEPLOY_URL`

---

## Stage 2 — MIGRATION PLANNING

Goal: Generate the migration plan against the target deployment, review the generated artifacts, classify rollout risk, and produce the rollout plan.

### Gather migration artifacts

1. Confirm that migration artifacts exist in `migrations/`:

   | File | Purpose |
   |------|---------|
   | `migrations/plan.yaml` | Ordered list of migration operations to execute |
   | `migrations/remote_state.json` | Snapshot of the target deployment's database schema at generation time |
   | `migrations/local_infra_map.json` | Snapshot of local code schema definitions |

   If any artifact is missing, stop and carry a blocker.

### Analyze operations

Operation type reference (see `.moose/migration_schema.json` for full schema):

| Category | Operation | Effect |
|----------|-----------|--------|
| Additive | `CreateTable` | New table with columns, order_by, engine |
| Additive | `AddTableColumn` | New column on existing table |
| Additive | `RenameTableColumn` | Column rename, data preserved |
| Additive | `AddTableIndex` | New data-skipping index on existing table |
| Additive | `AddTableProjection` | New projection for alternative data ordering |
| Additive | `CreateMaterializedView` | New MV with SELECT and target table |
| Additive | `CreateView` | New user-defined SELECT view |
| Destructive | `DropTable` | Permanently removes table and all data |
| Destructive | `DropTableColumn` | Removes column from table |
| Destructive | `DropTableIndex` | Removes data-skipping index |
| Destructive | `DropTableProjection` | Removes projection from table |
| Destructive | `DropMaterializedView` | Removes materialized view |
| Destructive | `DropView` | Removes user-defined view |
| Destructive | `ModifyTableColumn` | Changes column type/properties (see safe-widening rules below) |
| Metadata | `ModifyTableSettings` | Changes table-level settings (e.g., index_granularity) |
| Metadata | `ModifySampleBy` | Changes SAMPLE BY expression |
| Metadata | `RemoveSampleBy` | Removes SAMPLE BY from table |
| Metadata | `ModifyTableTtl` | Changes or removes table-level TTL |
| Custom | `RawSql` | Arbitrary SQL array with description |

`ModifyTableColumn` safe-widening rules:

Not all `ModifyTableColumn` operations are destructive. Classify each by comparing `before_column` and `after_column`:

| Change | Classification | Reason |
|--------|---------------|--------|
| `String` → `LowCardinality(String)` | Safe | Dictionary encoding wrapper, no data loss |
| `IntN` → wider `IntM` (e.g., `Int32` → `Int64`) | Safe | Wider numeric range, existing values preserved |
| `T` → `Nullable(T)` | Safe | Adds NULL support, existing non-NULL values preserved |
| `FloatN` → wider `FloatM` (e.g., `Float32` → `Float64`) | Safe | Greater precision, existing values preserved |
| Adding or changing `annotations` only (same base type) | Safe | Metadata-only change |
| `LowCardinality(String)` → `String` | Safe | Removes dictionary encoding, data preserved |
| Narrowing numeric (e.g., `Int64` → `Int32`) | Destructive | Values outside target range are truncated |
| `Nullable(T)` → `T` | Destructive | NULL values become default, potential data loss |
| Type family change (e.g., `String` → `Int64`) | Destructive | Incompatible conversion, potential data loss |

When classifying the overall plan, safe-widening `ModifyTableColumn` operations count as **additive**, not destructive.

3. Read `migrations/plan.yaml` and scan each operation in a single pass. For each operation:

   **Verify intent:** Confirm the affected table and column names match the code diff from Stage 1. If a destructive operation is unexpected, use AskUserQuestion to present it and get explicit approval.

   **Classify:** Tag each operation as additive, destructive, or custom. The overall plan is additive if all operations are additive, destructive if any are destructive, mixed if both.

   **Detect patterns:**

   - **`DropTable` + `CreateTable` for the same table name** = versioned-table upgrade. The generated plan is unsafe as-is because the Drop destroys data before the Create can receive a backfill. Rewrite the plan to the rename-backfill-drop pattern:

     1. Replace the `DropTable` with a `RawSql` that renames the old table:
        ```yaml
        - RawSql:
            description: Rename old <TABLE> to preserve data for backfill
            sql:
            - "RENAME TABLE <TABLE> TO <TABLE>_old"
        ```
     2. Keep the `CreateTable` as generated (it creates the new schema under the original name).
     3. Insert a `RawSql` backfill that copies data from the renamed old table to the new table. For each column, compare the old schema (from `remote_state.json`) against the new `CreateTable` DDL:
        - If type or annotations changed (e.g., `String` → `LowCardinality(String)`), wrap in `CAST(col, 'NewClickHouseType')`.
        - If unchanged, pass through by column name.
        Present the generated INSERT to the user for approval.
        ```yaml
        - RawSql:
            description: Backfill new <TABLE> from renamed old table
            sql:
            - "INSERT INTO <TABLE> SELECT <col_list_with_casts> FROM <TABLE>_old"
        ```
     4. Insert a `RawSql` that drops the renamed old table after backfill:
        ```yaml
        - RawSql:
            description: Drop old renamed <TABLE> after backfill
            sql:
            - "DROP TABLE IF EXISTS <TABLE>_old"
        ```

   - **`ModifyTableColumn` with a narrowing type change** = potential data loss. Flag for backfill.
   - **`RawSql` with backfill intent** = confirm the SQL is safe and the description is clear.

   **Check ordering:**
   - `CreateTable` (new version) must precede any `RawSql` backfill that populates it
   - `RawSql` backfill must precede any `DropTable` that destroys its source data
   - `AddTableColumn` must precede any `RawSql` that references the new column
   - `ModifyTableColumn` must not follow a `DropTableColumn` on the same table if it depends on the dropped column

   **Check dependencies:** For any destructive operation (`DropTable`, `DropTableColumn`, `ModifyTableColumn`), use AskUserQuestion to ask whether the user knows of applications, materialized views, or downstream consumers that depend on the affected table or column. Carry dependencies forward as blockers.

   If the plan needs edits (reordering, injecting a `RawSql` backfill, replacing a drop+add with `RenameTableColumn`), recommend the specific edit and confirm with the user before modifying `plan.yaml`.

   **`RawSql` schema contract:** When injecting `RawSql` operations, the `sql` field must be an **array of strings**, not a single string. This is defined in `.moose/migration_schema.json`. The `RawSql` operation has exactly two required fields: `sql` (array) and `description` (string). Do not add `cluster_name`, `database`, or other fields that belong to other operation types.

   **Post-edit validation:** After any manual edits to `plan.yaml`, read `.moose/migration_schema.json` and verify the edited plan conforms. Check that:
   - Every `RawSql.sql` is an array of strings
   - Every operation matches one of the `oneOf` variants in the schema
   - All required fields are present for each operation type
   - No extra fields are added that the schema does not define for that operation

   If validation fails, fix the plan before proceeding.

4. Verify `migrations/remote_state.json` was captured against the correct target deployment. If it does not match the target from Stage 1, stop and carry a blocker.

5. Record:
   - `change_type` (additive, destructive, or mixed)
   - which operations are reversible (additive) and which are not (`DropTable`, `DropTableColumn` = permanent data loss; `ModifyTableColumn` narrowing = potential data loss)
   - whether backfill is required, for which tables, and the backfill SQL or strategy
   - whether any versioned-table upgrades were detected
   - whether auth bootstrap was required
   - any plan edits made
   - cleanup: old tables, columns, or resources to remove after stabilization
   - unknowns — call out explicitly rather than collapsing into a default

---

## Stage 3 — REVIEW AND SHIP

Goal: Present the migration plan for approval. If approved, commit the migration artifacts and create a pull request.

1. Use AskUserQuestion to present the rollout plan and explicitly review:
   - the `migrations/plan.yaml` operations and whether the classification matches the intended change
   - any destructive operations and their justification
   - any manual edits made to `plan.yaml`
   - blockers
   - rollback realism
   - any missing validation evidence

   Revise the plan until the user approves it or provides a new constraint.

2. Once approved, commit the migration artifacts:

   ```bash
   git add migrations/plan.yaml migrations/remote_state.json migrations/local_infra_map.json
   git commit -m "<descriptive commit message summarizing the migration plan>"
   ```

3. Create a pull request with the migration plan:

   ```bash
   git push -u origin HEAD
   gh pr create --title "<title>" --body "<body>"
   ```

   The PR body should summarize:
   - the change type (additive, destructive, or mixed)
   - affected tables
   - any versioned-table upgrades and backfill steps
   - any dependent consumers flagged during analysis
   - blockers or open questions
