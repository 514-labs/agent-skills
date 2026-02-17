# API-to-MV Optimization (TypeScript, Python)

A guided workflow for converting ClickHouse API queries that scan raw event tables into pre-aggregated MaterializedView architectures. The result is a serving table that shifts aggregation from read-time to write-time, reducing dashboard query latency by orders of magnitude.

## When to Apply

Use this skill when you see an API or query handler that:
- Scans one or more raw event/ingest tables
- Applies `GROUP BY` with aggregate functions (`sum`, `count`, `avg`, `uniq`)
- Filters on time range, tenant dimensions (org, project, branch), or search terms
- Is called on every dashboard page load or at high frequency

## Review Procedure

Follow these steps in order. Cite specific rules when providing guidance.

### Step 1 — Validate Inputs

Before designing anything, confirm all required artifacts exist. Per `mv-validate-inputs`:

1. Locate the ClickHouse query function (API file)
2. Locate all source table models referenced by the query
3. Extract access patterns: filters, group-bys, sorts
4. If any input is missing, stop and resolve before continuing

### Step 2 — Extract Access Patterns

Per `mv-extract-access-patterns`:

1. List every `WHERE` filter and its type (equality, range, ILIKE)
2. List every `GROUP BY` column
3. List every aggregate function and its input column
4. Identify per-metric branches if the query uses conditional logic (switch/case)

### Step 3 — Select Strategy

Per `mv-select-strategy`, choose the MV topology:

| Strategy | When to Use |
|----------|-------------|
| **Fan-in** | Multiple independent source tables feed one serving table. Sources share no columns. |
| **Fan-out** | One source table feeds multiple specialized serving tables for different query shapes. |
| **Cascade** | MV output feeds another MV (e.g., raw → hourly → daily). |
| **Single** | One source, one serving table. |

### Step 4 — Design the Serving Table

Per `mv-design-serving-table` and `mv-fan-in-schema`:

1. Define the **grain**: one row per `(tenant dimensions, metric, time bucket, dimension value)`
2. Choose the **engine**: `MergeTree` for immutable rollups, `AggregatingMergeTree` for stateful aggregates
3. Set `orderByFields` to prioritize common equality filters, then time, then search/group-by dimensions
4. For fan-in: define a **union schema** with zero/empty defaults for columns not present in each branch

### Step 5 — Plan the Materialized Views

Per `mv-write-time-aggregation`:

1. One MV per source table (for fan-in) or per query shape (for fan-out)
2. Each MV `SELECT` must produce the exact serving table schema
3. Pre-aggregate at the chosen time bucket using `toStartOfInterval`
4. Use `sum`, `count`, etc. — not `-State`/`-Merge` unless using `AggregatingMergeTree`

### Step 6 — Update the API

Rewrite the API query to read from the serving table instead of raw source tables. The serving table's grain and ORDER BY should make the query a simple scan with no heavy aggregation.

## Priority Ranking

| Rank | Rule | Impact |
|------|------|--------|
| 1 | `mv-validate-inputs` | CRITICAL |
| 2 | `mv-extract-access-patterns` | CRITICAL |
| 3 | `mv-select-strategy` | HIGH |
| 4 | `mv-design-serving-table` | CRITICAL |
| 5 | `mv-fan-in-schema` | HIGH |
| 6 | `mv-write-time-aggregation` | CRITICAL |
