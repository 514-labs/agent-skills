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

If the user provided a project slug as an argument, skip the project selection prompt in Stage 1.

## Command safety

**Guardrailed (run freely):** `514 agent auth whoami`, `514 agent project list`, `514 agent deployment list`, `514 agent table list`, `514 agent materialized-view list`, `514 agent sql-resource list`, `514 agent metrics query`, `514 logs query`, `moose add benchmark`, `moose dev`, `moose ls`, `pnpm test:perf`

**Require user approval before running:**

- `514 env list --platform --dotenv` — emits platform secrets; pipe directly to `.env.*`, not for inspection
- Any `514 clickhouse query` — including `SHOW CREATE TABLE`, `system.parts`, `EXPLAIN`, benchmark replay
- Any `514 clickhouse seed` — copies rows from a source branch into a preview branch

Use AskUserQuestion to show the exact command or fully-resolved SQL and get explicit approval. Never show a template with unresolved placeholders.

**Ambiguity rule:** If deployment, database, or table resolution is ambiguous at any point, stop and carry a blocker instead of guessing. This rule applies throughout all stages — later stages reference it as "carry a blocker" without repeating the full rationale.

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

Goal: Create the frozen control branch, scaffold benchmarks, seed comparable data, prove the benchmark runs.

### 4a. Scaffold the benchmark harness

```bash
moose add benchmark
```

Inspect the generated files. Treat harness files as read-only unless the scaffold explicitly expects edits.

### 4b. Wire the benchmark target interface

Use the interface discovered in 2h. Fill the scaffold's query definition entrypoint with the correct import, call shape, and parameters.

### 4c. Create and push the baseline branch

```bash
git checkout -b perf/baseline
git add -A && git commit -m "perf: add benchmark scaffold and target interface"
git push -u origin perf/baseline
```

### 4d. Wait for deployment and export credentials

Poll `514 agent deployment list --project <PROJECT> --json` until the baseline deployment appears.

Follow [references/credentials.md](references/credentials.md) to export the baseline branch's ClickHouse credentials into `.env.preview`. Carry a blocker if credentials cannot be resolved.

### 4e. Ensure baseline has comparable seed data

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

### 4f. Prove the benchmark runs

Verify all artifacts exist: `BENCHMARK_TABLES`, `.env.preview`, `SAMPLE_SIZES`, `BASELINE_SEED_COUNTS`, `BASELINE_SEED_NOTES`. Carry a blocker if any are missing.

```bash
pnpm test:perf
```

Capture the report path under `reports/`. If the benchmark fails or produces no report, stop and fix before proceeding.

---

## Stage 5 — EXPERIMENT

Goal: For each approved candidate, implement, deploy, seed from baseline, and benchmark.

### Parallelization

Run candidates in parallel via git worktrees. **Coordinator** creates worktrees from `perf/baseline` and dispatches one sub-agent per candidate. Each sub-agent returns:

`candidate_name`, `candidate_branch`, `candidate_seed_counts`, `candidate_explains`, `candidate_verification_notes`, `report_path`, `status` (`success` | `blocked`), `failure_reason`

### Per-candidate workflow

1. Branch: `git checkout perf/baseline && git checkout -b perf/candidate-<name>`
2. Apply exactly one optimization (data models, SQL resources, or MV definitions).
3. If destructive (ORDER BY / engine change), resolve the new physical table name via Moose versioned-table behavior. Carry a blocker if ambiguous.
4. Update the benchmark target interface (usually just the `table` reference).
5. Validate locally: `moose dev --timestamps`
6. Commit and push: `git add -A && git commit -m "perf: candidate <name>" && git push -u origin perf/candidate-<name>`
7. Wait for deployment.
8. **Seed from baseline, not production.** Prompt the user once with the row-count SQL and `514 clickhouse seed` commands.
   - Copy each `BENCHMARK_TABLES` entry from `perf/baseline`: `514 clickhouse seed <TABLE> --project <PROJECT> --branch perf/candidate-<name> --from perf/baseline --json`
   - Do not recompute `SAMPLE_SIZES` — candidates inherit baseline's exact data set.
   - Carry a blocker if column types changed (seed copies `SELECT *`; casts need CLI support) or if a reseed would duplicate rows.
9. Capture `CANDIDATE_SEED_COUNTS` and compare to `BASELINE_SEED_COUNTS`. Carry a blocker if not comparable.
10. Capture `CANDIDATE_EXPLAINS` using the same EXPLAIN shape from 2e (**prompt user**).
11. Re-generate `.env.preview` for the candidate branch per [references/credentials.md](references/credentials.md). Carry a blocker if credentials cannot be resolved.
12. Run benchmark: `pnpm test:perf` (`.env.preview` already targets this candidate). Carry a blocker if no report.
13. Record `candidate_verification_notes` (seed strategy, caveats, count comparison, open questions for Stage 6).
14. Return all artifacts to the coordinator.

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
