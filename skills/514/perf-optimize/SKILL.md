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
  Guided ClickHouse performance optimization workflow for 514/Moose deployments.
  Profiles slow queries, proposes schema/index/MV candidates, benchmarks baseline
  vs candidates on preview branches, and ships the winner as a PR. Use when asked
  to optimize ClickHouse, speed up queries, benchmark schema changes, tune
  performance, or profile a Moose deployment.
---

# ClickHouse Performance Optimization

Seven stages, run sequentially: **SETUP → PROFILE → PROPOSE → BASELINE → EXPERIMENT → COMPARE → SHIP**.
Complete each stage fully before moving to the next. Use conversation context as state.

Inside Stage 4, start the baseline deployment and all approved candidate deployments in parallel. Do not wait for the baseline preview deployment before creating candidate branches from the local `perf/baseline` commit.

If the user provided a project slug as an argument, skip the project selection prompt in Stage 1.

## Command safety

**Guardrailed (run freely):** `514 agent auth whoami`, `514 agent project list`, `514 agent deployment list`, `514 agent deployment wait`, `514 agent table list`, `514 agent materialized-view list`, `514 agent sql-resource list`, `514 agent metrics query`, `514 logs query`, `514 clickhouse query`, `moose add benchmark`, `moose dev`, `moose ls`, `pnpm env:preview`, `pnpm bench`

**Require user approval before running:**

- `514 env list --platform --dotenv` — emits platform secrets; pipe directly to `.env.*`, not for inspection
- Any `514 clickhouse seed` — copies rows from a source branch into a preview branch

Use AskUserQuestion to show the exact command and get explicit approval for approval-gated commands. Never show a template with unresolved placeholders.

**Ambiguity rule:** If deployment, database, or table resolution is ambiguous at any point, stop and carry a blocker instead of guessing. This rule applies throughout all stages — later stages reference it as "carry a blocker" without repeating the full rationale.

**Deployment wait rule:** When waiting for a preview deployment, use `514 agent deployment wait` for the target branch. Do not write custom Python scripts, Bash loops, or other ad hoc polling wrappers around `514 agent deployment list`.

## Benchmark contract

Every branch must expose the same benchmark target interface for the production query pattern being tested. Prefer this discovery order:

1. an existing `defineQueryModel` export matching the target query shape
2. an exported SQL template literal or query-builder function
3. another codified query/API entrypoint faithfully representing the query
4. if none exists, define a query model matching the discovered production pattern

Do not invent a synthetic benchmark query disconnected from production.

Across all branches: the same entrypoint stays under test, dimensions/metrics/filters/defaults stay the same, only the `table` reference changes per candidate.

## Sample sizing

When seeding preview branches from production, compute sample sizes per table:

| Prod row count | Sample size | Rationale |
| -------------- | ----------- | --------- |
| < 100K | All rows | Already small |
| 100K - 1M | 100,000 | ~12 granules; enough for index-skip diffs |
| 1M - 100M | 1% of rows | Multiple partitions, realistic merge behavior |
| 100M - 1B | 0.1% (min 1M) | Caps transfer while exercising features |
| > 1B | 0.01% (min 1M, max 10M) | Prevents preview storage blow-up |

Present computed sizes to the user for approval before seeding. Store as `SAMPLE_SIZES`.

---

## Stage 1 — SETUP

Goal: Authenticate, identify the target project, find the active deployment, capture baseline DDL.

1. Verify auth: `514 agent auth whoami --json`. If it fails, stop — user must run `514 auth login`.
2. List projects: `514 agent project list --json`. Match the argument slug or ask via AskUserQuestion.
3. List deployments: `514 agent deployment list --project <PROJECT> --json`.
   Identify the active production deployment. Capture **deployment ID** and **branch name**. Carry a blocker if ambiguous.
4. List tables: `514 agent table list <DEPLOY_ID> --project <PROJECT> --json`.
5. Capture DDL for each table (**prompt user first**):
   `514 clickhouse query 'SHOW CREATE TABLE <DB>.<TABLE>' --project <PROJECT> --branch <BRANCH> --json`
   Store as `BASELINE_DDL`.
6. Summarize findings (user, org, project, deployment, branch, tables) and confirm before proceeding.

---

## Stage 2 — PROFILE

Goal: Collect schema, query, and storage evidence. Extract a benchmark query set. Map findings back to code.

### 2a. Fetch schema metadata

```
514 agent table list <DEPLOY_ID> --project <PROJECT> --json
514 agent materialized-view list <DEPLOY_ID> --project <PROJECT> --json
514 agent sql-resource list <DEPLOY_ID> --project <PROJECT> --json
```

### 2b. Collect slow queries

```
514 agent metrics query --project <PROJECT> --branch <BRANCH> --duration-min 100 --sort-by query_duration_ms --sort-dir desc --limit 10 --json
```

### 2c. Collect storage and column diagnostics (prompt user)

Read [references/diagnostic-sql.md](references/diagnostic-sql.md) for the exact SQL templates. Batch the part-size and column-cardinality queries into a single approval prompt.

### 2d. Extract benchmark query set

From step 2b output, extract the top 5–10 slow queries. Deduplicate by template. Store as `BENCHMARK_QUERIES`. Note which tables each query reads from — these become `BENCHMARK_TABLES`.

### 2e. Capture baseline EXPLAIN plans (prompt user)

```
514 clickhouse query 'EXPLAIN indexes = 1 <QUERY_SQL>' --project <PROJECT> --branch <BRANCH> --json
```

One per benchmark query. Store as `BASELINE_EXPLAINS`.

### 2f. Run baseline benchmarks (prompt user)

Run each benchmark query 3× on production (1 warmup + 2 timed) via `514 clickhouse query`. Then collect results:

```
514 agent metrics query --project <PROJECT> --branch <BRANCH> --search "<query_pattern>" --sort-by query_duration_ms --sort-dir desc --limit 10 --json
```

Store as `BASELINE_METRICS`.

### 2g. Analyze against best practices

Read `skills/clickhouse/best-practices/rules/` (or `AGENTS.md`). Evaluate each applicable rule against collected evidence.

Additionally, check each slow query for MV opportunities:

- **Aggregation pattern:** `GROUP BY` with high `read_rows` and `-State`/`-Merge`-compatible functions → incremental MV candidate
- **Join pattern:** Joins with infrequently-changing dimension tables and acceptable staleness → refreshable MV candidate
- **Frequency:** Same template executed many times per hour → pre-computation benefit amplified

Consult `query-mv-when-to-add` for the full decision matrix.

### 2h. Map findings back to code

Scan the local Moose codebase for data model definitions (`app/` or `datamodels/`) and query entrypoints (`defineQueryModel`, SQL template literals, query-builder functions).

For each candidate improvement, capture: affected tables + model paths, query entrypoint paths, likely change, whether destructive (ORDER BY / engine change), whether it requires a new MV + target table, and the benchmark target interface.

---

## Stage 3 — PROPOSE

Use AskUserQuestion to present a numbered optimization plan. Per candidate:

- candidate name, expected impact (`high` / `medium` / `low`)
- affected tables, local paths to change
- re-seed category: **Type-only** (data preserved) · **ORDER BY / engine** (table recreated, reseed needed) · **New MV** (needs backfill)
- risks or caveats

Let the user accept, modify, or reject items. Capture the approved set.

---

## Stage 4 — BASELINE

Goal: Create the frozen control branch, fan out candidate branches immediately, seed comparable baseline data, prove the benchmark runs.

### 4a. Scaffold the benchmark harness

Run this from the Moose project root. The benchmark package should be created as a sibling directory next to the Moose project, not from inside some other working directory.

```bash
mkdir ../query-benchmarks && moose add benchmark --dir ../query-benchmarks
```

Inspect the generated files immediately after scaffolding. Treat harness files as read-only unless the scaffold explicitly expects edits.

### 4a.1. Install the Moose project as a workspace dependency in the benchmark package

The benchmark package must import the Moose project through the workspace package graph, not through copied code or ad hoc relative filesystem imports.

1. Read the Moose project's `package.json` and capture its real package name from the `name` field.
2. In the benchmark `package.json`, add the Moose project to `dependencies` by its actual package name using the workspace protocol:

   ```json
   {
     "dependencies": {
       "<moose-package-name>": "workspace:*"
     }
   }
   ```

3. If the benchmark package already references the Moose project with a non-workspace version, replace it with `workspace:*`.
4. If the benchmark package uses a relative `file:` dependency, replace it with `workspace:*`.
5. Run the package manager install from the workspace root so the workspace link is actually created.
6. Verify the benchmark code imports the Moose project by package name, not by relative path traversal.

Required checks:
- the Moose project and the benchmark package must both live in the same workspace
- the Moose project must have a stable `name` field in its `package.json`
- the benchmark package must depend on that exact package name
- the workspace install must complete before running `pnpm bench`

Do not:
- do not use `../..` relative imports from the benchmark package into the Moose app
- do not copy query code into the benchmark package just to avoid dependency setup
- do not invent a package name if the Moose project does not already declare one
- do not use custom linking scripts when the workspace dependency mechanism can express the relationship

If the Moose project is not already part of the workspace, or if its package name is missing or ambiguous, carry a blocker instead of guessing.

### 4b. Wire the benchmark target interface

From the Moose project root, edit the benchmark entrypoint inside the sibling `../query-benchmarks` package. Use the interface discovered in 2h and fill the scaffold's query definition entrypoint with the correct import, call shape, and parameters.

Import the target benchmark query into `query-benchmarks` from the Moose workspace dependency you just installed. Prefer:
- package import from the Moose workspace package name declared in the Moose project's `package.json`

Example shape:

```typescript
import { targetBenchmarkQuery } from "<moose-package-name>";
```

Adapt the example to the real query entrypoint discovered in Stage 2h. Keep the benchmark target semantically identical to production.

Avoid:
- relative imports that escape the benchmark package
- duplicated benchmark-only copies of the production query logic

### 4c. Create and push the baseline branch

```bash
git checkout -b perf/baseline
git add -A && git commit -m "perf: add benchmark scaffold and target interface"
git push -u origin perf/baseline
```

### 4d. Fan out candidate branches immediately

As soon as the baseline commit exists locally, create one worktree per approved candidate from that local `perf/baseline` commit and dispatch one sub-agent per candidate. Do this **before** waiting for any preview deployment.

Example branch creation:

```bash
git worktree add ../candidate-<name> -b perf/candidate-<name> perf/baseline
```

Each candidate sub-agent should:

1. start from the local `perf/baseline` commit, not from a deployed preview
2. apply exactly one approved optimization
3. if destructive (ORDER BY / engine change), resolve the new physical table name via Moose versioned-table behavior; carry a blocker if ambiguous
4. update the benchmark target interface (usually just the `table` reference)
5. validate locally: `moose dev --timestamps`
6. commit and push immediately: `git add -A && git commit -m "perf: candidate <name>" && git push -u origin perf/candidate-<name>`

Return at least: `candidate_name`, `candidate_branch`, `status` (`pushed` | `blocked`), `failure_reason`, `candidate_verification_notes`.

### 4e. Wait for baseline deployment and export credentials

Use the built-in wait command for the baseline branch:

```bash
514 agent deployment wait --branch perf/baseline
```

Do not replace this with a custom script or repeated manual polling of `514 agent deployment list`.

### 4f. Ensure baseline has comparable seed data

Resolve `BENCHMARK_TABLES` from Stage 2d.

**Comparable seed data** means: the same tables exist on baseline and every candidate, the seeded slice exercises the profiled query shape, and the same seed strategy is reused everywhere.

Check row counts (see [references/diagnostic-sql.md](references/diagnostic-sql.md) for the template). Store as `BASELINE_SEED_COUNTS`.

If data is insufficient, compute `SAMPLE_SIZES` from production row counts using the **Sample sizing** table. Present the seeding plan via AskUserQuestion (table, prod rows, sample size, effective %, limit). Store the chosen strategy as `BASELINE_SEED_NOTES`.

Seed preference order: (1) reuse a filter window from the profiled query, (2) deterministic `--where` filter, (3) `LIMIT` as a last resort with a noted caveat.

`514 clickhouse seed` appends and has no truncate step. Carry a blocker if a reseed would produce duplicates.

```
514 clickhouse seed <TABLE> --project <PROJECT> --branch perf/baseline --from <BRANCH> --where "<FILTER>" --limit <SAMPLE_SIZE> --json
```

After seeding, re-check row counts and update `BASELINE_SEED_COUNTS`. Carry a blocker if counts are still insufficient.

### 4g. Prove the benchmark runs

Verify the pre-run artifacts exist: `BENCHMARK_TABLES`, `SAMPLE_SIZES`, `BASELINE_SEED_COUNTS`, `BASELINE_SEED_NOTES`. Carry a blocker if any are missing.

Be explicit about the baseline run:

1. Make sure the current checkout is the baseline branch before running any benchmark scripts.
2. Rebuild `.env.preview` using the latest helper script for the currently checked out branch. Carry a blocker if `.env.preview` is still missing after this step.
3. Run the benchmark with the current benchmark script.

```bash
git checkout perf/baseline
pnpm env:preview && pnpm bench
```

Capture the report path under `reports/`. If the benchmark fails or produces no report, stop and fix before proceeding.

---

## Stage 5 — EXPERIMENT

Goal: For each approved candidate already pushed from the local baseline commit, wait for deployment as needed, seed from baseline, and benchmark.

### Parallelization

Run candidates in parallel via git worktrees. **Coordinator** should have already created and pushed candidate branches in Stage 4d so their preview deployments can start while baseline deploys and seeds. Resume or re-dispatch one sub-agent per pushed candidate after `BASELINE_SEED_COUNTS` and `BASELINE_SEED_NOTES` exist. Each sub-agent returns:

`candidate_name`, `candidate_branch`, `candidate_seed_counts`, `candidate_explains`, `candidate_verification_notes`, `report_path`, `status` (`success` | `blocked`), `failure_reason`

### Per-candidate workflow

1. Confirm the candidate branch was created from the local `perf/baseline` commit and pushed in Stage 4d. If not, carry a blocker instead of recreating it from a later baseline state.
2. Wait for the candidate deployment with the built-in wait command:

   ```bash
   514 agent deployment wait --project <PROJECT> --branch perf/candidate-<name>
   ```

   Do not replace this with a custom script or repeated manual polling of `514 agent deployment list`.
3. **Seed from baseline, not production.** Prompt the user once with the row-count SQL and `514 clickhouse seed` commands.
   - Copy each `BENCHMARK_TABLES` entry from `perf/baseline`: `514 clickhouse seed <TABLE> --project <PROJECT> --branch perf/candidate-<name> --from perf/baseline --json`
   - Do not recompute `SAMPLE_SIZES` — candidates inherit baseline's exact data set.
   - Carry a blocker if column types changed (seed copies `SELECT *`; casts need CLI support) or if a reseed would duplicate rows.
4. Capture `CANDIDATE_SEED_COUNTS` and compare to `BASELINE_SEED_COUNTS`. Carry a blocker if not comparable.
5. Capture `CANDIDATE_EXPLAINS` using the same EXPLAIN shape from 2e (**prompt user**).
6. Make sure the current checkout is the candidate branch, then re-generate `.env.preview` with the latest helper script so it targets that checked out branch. Carry a blocker if credentials cannot be resolved.
7. Run benchmark with the current benchmark script:

   ```bash
   git checkout perf/candidate-<name>
   pnpm env:preview && pnpm bench
   ```

   Carry a blocker if no report.
8. Record `candidate_verification_notes` (seed strategy, caveats, count comparison, open questions for Stage 6).
9. Return all artifacts to the coordinator.

### Coordinator collection

Collect baseline report + `BASELINE_SEED_COUNTS` + `BASELINE_SEED_NOTES` + each candidate's artifacts. Report any blocked candidates and proceed with the rest.

---

## Stage 6 — COMPARE

1. Read baseline and candidate reports.
2. Verify required evidence exists for each candidate: both report paths, `BASELINE_EXPLAINS` / `CANDIDATE_EXPLAINS`, seed counts, seed notes / verification notes. Carry a blocker if any are missing.
3. Verify parity per candidate:
   - **data parity:** comparable tables and row counts
   - **result parity:** same results (or intentional difference documented and approved)
   - **SQL parity:** same query shape apart from the optimization
   - **EXPLAIN parity:** plan changes consistent with the intended optimization
   Parity failure is separate from regression. A candidate with failed parity is ineligible until fixed or explicitly approved.
4. Build a ranked comparison table:

   | Metric | Baseline | Candidate A | ... |
   | ------ | -------- | ----------- | --- |
   | Duration p50 (ms) | X | Y | ... |
   | Duration p95 (ms) | X | Y | ... |
   | Rows read | X | Y | ... |
   | EXPLAIN: granules | X | Y | ... |

5. Recommend the winner. If any metric regressed or evidence is missing, use AskUserQuestion: (A) fix and re-run, (B) revert specific changes, (C) accept and ship.

---

## Stage 7 — SHIP

1. Checkout the winning candidate branch.
2. Build a PR body: optimization summary, comparison table, EXPLAIN diffs, parity summary, re-seed notes, `SAMPLE_SIZES` per table (rows seeded, effective % of production — caveat that full-volume behavior may differ), any approved evidence gaps, monitoring recommendations.
   Do not create the PR until comparison evidence exists or the user explicitly approves gaps.
3. Create the PR:
   ```bash
   git push -u origin HEAD
   gh pr create --title "perf: <optimization summary>" --body "<generated PR body>"
   ```
4. Report the PR URL.

Production rollout planning belongs to `production-rollout-plan`. This skill stops at the PR.
