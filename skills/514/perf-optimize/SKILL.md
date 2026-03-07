---
name: perf-optimize
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
  applies optimizations, verifies improvements, and ships a PR.
---

# ClickHouse Performance Optimization

Run through five stages sequentially: **SETUP → PROFILE → OPTIMIZE → VERIFY → SHIP**.
Complete each stage fully before moving to the next. Use conversation context as state—no external persistence needed.

If the user provided a project slug as an argument, use it to skip the project selection prompt in Stage 1.

---

## Stage 1 — SETUP

Goal: Authenticate, identify the target project, and find the active deployment.

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

4. Summarize what was found (user, org, project, deployment ID, branch) and confirm before proceeding.

---

## Stage 2 — PROFILE

Goal: Collect schema and query data, then produce an optimization plan.

1. Fetch the current schema:
   ```
   514 agent table list <DEPLOY_ID> --project <PROJECT> --json
   514 agent materialized-view list <DEPLOY_ID> --project <PROJECT> --json
   514 agent sql-resource list <DEPLOY_ID> --project <PROJECT> --json
   ```

2. Collect baseline runtime metrics. Run each query and save the results in conversation context for comparison in Stage 4:

   **Slow queries** — top 10 by duration:
   ```
   514 agent metrics query --project <PROJECT> --branch <BRANCH> --duration-min 100 --sort-by query_duration_ms --sort-dir desc --limit 10 --json
   ```

   **Part sizes** — storage footprint per table and partition:
   ```
   514 clickhouse query 'SELECT database, table, partition, sum(rows) AS total_rows, formatReadableSize(sum(bytes_on_disk)) AS disk_size, count() AS part_count FROM system.parts WHERE active = 1 AND database NOT IN ('\''system'\'', '\''INFORMATION_SCHEMA'\'', '\''information_schema'\'') GROUP BY database, table, partition ORDER BY sum(bytes_on_disk) DESC LIMIT 20' --project <PROJECT> --branch <BRANCH> --json
   ```

   **Column cardinality** — candidates for `LowCardinality`:
   ```
   514 clickhouse query 'SELECT database, table, name AS column, type FROM system.columns WHERE database NOT IN ('\''system'\'', '\''INFORMATION_SCHEMA'\'', '\''information_schema'\'') AND type LIKE '\''%String%'\'' ORDER BY database, table, name' --project <PROJECT> --branch <BRANCH> --json
   ```

   These metrics feed directly into the analysis below.

3. Analyze the schema, metrics, and queries against the **clickhouse-best-practices** skill.
   Read the rules in `skills/clickhouse/best-practices/rules/` (or `AGENTS.md` for the compiled guide)
   and evaluate each applicable rule against the collected schema and metrics data.
   Pay particular attention to rules tagged with schema design and query optimization.

4. Also read the local Moose data model files (typically under `app/` or `datamodels/`) to understand how the schema maps to application code. Use Glob and Read.

5. Present findings to the user as a numbered optimization plan and ask for approval using AskUserQuestion:
   - List each proposed change with expected impact (high/medium/low)
   - Note any changes that are risky or require careful testing
   - Let the user accept, modify, or reject items

---

## Stage 3 — OPTIMIZE

Goal: Apply the approved code changes and push a branch for preview deployment.

1. Create a feature branch:
   ```bash
   git checkout -b perf/optimize-clickhouse
   ```

2. Apply the approved optimizations by editing the Moose data model files, SQL resources, or materialized view definitions. Use Edit for each change.

3. After all changes, stage and commit:
   ```bash
   git add -A
   git commit -m "perf: optimize ClickHouse schema based on profiling analysis"
   ```

4. Push the branch to trigger a preview deployment:
   ```bash
   git push -u origin perf/optimize-clickhouse
   ```

5. Wait for the preview deployment to appear:
   ```
   514 agent deployment list --project <PROJECT> --json
   ```
   Poll a few times if needed. Identify the new preview deployment ID and its branch name (`<PREVIEW_BRANCH>`).

---

## Stage 4 — VERIFY

Goal: Compare before/after metrics on the preview deployment.

1. Fetch the preview schema:
   ```
   514 agent table list <PREVIEW_DEPLOY_ID> --project <PROJECT> --json
   ```

2. Re-run the same metrics queries from Stage 2 against the preview deployment:

   **Slow queries:**
   ```
   514 agent metrics query --project <PROJECT> --branch <PREVIEW_BRANCH> --duration-min 100 --sort-by query_duration_ms --sort-dir desc --limit 10 --json
   ```

   **Part sizes:**
   ```
   514 clickhouse query 'SELECT database, table, partition, sum(rows) AS total_rows, formatReadableSize(sum(bytes_on_disk)) AS disk_size, count() AS part_count FROM system.parts WHERE active = 1 AND database NOT IN ('\''system'\'', '\''INFORMATION_SCHEMA'\'', '\''information_schema'\'') GROUP BY database, table, partition ORDER BY sum(bytes_on_disk) DESC LIMIT 20' --project <PROJECT> --branch <PREVIEW_BRANCH> --json
   ```

   **Column cardinality:**
   ```
   514 clickhouse query 'SELECT database, table, name AS column, type FROM system.columns WHERE database NOT IN ('\''system'\'', '\''INFORMATION_SCHEMA'\'', '\''information_schema'\'') AND type LIKE '\''%String%'\'' ORDER BY database, table, name' --project <PROJECT> --branch <PREVIEW_BRANCH> --json
   ```

3. Compare the preview results against the Stage 2 baseline. Build a comparison summary covering:
   - **Schema changes**: ORDER BY key changes, new materialized views, column type improvements
   - **Query duration changes**: before → after for the slowest queries
   - **Storage footprint changes**: disk size and part count per table
   - **New slow queries**: any queries that appear in the preview top-10 but not in the baseline

4. If there are regressions or unexpected changes, ask the user how to proceed using AskUserQuestion:
   - Option A: Fix the issues and re-push
   - Option B: Revert specific changes
   - Option C: Accept and continue to ship

---

## Stage 5 — SHIP

Goal: Create a pull request with performance evidence.

1. Build a PR body that includes:
   - Summary of optimizations applied
   - Before/after schema comparison from Stage 4
   - Before/after metrics comparison (query durations, storage footprint) from Stage 4
   - The optimization checklist items that were addressed
   - Any caveats or follow-up items

2. Create the PR:
   ```bash
   gh pr create \
     --title "perf: ClickHouse schema optimizations" \
     --body "<generated PR body>"
   ```

3. Report the PR URL to the user. Done.
