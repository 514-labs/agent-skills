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
  proposes optimization candidates, benchmarks baseline vs candidates
  on preview deployments, and ships the winner as a PR.
---

# ClickHouse Performance Optimization

Run through seven stages sequentially: **SETUP → PROFILE → PROPOSE → BASELINE → EXPERIMENT → COMPARE → SHIP**.
Complete each stage fully before moving to the next. Use conversation context as state—no external persistence needed.

If the user provided a project slug as an argument, use it to skip the project selection prompt in Stage 1.

## Command safety

Commands fall into two categories:

**Guardrailed (run freely):** `514 agent auth whoami`, `514 agent project list`, `514 agent deployment list`, `514 agent table list`, `514 agent materialized-view list`, `514 agent sql-resource list`, `514 agent metrics query`, `514 logs query`, `moose add benchmark`, `moose dev`, `moose ls`, `pnpm test:perf`

**Raw ClickHouse (require user approval):** Any `514 clickhouse query` invocation — including `SHOW CREATE TABLE`, `system.parts` queries, `EXPLAIN`, benchmark query replay, and `INSERT INTO` for re-seeding.

Before running any `514 clickhouse query` command, use AskUserQuestion to show the user the exact SQL and get explicit approval.

## Benchmark contract

The benchmark suite is branch-agnostic. Every branch must expose the same benchmark target interface for the production query pattern being tested.

The benchmark target interface is the code-level representation of the real query or API discovered during profiling. Prefer this order:

- an existing `defineQueryModel` export that already represents the target query shape
- an existing exported SQL template literal or query-builder function
- another codified application query/API entrypoint that faithfully represents the target query shape
- if no codified query/API entrypoint exists, define a query model that matches the discovered production query pattern

Do not invent a synthetic benchmark query disconnected from the production query pattern.

Across baseline and all candidate branches:

- the same query/API entrypoint stays under test
- dimensions, metrics, filters, sortable fields, and defaults stay the same
- the SQL shape and call pattern stay the same apart from the intended optimization
- only the `table` reference changes per candidate branch

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

   Store the DDL as `BASELINE_DDL` — this is needed for schema comparison in Stage 6.

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

For each benchmark query, note which tables it reads from. This determines which tables need data on the preview branch later.

### 2e. Capture baseline EXPLAIN plans (raw — prompt user)

**Prompt the user once** showing all EXPLAIN queries before executing:

```
514 clickhouse query 'EXPLAIN indexes = 1 <QUERY_SQL>' --project <PROJECT> --branch <BRANCH> --json
```

Run one per benchmark query. Store results as `BASELINE_EXPLAINS`.

### 2f. Run baseline benchmarks (raw — prompt user)

**Prompt the user** showing the benchmark query set and explain that each will be run 3× on production (1 warmup + 2 timed) via `514 clickhouse query`.

For each benchmark query:

1. Warmup: run once via `514 clickhouse query` (discard timing)
2. Timed: run 2× via `514 clickhouse query`

Then collect results via the guardrailed metrics command:

```
514 agent metrics query --project <PROJECT> --branch <BRANCH> --search "<query_pattern>" --sort-by query_duration_ms --sort-dir desc --limit 10 --json
```

Store as `BASELINE_METRICS`.

### 2g. Analyze against best practices

Read the rules in `skills/clickhouse/best-practices/rules/` (or `AGENTS.md` for the compiled guide) and evaluate each applicable rule against the collected schema and metrics data. Pay particular attention to rules tagged with schema design and query optimization.

Additionally, explicitly check each slow query for materialized view opportunities:

- **Aggregation pattern:** Does the query contain `GROUP BY` over a table with high `read_rows` (millions+)? If the aggregation uses functions that support `-State`/`-Merge` (`count`, `uniq`, `sum`, `avg`, `min`, `max`, `quantile`), flag as an incremental MV candidate.
- **Join pattern:** Does the query join multiple tables where dimension tables change infrequently? If staleness of a few minutes is acceptable, flag as a refreshable MV candidate.
- **Frequency:** Is the same query template executed many times per hour? High frequency amplifies the benefit of pre-computation.

Consult the `query-mv-when-to-add` rule for the full decision matrix. If a query matches an MV pattern, carry it forward as a candidate alongside schema and index candidates.

### 2h. Map findings back to code

Read the local Moose codebase to connect profiling evidence to the actual source files. This step covers two things:

**Discover data models:** Scan for data model definitions (typically under `app/` or `datamodels/`). For each table surfaced during profiling, locate the model file that defines it.

**Discover query entrypoints:** For each benchmark query from step 2d, find where the query pattern originates in the codebase. Look for one of:

- an existing `defineQueryModel` export that represents the query shape
- an exported SQL template literal or query-builder function
- another codified application query/API entrypoint that faithfully represents the query shape
- if no codified entrypoint exists, note that a query model will need to be created during baseline setup

For each likely improvement, capture:

- affected tables and their model file paths
- query patterns helped and their query entrypoint paths
- likely schema or model change
- whether the change is destructive (ORDER BY / engine change = table recreated, seeded data lost)
- whether the improvement requires creating a new MV + target table (new files, not modifications to existing code; note backfill as a post-deployment action)
- the benchmark target interface to use (see benchmark contract above)

---

## Stage 3 — PROPOSE

Goal: Present optimization candidates for approval.

Use AskUserQuestion to present a numbered optimization plan. For each candidate include:

- candidate name
- expected impact (`high`, `medium`, `low`)
- affected tables
- local query or model paths to change
- re-seed category:
  - **Type-only** (e.g., String → LowCardinality): ALTER COLUMN, data preserved
  - **ORDER BY / engine changes**: table recreated, seeded data lost → manual re-seed needed
  - **New MVs**: only populate from new inserts, need manual backfill
- risks or caveats

Let the user accept, modify, or reject items. Capture the approved candidate set before proceeding.

---

## Stage 4 — BASELINE

Goal: Create the frozen control branch, add benchmark scaffold, ensure comparable seed data, and prove the benchmark runs on baseline.

### 4a. Scaffold the benchmark harness

Run the benchmark scaffold unless it already exists:

```bash
moose add benchmark
```

Do not hand-write benchmark infrastructure when the scaffold exists.

After running the scaffold:

- inspect the generated benchmark files and directories
- identify the scaffold's documented entrypoints, config files, and extension points
- treat generated harness files as read-only unless the scaffold explicitly expects edits
- if the scaffold shape differs from assumptions, adapt to the generated structure

### 4b. Wire the benchmark target interface

Use the benchmark target interface discovered in step 2h. If no codified query entrypoint was found during profiling, define a query model now that matches the discovered production query pattern.

Fill the scaffold's benchmark query definition entrypoint with:

- the correct workspace package import
- the benchmark target interface import identified in step 2h
- the call shape, base filters, and parameters needed to exercise the real query/API under test

### 4c. Create and push the frozen baseline branch

```bash
git checkout -b perf/baseline
git add -A
git commit -m "perf: add benchmark scaffold and target interface"
git push -u origin perf/baseline
```

### 4d. Wait for baseline deployment and resolve the baseline DB

```
514 agent deployment list --project <PROJECT> --json
```

Poll until the baseline deployment appears. Resolve the baseline DB name.

### 4e. Ensure baseline has comparable seed data

Check row counts on the baseline deployment. **Prompt the user** before running:

```
514 clickhouse query 'SELECT table, sum(rows) AS total_rows FROM system.parts WHERE active = 1 AND database NOT IN ('\''system'\'','\''INFORMATION_SCHEMA'\'','\''information_schema'\'') GROUP BY table' --project <PROJECT> --branch perf/baseline --json
```

If tables that the benchmark queries read from have insufficient data, re-seed from production. **Prompt the user** showing each INSERT statement:

```
514 clickhouse query 'INSERT INTO <BASELINE_DB>.<TABLE> SELECT * FROM <PROD_DB>.<TABLE> LIMIT 10000' --project <PROJECT> --branch perf/baseline --json
```

Preview and production share the same ClickHouse cluster — this cross-database pattern is the standard seeding mechanism.

### 4f. Prove the benchmark runs on baseline

Run the benchmark suite against the baseline DB:

```bash
MOOSE_CLICKHOUSE_CONFIG__DB_NAME=<BASELINE_DB> pnpm test:perf
```

Capture the baseline report path under `reports/`. If the benchmark fails, stop and fix before creating candidate branches.

Artifacts from this stage:

- `BASELINE_BRANCH=perf/baseline`
- `BASELINE_DB`
- baseline benchmark report under `reports/`

---

## Stage 5 — EXPERIMENT

Goal: For each approved candidate, implement the optimization, deploy, seed, and benchmark — completing the full candidate lifecycle before moving to comparison.

### Parallelization

Run candidates in parallel when possible. Each candidate should run in its own git worktree so sub-agents can work simultaneously without branch conflicts.

**Coordinator** owns:
- creating worktrees from the frozen baseline
- dispatching one sub-agent per candidate
- collecting results after all sub-agents complete

**Each sub-agent** owns one candidate in its own worktree and returns:
- `candidate_name`
- `candidate_branch`
- `candidate_db`
- `report_path` (absolute path to the benchmark report JSON)
- `status` (`success` or `blocked`)
- `failure_reason` (if blocked)

### Per-candidate workflow

Each sub-agent runs the following steps in its worktree:

1. Branch from baseline:

   ```bash
   git checkout perf/baseline
   git checkout -b perf/candidate-<name>
   ```

2. Apply exactly one optimization strategy by editing the Moose data model files, SQL resources, or materialized view definitions.

3. If the change is destructive (ORDER BY / engine change), rely on Moose versioned-table behavior.

4. Update the benchmark target interface so only the minimal target change is introduced — usually the `table` reference that points at the versioned or optimized table.

5. Validate locally:

   ```bash
   moose dev --timestamps
   ```

6. Commit and push:

   ```bash
   git add -A
   git commit -m "perf: candidate <name>"
   git push -u origin perf/candidate-<name>
   ```

7. Wait for the candidate deployment and resolve the candidate DB name.

8. Check row counts and re-seed if needed, using the same approach as Stage 4e. For tables that lost data due to destructive changes, re-seed from production.

   If column types changed between baseline and candidate, compare `system.columns` between the two databases and construct an explicit column list with CAST expressions. **Show the user the cast mapping** before executing.

9. After re-seeding, poll part counts to confirm data has settled:

   ```
   514 clickhouse query 'SELECT table, count() AS parts FROM system.parts WHERE active = 1 AND database NOT IN ('\''system'\'','\''INFORMATION_SCHEMA'\'','\''information_schema'\'') GROUP BY table ORDER BY parts DESC' --project <PROJECT> --branch perf/candidate-<name> --json
   ```

   **Prompt the user** before running. If part counts are high, wait briefly and re-check.

10. Run the benchmark suite against the candidate DB:

    ```bash
    MOOSE_CLICKHOUSE_CONFIG__DB_NAME=<CANDIDATE_DB> pnpm test:perf
    ```

11. Return the report path and status to the coordinator.

### Coordinator collection

After all sub-agents complete, the coordinator collects:
- the baseline report path from Stage 4
- each candidate's report path, branch, DB, and status

If any candidate is blocked, report the failure reason and proceed with the remaining candidates.

---

## Stage 6 — COMPARE

Goal: Compare baseline and candidate benchmark reports and select a winner.

1. Read the baseline report and each candidate report using the paths collected by the coordinator.

2. For each candidate, verify:
   - data checksum parity (same data, same results)
   - SQL parity (same query shape apart from the intended optimization)

3. Build a ranked comparison table across all reports:

   | Metric            | Baseline | Candidate A | Candidate B | ... |
   | ----------------- | -------- | ----------- | ----------- | --- |
   | Duration p50 (ms) | X        | Y           | Z           | ... |
   | Duration p95 (ms) | X        | Y           | Z           | ... |
   | Rows read         | X        | Y           | Z           | ... |
   | EXPLAIN: granules | X        | Y           | Z           | ... |

4. Recommend the winning candidate based on the ranked comparison. If any metric regressed, use AskUserQuestion to ask the user how to proceed:
   - Option A: Fix the issues and re-run the experiment
   - Option B: Revert specific changes
   - Option C: Accept and continue to ship

---

## Stage 7 — SHIP

Goal: Create a pull request for the winning candidate and route to rollout planning.

1. Checkout the winning candidate branch.

2. Build a PR body that includes:
   - summary of the optimization applied
   - benchmark comparison table from Stage 6
   - EXPLAIN diffs (baseline vs winner)
   - re-seed notes (which tables were re-seeded and why)
   - caveats about preview data volume (~10K rows) and how to interpret results
   - recommendations for monitoring post-merge

3. Create the PR:

   ```bash
   git push -u origin HEAD
   gh pr create --title "perf: <optimization summary>" --body "<generated PR body>"
   ```

4. Report the PR URL to the user.

Production rollout planning belongs to `production-rollout-plan`. This skill stops at the PR.
