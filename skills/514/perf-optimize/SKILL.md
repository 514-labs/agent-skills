---
name: 514-perf-optimize
argument-hint: "[project-slug]"
allowed-tools:
  - Bash
  - Read
  - Edit
  - Write
  - Glob
  - Grep
  - AskUserQuestion
description: >
  Guided ClickHouse performance optimization workflow.
  Profiles a 514/Moose deployment, identifies slow queries,
  applies optimizations, verifies improvements via active benchmarking
  across paired preview deployments with matched seed data, and ships a PR.
---

# ClickHouse Performance Optimization

Run through five stages sequentially: **SETUP → PROFILE → OPTIMIZE → VERIFY → SHIP**.
Complete each stage fully before moving to the next. Use conversation context as state—no external persistence needed.

If the user provided a project slug as an argument, use it to skip the project selection prompt in Stage 1.

## Command safety

Commands fall into two categories:

**Guardrailed (run freely):** `514 agent auth whoami`, `514 agent project list`, `514 agent deployment list`, `514 agent table list`, `514 agent materialized-view list`, `514 agent sql-resource list`, `514 agent metrics query`, `514 logs query`

**Raw ClickHouse (require user approval):** Any `514 clickhouse query` invocation — including `SHOW CREATE TABLE`, `system.parts` queries, `EXPLAIN`, benchmark query replay, and `INSERT INTO` for re-seeding.

Before running any `514 clickhouse query` command, use AskUserQuestion to show the user the exact SQL and get explicit approval.

---

## Stage 1 — SETUP

Goal: Authenticate, identify the target project, find the active deployment, and capture baseline DDL.

1. Verify authentication:
   ```
   514 agent auth whoami --json
   ```
   If this fails, stop and tell the user to run `514 auth login` first.

2. List available projects:
   ```
   514 agent project list --json
   ```
   If the user provided a project slug as an argument, match it from the list.
   Otherwise, ask the user which project to optimize using AskUserQuestion.

3. List deployments for the selected project:
   ```
   514 agent deployment list --project <PROJECT> --json
   ```
   `<PROJECT>` is `<ORG/PROJECT>` format (e.g., `acme/analytics`).

   Identify the **active production deployment** (highest priority: status "active" or "running").
   Capture both the **deployment ID** (for resource listing commands) and the **branch name** (for metrics/clickhouse/logs commands).

4. List tables to discover the full set:
   ```
   514 agent table list <DEPLOY_ID> --project <PROJECT> --json
   ```

5. Capture CREATE TABLE DDL for each table. **Prompt the user first** — show the list of tables and the SHOW CREATE TABLE statements you intend to run, then get approval:
   ```
   514 clickhouse query 'SHOW CREATE TABLE <DB>.<TABLE>' --project <PROJECT> --branch <BRANCH> --json
   ```
   Store the DDL as `BASELINE_DDL` — this is needed for schema comparison in Stage 4.

6. Summarize what was found (user, org, project, deployment ID, branch, tables) and confirm before proceeding.

---

## Stage 2 — PROFILE

Goal: Collect schema, query, and storage data. Extract a benchmark query set. Produce an optimization plan that flags re-seed impacts.

### 2a. Fetch schema metadata

```
514 agent table list <DEPLOY_ID> --project <PROJECT> --json
514 agent materialized-view list <DEPLOY_ID> --project <PROJECT> --json
514 agent sql-resource list <DEPLOY_ID> --project <PROJECT> --json
```

### 2b. Collect slow queries (guardrailed)

```
514 agent metrics query --project <PROJECT> --branch <BRANCH> --duration-min 100 --sort-by query_duration_ms --sort-dir desc --limit 10 --json
```

### 2c. Collect storage and column diagnostics (raw — prompt user)

Batch these together and **prompt the user once** showing all diagnostic SQL before running:

**Part sizes** — storage footprint per table and partition:
```
514 clickhouse query 'SELECT database, table, partition, sum(rows) AS total_rows, formatReadableSize(sum(bytes_on_disk)) AS disk_size, count() AS part_count FROM system.parts WHERE active = 1 AND database NOT IN ('\''system'\'', '\''INFORMATION_SCHEMA'\'', '\''information_schema'\'') GROUP BY database, table, partition ORDER BY sum(bytes_on_disk) DESC LIMIT 20' --project <PROJECT> --branch <BRANCH> --json
```

**Column cardinality** — candidates for `LowCardinality`:
```
514 clickhouse query 'SELECT database, table, name AS column, type FROM system.columns WHERE database NOT IN ('\''system'\'', '\''INFORMATION_SCHEMA'\'', '\''information_schema'\'') AND type LIKE '\''%String%'\'' ORDER BY database, table, name' --project <PROJECT> --branch <BRANCH> --json
```

### 2d. Extract benchmark query set

From the `514 agent metrics query` output (step 2b), extract the SQL text of the top 5–10 slow queries. Deduplicate by query template (ignore literal differences). Store as `BENCHMARK_QUERIES`.

For each benchmark query, note which tables it reads from. This determines which tables must remain sample-size matched across the baseline and experiment preview branches later.

### 2e. Capture production EXPLAIN plans for context (raw — prompt user)

**Prompt the user once** showing all EXPLAIN queries before executing:
```
514 clickhouse query 'EXPLAIN indexes = 1 <QUERY_SQL>' --project <PROJECT> --branch <BRANCH> --json
```

Run one per benchmark query. Store results as `PRODUCTION_EXPLAINS`. These are for production context only; the final validation comparison happens between the baseline and experiment preview branches in Stage 4.

### 2f. Capture production benchmark metrics for context (raw — prompt user)

**Prompt the user** showing the benchmark query set and explain that each will be run 3× on production (1 warmup + 2 timed) via `514 clickhouse query`.

For each benchmark query:
1. Warmup: run once via `514 clickhouse query` (discard timing)
2. Timed: run 2× via `514 clickhouse query`

Then collect results via the guardrailed metrics command:
```
514 agent metrics query --project <PROJECT> --branch <BRANCH> --search "<query_pattern>" --sort-by query_duration_ms --sort-dir desc --limit 10 --json
```

Store as `PRODUCTION_METRICS`. These are useful for prioritization, but the final benchmark comparison happens between the baseline and experiment preview branches in Stage 4.

### 2g. Analyze against best practices

Read the rules in `skills/clickhouse/best-practices/rules/` (or `AGENTS.md` for the compiled guide) and evaluate each applicable rule against the collected schema and metrics data. Pay particular attention to rules tagged with schema design and query optimization.

Also read the local Moose data model files (typically under `app/` or `datamodels/`) to understand how the schema maps to application code. Use Glob and Read.

### 2h. Present optimization plan

Present findings to the user as a numbered optimization plan using AskUserQuestion. For each proposed change include:

- Expected impact (high/medium/low)
- **Re-seed category** — flag which changes will cause tables to lose seeded data on preview:
  - **Type-only** (e.g., String → LowCardinality): ALTER COLUMN, data preserved
  - **ORDER BY / engine changes**: table recreated, seeded data lost → manual re-seed needed
  - **New MVs**: only populate from new inserts, need manual backfill
- Any risks or caveats

Let the user accept, modify, or reject items.

---

## Stage 3 — OPTIMIZE

Goal: Create matched baseline and experiment preview branches from the same starting point, apply approved code changes only to the experiment branch, validate DDL locally, and ensure both preview databases retain equivalent sample sizes for Stage 4.

### 3a. Create paired preview branches from the same starting point

1. Record the unchanged starting commit so both preview branches fork from the same point:
   ```bash
   BASE_COMMIT=$(git rev-parse HEAD)
   ```

2. Create the baseline preview branch and push it unchanged:
   ```bash
   git checkout -b perf/optimize-clickhouse-baseline
   git push -u origin perf/optimize-clickhouse-baseline
   ```

3. Return to the same starting commit, create the experiment branch, and push it unchanged:
   ```bash
   git checkout "$BASE_COMMIT"
   git checkout -b perf/optimize-clickhouse-experiment
   git push -u origin perf/optimize-clickhouse-experiment
   ```

4. Wait for both preview deployments to appear:
   ```
   514 agent deployment list --project <PROJECT> --json
   ```
   Poll a few times if needed. Identify the baseline preview branch and deployment (`<BASELINE_PREVIEW_BRANCH>`, `<BASELINE_PREVIEW_DEPLOY_ID>`) and the experiment preview branch and deployment (`<EXPERIMENT_PREVIEW_BRANCH>`, `<EXPERIMENT_PREVIEW_DEPLOY_ID>`). Do not apply any code changes to the baseline branch after this point; it is the control preview.

### 3b. Apply approved changes only on the experiment branch and validate them locally

1. Make sure you are on the experiment branch locally:
   ```bash
   git checkout perf/optimize-clickhouse-experiment
   ```

2. Apply the approved optimizations by editing the Moose data model files, SQL resources, or materialized view definitions. Use Edit for each change.

3. Before committing or pushing the changed code, run Moose locally from the Moose app directory:
   ```bash
   moose dev --timestamps
   ```
   Keep this process running while you validate the local infrastructure.

4. Wait for the initial `moose dev` startup sequence to complete successfully. Treat the validation as failed if any compile, schema sync, ClickHouse, or DDL errors appear in the output. `moose check` and `moose build` are not sufficient here because they do not prove that local ClickHouse accepted the DDL.

5. Verify that the changed infrastructure objects exist locally:
   ```bash
   moose ls --type tables --json
   moose ls --type sql_resource --json
   ```

6. For each table whose DDL changed, confirm that local ClickHouse accepted the definition:
   ```bash
   moose query "SHOW CREATE TABLE <CHANGED_TABLE>"
   ```
   If any `SHOW CREATE TABLE` command fails, or the returned DDL does not match the intended change, stop and fix the local schema before continuing.

7. Stop `moose dev` after the local validation passes.

8. After the local DDL validation passes, stage and commit the experiment branch:
   ```bash
   git add -A
   git commit -m "perf: optimize ClickHouse schema based on profiling analysis"
   ```

9. Push the updated experiment branch code:
   ```bash
   git push
   ```

10. Wait for the latest preview deployment for `<EXPERIMENT_PREVIEW_BRANCH>` to appear:
   ```
   514 agent deployment list --project <PROJECT> --json
   ```
   Poll a few times if needed. Identify the latest experiment preview deployment ID for the branch before continuing.

### 3c. Verify that both preview branches still have comparable data (raw — prompt user)

After the updated experiment preview deployment completes Phase 2 (branch code deployed, migrations run), check row counts on both branches. **Prompt the user** with both diagnostic SQL statements before running:

```
514 clickhouse query 'SELECT table, sum(rows) AS total_rows FROM system.parts WHERE active = 1 AND database NOT IN ('\''system'\'','\''INFORMATION_SCHEMA'\'','\''information_schema'\'') GROUP BY table' --project <PROJECT> --branch <BASELINE_PREVIEW_BRANCH> --json
514 clickhouse query 'SELECT table, sum(rows) AS total_rows FROM system.parts WHERE active = 1 AND database NOT IN ('\''system'\'','\''INFORMATION_SCHEMA'\'','\''information_schema'\'') GROUP BY table' --project <PROJECT> --branch <EXPERIMENT_PREVIEW_BRANCH> --json
```

### 3d. Re-seed experiment tables from the baseline preview when needed (raw — prompt user)

For tables identified in Stage 2h as needing re-seed (ORDER BY or engine changes that cause table recreation), keep the baseline preview unchanged and copy the seed data from the baseline preview database into the experiment preview database.

**Prompt the user showing each INSERT statement and explain why re-seeding is needed** — the table was recreated on the experiment branch, so the experiment preview lost data and must be re-aligned with the unchanged baseline preview. This is the highest-risk raw query in the workflow; be explicit about what will happen.

```
514 clickhouse query 'INSERT INTO <EXPERIMENT_DB>.<TABLE> SELECT * FROM <BASELINE_DB>.<TABLE> LIMIT 10000' --project <PROJECT> --branch <EXPERIMENT_PREVIEW_BRANCH> --json
```

This works because the paired preview databases share the same ClickHouse cluster, allowing cross-database copy from the baseline preview into the experiment preview.

If column types changed between branches, compare `system.columns` between the baseline and experiment databases and construct an explicit column list with CAST expressions. **Show the user the cast mapping** before executing.

### 3e. Wait for background merges

After re-seeding, poll part counts on both preview branches to confirm data has settled before benchmarking:
```
514 clickhouse query 'SELECT table, count() AS parts FROM system.parts WHERE active = 1 AND database NOT IN ('\''system'\'','\''INFORMATION_SCHEMA'\'','\''information_schema'\'') GROUP BY table ORDER BY parts DESC' --project <PROJECT> --branch <BASELINE_PREVIEW_BRANCH> --json
514 clickhouse query 'SELECT table, count() AS parts FROM system.parts WHERE active = 1 AND database NOT IN ('\''system'\'','\''INFORMATION_SCHEMA'\'','\''information_schema'\'') GROUP BY table ORDER BY parts DESC' --project <PROJECT> --branch <EXPERIMENT_PREVIEW_BRANCH> --json
```

**Prompt the user** before running. If part counts are high, wait briefly and re-check.

---

## Stage 4 — VERIFY

Goal: Compare the baseline and experiment preview branches via schema diffs, EXPLAIN plans, storage metrics, and active benchmarking on matched preview datasets.

### 4a. Schema comparison

Capture CREATE TABLE DDL on both preview branches (**prompt user** before each `514 clickhouse query`):
```
514 clickhouse query 'SHOW CREATE TABLE <BASELINE_DB>.<TABLE>' --project <PROJECT> --branch <BASELINE_PREVIEW_BRANCH> --json
514 clickhouse query 'SHOW CREATE TABLE <EXPERIMENT_DB>.<TABLE>' --project <PROJECT> --branch <EXPERIMENT_PREVIEW_BRANCH> --json
```

Compare the experiment DDL against the baseline preview DDL. Use `BASELINE_DDL` from Stage 1 only as a sanity check if the baseline preview unexpectedly differs from production main. Document:
- ORDER BY key changes
- Column type changes (e.g., String → LowCardinality)
- New or removed indexes
- Engine changes
- New materialized views

### 4b. Storage comparison (raw — prompt user)

Run the same `system.parts` query on both preview branches, **prompt user** first:
```
514 clickhouse query 'SELECT database, table, sum(rows) AS total_rows, formatReadableSize(sum(bytes_on_disk)) AS disk_size, sum(bytes_on_disk) / greatest(sum(rows), 1) AS bytes_per_row, count() AS part_count FROM system.parts WHERE active = 1 AND database NOT IN ('\''system'\'','\''INFORMATION_SCHEMA'\'','\''information_schema'\'') GROUP BY database, table ORDER BY sum(bytes_on_disk) DESC' --project <PROJECT> --branch <BASELINE_PREVIEW_BRANCH> --json
514 clickhouse query 'SELECT database, table, sum(rows) AS total_rows, formatReadableSize(sum(bytes_on_disk)) AS disk_size, sum(bytes_on_disk) / greatest(sum(rows), 1) AS bytes_per_row, count() AS part_count FROM system.parts WHERE active = 1 AND database NOT IN ('\''system'\'','\''INFORMATION_SCHEMA'\'','\''information_schema'\'') GROUP BY database, table ORDER BY sum(bytes_on_disk) DESC' --project <PROJECT> --branch <EXPERIMENT_PREVIEW_BRANCH> --json
```

Because both previews were seeded from the same starting point, direct branch-to-branch comparisons are meaningful. Use bytes-per-row and part counts to explain any remaining differences.

### 4c. EXPLAIN comparison (primary structural evidence)

**Prompt user** before running EXPLAIN queries on both preview branches. For each benchmark query:
```
514 clickhouse query 'EXPLAIN indexes = 1 <QUERY_SQL>' --project <PROJECT> --branch <BASELINE_PREVIEW_BRANCH> --json
514 clickhouse query 'EXPLAIN indexes = 1 <QUERY_SQL>' --project <PROJECT> --branch <EXPERIMENT_PREVIEW_BRANCH> --json
```

Compare the experiment preview against the baseline preview. Look for:
- **Primary index usage**: Key Condition where there was none before
- **Granule reduction**: fewer `selected_granules` / `total_granules`
- **Skipping index hits**: new index conditions active

EXPLAIN diffs are the most reliable structural signal because both branches are running against matched preview seeds.

### 4d. Active benchmark via replay + metrics

This is the core verification step. **Prompt the user once** showing the full benchmark plan (queries to replay, number of runs) before executing.

1. **Warm caches on both branches** — run each benchmark query once on the baseline preview and once on the experiment preview via `514 clickhouse query` (discard results)
2. **Timed runs on both branches** — run each benchmark query 2–3× on each branch via `514 clickhouse query`, alternating branch order to reduce cache drift
3. **Collect via guardrailed metrics for both branches**:
   ```
   514 agent metrics query --project <PROJECT> --branch <BASELINE_PREVIEW_BRANCH> --search "<query_pattern>" --sort-by query_duration_ms --sort-dir desc --limit 10 --json
   514 agent metrics query --project <PROJECT> --branch <EXPERIMENT_PREVIEW_BRANCH> --search "<query_pattern>" --sort-by query_duration_ms --sort-dir desc --limit 10 --json
   ```
4. **Compare baseline preview metrics against experiment preview metrics**

### 4e. Comparison report

Build a per-query before/after comparison table covering:

| Metric | Baseline Preview | Experiment Preview | Change |
|--------|-----------------|---------|--------|
| EXPLAIN: index condition | (none) | Key Condition: ... | ✓ new |
| EXPLAIN: selected granules | N | M | −X% |
| Duration (ms) | A | B | −Y% |
| Memory usage | C | D | −Z% |
| Rows read | E | F | −W% |

Include a caveat: both preview branches were seeded from the same starting point, so branch-to-branch duration and rows-read comparisons are sample-size matched. The previews still represent preview-scale data rather than full production volume, so absolute timing will differ from production even when the relative branch comparison is valid.

### 4f. Regression check

If any metric regressed, ask the user how to proceed using AskUserQuestion:
- Option A: Fix the issues and re-push
- Option B: Revert specific changes
- Option C: Accept and continue to ship

---

## Stage 5 — SHIP

Goal: Create a pull request with comprehensive performance evidence.

1. Build a PR body that includes:
   - Summary of optimizations applied
   - EXPLAIN diffs per benchmark query (before/after)
   - Metrics comparison table from Stage 4e
   - Before/after schema comparison
   - Note that the baseline and experiment previews were seeded from the same starting point, and how to interpret preview-scale results
   - Tables that were manually re-seeded from the baseline preview and why
   - Any caveats or follow-up items
   - Recommendations for monitoring post-merge (which queries to watch, expected improvements)

2. Create the PR:
   ```bash
   gh pr create \
     --title "perf: ClickHouse schema optimizations" \
     --body "<generated PR body>"
   ```

3. Report the PR URL to the user. Done.
