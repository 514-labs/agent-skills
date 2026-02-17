# API-to-MV Optimization (TypeScript, Python)

A guided workflow for converting ClickHouse API queries that scan raw event tables into pre-aggregated MaterializedView architectures. The result is a serving table that shifts aggregation from read-time to write-time, reducing dashboard query latency by orders of magnitude.

## Prerequisite

Run `dashboard-preflight` first. This skill consumes the context map it produces — specifically the validated source tables, access patterns, and tenant dimensions. Do not start MV design without a completed context map.

## When to Apply

Use this skill when the preflight context map shows:
- The API scans one or more raw event/ingest tables directly
- The query applies `GROUP BY` with aggregate functions (`sum`, `count`, `avg`, `uniq`)
- The current state assessment flags the query as an optimization candidate

## Review Procedure

Follow these steps in order. Cite specific rules when providing guidance.

### Step 1 — Select Strategy

Per `mv-select-strategy`, choose the MV topology using the source tables and access patterns from the context map:

| Strategy | When to Use |
|----------|-------------|
| **Fan-in** | Multiple independent source tables feed one serving table. Sources share no columns. |
| **Fan-out** | One source table feeds multiple specialized serving tables for different query shapes. |
| **Cascade** | MV output feeds another MV (e.g., raw → hourly → daily). |
| **Single** | One source, one serving table. |

### Step 2 — Design the Serving Table

Per `mv-design-serving-table` and `mv-fan-in-schema`:

1. Define the **grain**: one row per `(tenant dimensions, metric, time bucket, dimension value)`
2. Choose the **engine**: `MergeTree` for immutable rollups, `AggregatingMergeTree` for stateful aggregates
3. Set `orderByFields` to prioritize common equality filters, then time, then search/group-by dimensions
4. For fan-in: define a **union schema** with zero/empty defaults for columns not present in each branch

### Step 3 — Plan the Materialized Views

Per `mv-write-time-aggregation`:

1. One MV per source table (for fan-in) or per query shape (for fan-out)
2. Each MV `SELECT` must produce the exact serving table schema
3. Pre-aggregate at the chosen time bucket using `toStartOfInterval`
4. Use `sum`, `count`, etc. — not `-State`/`-Merge` unless using `AggregatingMergeTree`

### Step 4 — Update the API

Rewrite the API query to read from the serving table instead of raw source tables. The serving table's grain and ORDER BY should make the query a simple scan with no heavy aggregation.

## Priority Ranking

| Rank | Rule | Impact |
|------|------|--------|
| 1 | `mv-select-strategy` | HIGH |
| 2 | `mv-design-serving-table` | CRITICAL |
| 3 | `mv-fan-in-schema` | HIGH |
| 4 | `mv-write-time-aggregation` | CRITICAL |
