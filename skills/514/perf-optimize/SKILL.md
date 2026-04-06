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

Commands fall into four categories:

**Guardrailed (run freely):** `514 agent auth whoami`, `514 agent project list`, `514 agent deployment list`, `514 agent table list`, `514 agent materialized-view list`, `514 agent sql-resource list`, `514 agent metrics query`, `514 logs query`, `moose add benchmark`, `moose dev`, `moose ls`, `pnpm test:perf`

**Platform vars (run freely):** `514 env list --platform --dotenv` with the correct `--project` and `-b, --branch` flags to export branch-scoped runtime credentials into the benchmark scaffold's `.env.preview` file.

**Raw ClickHouse (require user approval):** Any `514 clickhouse query` invocation — including `SHOW CREATE TABLE`, `system.parts` queries, `EXPLAIN`, and benchmark query replay.

**ClickHouse seed (require user approval):** Any `514 clickhouse seed` invocation used to copy rows from a source branch into a preview branch.

Before running any `514 clickhouse query` command, use AskUserQuestion to show the user the exact SQL and get explicit approval. If the command depends on resolved database names, table names, or cast mappings, show the fully resolved SQL, not a template.

Before running any `514 clickhouse seed` command, use AskUserQuestion to show the user the exact command and get explicit approval.

If deployment resolution, database resolution, or target-table resolution is ambiguous at any point, stop and carry a blocker instead of guessing.

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

## Sample sizing

When seeding preview branches from production, compute a representative sample size per table using this tiering table:

| Prod row count | Sample size | Rationale |
| -------------- | ----------- | --------- |
| < 100K | All rows (no LIMIT) | Already small; copy everything |
| 100K – 1M | 100,000 | ~12 granules; enough for index/granule-skip differences |
| 1M – 100M | 1% of rows | Multiple partitions, realistic merge behavior |
| 100M – 1B | 0.1% of rows (min 1M) | Caps transfer while exercising all features |
| > 1B | 0.01% of rows (min 1M, max 10M) | Hard cap prevents preview storage blow-up |

The 100K floor ensures enough granules (ClickHouse default = 8,192 rows) for EXPLAIN to show meaningful skipping differences. The 10M ceiling keeps transfer time under a few minutes and preview storage under ~5 GB per table.

Always present the computed sample sizes to the user for approval before seeding. Store final sizes as `SAMPLE_SIZES` for reuse across branches.

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
   If no deployment clearly matches, or multiple deployments appear equally valid, stop and carry a blocker instead of guessing.
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

### 4d. Wait for baseline deployment, export shared branch credentials once, and resolve the baseline DB

```
514 agent deployment list --project <PROJECT> --json
```

Poll until the baseline deployment appears.

Then export the branch's platform variables into the benchmark scaffold's `.env.preview` file once. Treat this file as the shared ClickHouse connection layer for the benchmark scaffold: host, port, auth, SSL, and any other platform-managed connection settings should come from this one export and be reused across baseline and candidate runs.

```bash
514 env list --project <PROJECT> -b perf/baseline --platform --dotenv > .env.preview
```

Confirm `.env.preview` contains the ClickHouse connection value the benchmark scaffold actually uses. Prefer a URL-shaped contract from platform vars:

- `MOOSE_CLICKHOUSE_CONFIG__URL`

If the benchmark scaffold needs split Moose ClickHouse env vars instead of a single URL, add a small parsing step in the benchmark setup script to derive and write these keys into `.env.preview` from `MOOSE_CLICKHOUSE_CONFIG__URL`:

- `MOOSE_CLICKHOUSE_CONFIG__HOST`
- `MOOSE_CLICKHOUSE_CONFIG__HOST_PORT`
- `MOOSE_CLICKHOUSE_CONFIG__USER`
- `MOOSE_CLICKHOUSE_CONFIG__PASSWORD`
- `MOOSE_CLICKHOUSE_CONFIG__DB_NAME`
- `MOOSE_CLICKHOUSE_CONFIG__USE_SSL`

Derive them with these rules:

- host: URL hostname
- host port: URL port
- user: URL username
- password: URL password
- db name: URL path database segment
- use SSL: `true` when the URL scheme is HTTPS, otherwise `false`

Do this derivation once when preparing `.env.preview`. The derived host, port, user, password, and SSL values become the shared benchmark connection settings for every run.

Resolve the branch-specific database name separately and store it as `BASELINE_DB`. If the scaffold or generated env file already includes `MOOSE_CLICKHOUSE_CONFIG__DB_NAME`, use that value. Otherwise, parse the database name from `MOOSE_CLICKHOUSE_CONFIG__URL` and write the derived `MOOSE_CLICKHOUSE_CONFIG__DB_NAME` into `.env.preview`.

After `.env.preview` exists, do not re-export host, port, user, password, SSL, or other shared platform-managed settings for each candidate branch. Reuse the same `.env.preview` file and only change the branch-specific database name when switching benchmark targets.

If the deployment appears but the env vars cannot be resolved, `.env.preview` cannot be populated, `MOOSE_CLICKHOUSE_CONFIG__URL` is missing, or any required derived ClickHouse env var cannot be produced from the URL, stop and carry a blocker instead of guessing.

### 4e. Ensure baseline has comparable seed data

First, resolve `BENCHMARK_TABLES` from Stage 2d. These are the only tables that need comparable data on preview branches.

For this workflow, **comparable seed data** means:

- the same benchmark-relevant tables exist on baseline and every candidate branch
- the seeded slice exercises the same filters, joins, sort order, and query shape discovered during profiling
- the same seed strategy is reused across baseline and every candidate branch
- if joins are involved, the seeded tables preserve enough overlapping keys for the benchmark query to return representative results

Check row counts for benchmark-relevant tables on the baseline deployment. **Prompt the user** before running:

```
514 clickhouse query 'SELECT table, sum(rows) AS total_rows FROM system.parts WHERE active = 1 AND database = '\''<BASELINE_DB>'\'' AND table IN (<BENCHMARK_TABLE_LIST>) GROUP BY table ORDER BY table' --project <PROJECT> --branch perf/baseline --json
```

Store this as `BASELINE_SEED_COUNTS`.

If any benchmark-relevant table has insufficient data to exercise the profiled query shape, re-seed from production using a deterministic slice that you can reuse for every candidate branch.

Prefer this order when defining the seed slice:

1. reuse an existing filter window from the profiled query pattern
2. seed a deterministic subset with an explicit `--where` filter
3. fall back to `LIMIT` only when no better slice is available, and record that caveat in the parity notes later

Store the chosen seed strategy and any caveats as `BASELINE_SEED_NOTES`.

Before re-seeding a table, decide whether append is safe. `514 clickhouse seed` copies rows into the target branch and does not expose a separate truncate step. If re-running the seed would create duplicate rows that distort the benchmark, stop and carry a blocker instead of issuing an unsafe reseed command.

Example seed pattern:

```
514 clickhouse seed <TABLE> --project <PROJECT> --branch perf/baseline --from <BRANCH> --where "<DETERMINISTIC_FILTER>" --limit <SEED_LIMIT> --json
```

Preview and production share the same ClickHouse cluster — this cross-database pattern is the standard seeding mechanism.

After re-seeding, re-run the row-count query for `BENCHMARK_TABLES` and update `BASELINE_SEED_COUNTS`. If the counts still do not reflect a comparable seed set, stop and carry a blocker before benchmarking.

### 4f. Prove the benchmark runs on baseline

Before running the benchmark suite, verify that the baseline branch has all required evidence:

- `BENCHMARK_TABLES`
- `BASELINE_DB`
- `.env.preview`
- `BASELINE_SEED_COUNTS`
- `BASELINE_SEED_NOTES`
- the exact seed strategy used for each benchmark-relevant table

If any of these artifacts are missing, stop and carry a blocker before continuing.

Run the benchmark suite against the shared branch credentials loaded through `.env.preview`, while temporarily overriding only the database name for the current benchmark target:

```bash
MOOSE_CLICKHOUSE_CONFIG__DB_NAME=<BASELINE_DB> pnpm test:perf
```

Capture the baseline report path under `reports/`. If the benchmark fails, stop and fix before creating candidate branches.

If the benchmark succeeds but no report path is produced, stop and carry a blocker before creating candidate branches.

Artifacts from this stage:

- `BASELINE_BRANCH=perf/baseline`
- `BASELINE_DB`
- `.env.preview`
- `BASELINE_SEED_COUNTS`
- `BASELINE_SEED_NOTES`
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
- `candidate_seed_counts`
- `candidate_explains`
- `candidate_verification_notes`
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
3. If the change is destructive (ORDER BY / engine change), rely on Moose versioned-table behavior. Resolve the new physical table name before seeding or benchmarking. If the target table cannot be identified unambiguously, stop and return a blocker instead of guessing.
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

   Overwrite `MOOSE_CLICKHOUSE_CONFIG__DB_NAME`, but reuse the rest of the env vars that you set previously in `.env.preview`.

   If the candidate database name cannot be resolved unambiguously, stop and return a blocker instead of guessing.
8. Check row counts for `BENCHMARK_TABLES` on the candidate deployment using the same query pattern and the same seed strategy captured in Stage 4e.
  **Prompt the user once** showing the exact row-count SQL and any fully resolved `514 clickhouse seed` command before executing.
   Seed candidate tables from `perf/baseline`, not from production. The candidate branches should copy the benchmark-relevant data set from the frozen baseline branch so every experiment runs against the same rows.
   For each table in `BENCHMARK_TABLES`, use the baseline branch as the source:
   Use this full-table copy from baseline even when the baseline itself was originally seeded from a filtered production slice. The candidate branch should inherit the exact baseline data set rather than re-evaluating the production seed filter independently.
   If column types changed between baseline and candidate, stop and carry a blocker. `514 clickhouse seed` copies `SELECT` * between matching tables, so type-changing reseeds need a follow-up workflow or CLI support that can express cast mappings safely.
   If re-running the seed would create duplicate rows that distort the benchmark, stop and carry a blocker instead of issuing a duplicate-producing seed command.
9. After seeding or re-seeding, capture `CANDIDATE_SEED_COUNTS` for `BENCHMARK_TABLES` and compare them to `BASELINE_SEED_COUNTS`.
  If the candidate counts are not comparable to baseline, or the seed strategy drifted from Stage 4e, stop and return a blocker before benchmarking.
10. Capture candidate EXPLAIN plans for the benchmark query set using the candidate DB and store them as `CANDIDATE_EXPLAINS`.
  Reuse the same EXPLAIN shape from Stage 2e. **Prompt the user once** showing the exact EXPLAIN SQL before executing.
11. Run the benchmark suite against the shared branch credentials loaded through `.env.preview`, while temporarily overriding only the database name for the candidate target:
  ```bash
    MOOSE_CLICKHOUSE_CONFIG__DB_NAME=<CANDIDATE_DB> pnpm test:perf
  ```
    If the benchmark succeeds but no report path is produced, stop and return a blocker.
12. Record `candidate_verification_notes` summarizing:
  - the seed strategy used
    - any approved caveats or fallback-to-`LIMIT` decisions
    - whether counts matched baseline closely enough to proceed
    - any follow-up questions Stage 6 must resolve during parity review
13. Return the report path, `candidate_seed_counts`, `candidate_explains`, `candidate_verification_notes`, and status to the coordinator.

### Coordinator collection

After all sub-agents complete, the coordinator collects:

- the baseline report path from Stage 4
- `BASELINE_SEED_COUNTS`
- `BASELINE_SEED_NOTES`
- each candidate's report path, branch, DB, `candidate_seed_counts`, `candidate_explains`, `candidate_verification_notes`, and status

If any candidate is blocked, report the failure reason and proceed with the remaining candidates.

---

## Stage 6 — COMPARE

Goal: Compare baseline and candidate benchmark reports and select a winner.

1. Read the baseline report and each candidate report using the paths collected by the coordinator.
2. For each candidate, collect the required comparison evidence before ranking performance:
  - baseline benchmark report path
  - candidate benchmark report path
  - `BASELINE_EXPLAINS`
  - `CANDIDATE_EXPLAINS`
  - `BASELINE_SEED_COUNTS`
  - `candidate_seed_counts`
  - `BASELINE_SEED_NOTES`
  - `candidate_verification_notes`
   If any required comparison artifact is missing, stop and carry a blocker instead of comparing partial evidence.
3. For each candidate, verify:
  - data parity: the candidate used comparable benchmark-relevant tables and row counts relative to baseline
  - result parity: the benchmark target still returns the same results, or any intentional difference is documented and approved
  - SQL parity: the query shape stays the same apart from the intended optimization
  - EXPLAIN parity: plan changes are understood and consistent with the intended optimization
   Treat parity failure separately from a performance regression. A candidate with missing or failed parity evidence is not eligible to win until the issue is fixed or the user explicitly approves proceeding with the gap.
4. Build a ranked comparison table across all reports:

  | Metric            | Baseline | Candidate A | Candidate B | ... |
  | ----------------- | -------- | ----------- | ----------- | --- |
  | Duration p50 (ms) | X        | Y           | Z           | ... |
  | Duration p95 (ms) | X        | Y           | Z           | ... |
  | Rows read         | X        | Y           | Z           | ... |
  | EXPLAIN: granules | X        | Y           | Z           | ... |

5. Recommend the winning candidate based on the ranked comparison and the parity review. If any metric regressed, or any required comparison evidence is missing, use AskUserQuestion to ask the user how to proceed:
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
  - parity summary explaining why the comparison was valid
  - re-seed notes (which tables were re-seeded and why)
  - any missing validation evidence or explicit user-approved gaps
  - caveats about preview data volume (~10K rows) and how to interpret results
  - recommendations for monitoring post-merge
   Do not create the PR until the required comparison evidence exists, or the user explicitly approves proceeding with documented gaps.
3. Create the PR:
  ```bash
   git push -u origin HEAD
   gh pr create --title "perf: <optimization summary>" --body "<generated PR body>"
  ```
4. Report the PR URL to the user.

Production rollout planning belongs to `production-rollout-plan`. This skill stops at the PR.