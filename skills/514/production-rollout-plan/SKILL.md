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
  classification, generated migration evidence, validation steps, rollback
  guidance, backfill expectations, cutover planning, and explicit approval
  gates.
---

# Production Rollout Planning

Run through three stages sequentially: **SETUP -> MIGRATION PLANNING -> REVIEW AND SHIP**.

If the user provided a project slug as an argument, use it to skip the project selection prompt in Stage 1.

## Command safety

Commands fall into three categories:

**Guardrailed read-only:** `514 agent auth whoami`, `514 agent project list`, `514 agent deployment list`, `514 agent table list`, `514 agent materialized-view list`, `514 agent sql-resource list`, `514 deployment list`, `514 env list`, `514 env get`, `git branch --show-current`, `git status --short`, `git diff --name-only`, `moose ls`, `moose generate migration`

**Local generation:** `moose generate hash-token`

**Mutating remote target (require user approval):** `514 env set` and any step that intentionally changes credentials on the target environment or requires a redeploy before migration generation can continue.

**Raw ClickHouse (require user approval):** Any `514 clickhouse query` invocation used to inspect current production state or define validation SQL.

Before running `514 env set` or any `514 clickhouse query` command, use AskUserQuestion to show the user the exact command or SQL and get explicit approval.

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

4. Resolve the exact target deployment before touching auth or migration generation:

   ```bash
   514 deployment list --project <PROJECT> --json
   ```

   Choose the target deployment with these rules:
   - choose the latest deployment where `branch = "main"` and `status = "Deployed"`
   - if none qualify, or "latest" cannot be determined unambiguously from the returned deployment data, stop and carry a blocker instead of guessing

   Capture:
   - `TARGET_DEPLOY_ID`
   - `TARGET_DEPLOY_BRANCH`
   - `TARGET_DEPLOY_URL`

5. Resolve how `moose generate migration` will authenticate to the remote Moose Admin API for the chosen target deployment.

   Check whether the remote Moose Admin API is already configured on `TARGET_DEPLOY_BRANCH`:

   ```bash
   514 env get MOOSE_AUTHENTICATION__ADMIN_API_KEY --project <PROJECT> --branch <TARGET_DEPLOY_BRANCH> --json
   ```

   Then use AskUserQuestion to ask whether the user has `MOOSE_ADMIN_TOKEN` or another intentionally stored plain bearer token available from secure local storage or project envs.

   Decision table:

   | Remote hash present? | Bearer token present? | Action                                                  |
   | -------------------- | --------------------- | ------------------------------------------------------- |
   | yes                  | yes                   | proceed to migration generation                         |
   | yes                  | no                    | stop and ask whether to rotate credentials              |
   | no                   | yes                   | stop and ask whether to bootstrap remote Admin API auth |
   | no                   | no                    | stop and ask whether to bootstrap remote Admin API auth |

   Do not assume `514 auth login` credentials can be reused as the Moose admin API bearer token.
   Do not assume a bearer token can be recovered from `MOOSE_AUTHENTICATION__ADMIN_API_KEY`. It cannot.

   Only if the hash is missing and the user explicitly approves auth remediation, use this sequence:
   1. Generate a fresh token pair:

      ```bash
      moose generate hash-token --json
      ```

      Capture:
      - `api_key_hash`
      - `bearer_token`

   2. Set the hashed key on the target environment:

      ```bash
      514 env set --project <PROJECT> --branch <TARGET_DEPLOY_BRANCH> MOOSE_AUTHENTICATION__ADMIN_API_KEY=<api_key_hash>
      ```

   3. Store the plain token securely for the client side as `MOOSE_ADMIN_TOKEN`, or pass it directly as `--token <bearer_token>` to `moose generate migration`.

   4. Wait for or trigger the target branch redeploy using the repo's normal deployment mechanism. Do not assume the new hash is active until the target deployment is healthy again.

   5. Only after the redeploy is healthy, proceed to migration generation.

   If the user does not approve remediation, or the environment cannot be redeployed safely, stop and carry a blocker.

---

## Stage 2 — MIGRATION PLANNING

Goal: Generate the migration plan against the target deployment, review the generated artifacts, classify rollout risk, and produce the rollout plan.

### Generate

1. Generate the migration plan from the current branch state against the resolved remote Moose target:

   ```bash
   moose generate migration --save --url <TARGET_DEPLOY_URL> --token <MOOSE_ADMIN_TOKEN>
   ```

   If `MOOSE_ADMIN_TOKEN` is already set in the local environment, the command may omit `--token`.

   Do not run `moose generate migration` without the remote target flags. The plan is only valid if it was generated against the intended remote production state.

2. Confirm that all three artifacts were written to `migrations/`:

   | File | Purpose |
   |------|---------|
   | `migrations/plan.yaml` | Ordered list of migration operations to execute |
   | `migrations/remote_state.json` | Snapshot of the target deployment's database schema at generation time |
   | `migrations/local_infra_map.json` | Snapshot of local code schema definitions |

   If any artifact is missing, stop and carry a blocker.

### Analyze operations

Operation type reference:

| Category | Operation | Effect |
|----------|-----------|--------|
| Additive | `CreateTable` | New table with columns, order_by, engine |
| Additive | `AddTableColumn` | New column on existing table |
| Additive | `RenameTableColumn` | Column rename, data preserved |
| Destructive | `DropTable` | Permanently removes table and all data |
| Destructive | `DropTableColumn` | Removes column from table |
| Destructive | `ModifyTableColumn` | Changes column type/properties (before/after state) |
| Custom | `RawSql` | Arbitrary SQL with description |

3. Read `migrations/plan.yaml` and scan each operation in a single pass. For each operation:

   **Verify intent:** Confirm the affected table and column names match the code diff from Stage 1. If a destructive operation is unexpected, use AskUserQuestion to present it and get explicit approval.

   **Classify:** Tag each operation as additive, destructive, or custom. The overall plan is additive if all operations are additive, destructive if any are destructive, mixed if both.

   **Detect patterns:**
   - `DropTable` + `CreateTable` for the same table name = versioned-table upgrade. Flag for backfill.
   - `ModifyTableColumn` with a narrowing type change = potential data loss. Flag for backfill.
   - `RawSql` with backfill intent = confirm the SQL is safe and the description is clear.

   **Check ordering:**
   - `CreateTable` (new version) must precede any `RawSql` backfill that populates it
   - `RawSql` backfill must precede any `DropTable` that destroys its source data
   - `AddTableColumn` must precede any `RawSql` that references the new column
   - `ModifyTableColumn` must not follow a `DropTableColumn` on the same table if it depends on the dropped column

   **Check dependencies:** For any destructive operation (`DropTable`, `DropTableColumn`, `ModifyTableColumn`), use AskUserQuestion to ask whether the user knows of applications, materialized views, or downstream consumers that depend on the affected table or column. Carry dependencies forward as blockers.

   If the plan needs edits (reordering, injecting a `RawSql` backfill, replacing a drop+add with `RenameTableColumn`), recommend the specific edit and confirm with the user before modifying `plan.yaml`.

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
