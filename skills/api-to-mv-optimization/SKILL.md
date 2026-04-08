# API-to-MV Optimization (TypeScript, Python)

A guided workflow for converting ClickHouse API queries that scan raw event tables into pre-aggregated MaterializedView architectures. The result is a serving table that shifts aggregation from read-time to write-time, reducing dashboard query latency by orders of magnitude.

## Prerequisite

Run `dashboard-preflight` first. This skill consumes the context map it produces — specifically the validated source tables, access patterns, and tenant dimensions. Do not start MV design without a completed context map.

## When to Apply

Use this skill when the preflight context map shows:
- The API scans one or more raw event/ingest tables directly
- The query applies `GROUP BY` with aggregate functions (`sum`, `count`, `avg`, `uniq`)
- The current state assessment flags the query as an optimization candidate

## Compose With

This skill is designed to work alongside `clickhouse-best-practices`. At each step below, the relevant `clickhouse-best-practices` rules are listed. Read them before making design decisions — they encode ClickHouse-specific mechanics (sparse index behavior, merge tree semantics) that general database intuition gets wrong.

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

Also read from `clickhouse-best-practices`:
- `query-mv-incremental` — understand incremental MV mechanics before choosing topology
- `query-mv-refreshable` — consider refreshable MVs for complex joins that incremental MVs can't handle

### Step 2 — Design the Serving Table

Per `mv-design-serving-table` and `mv-fan-in-schema`:

1. Define the **grain**: one row per `(tenant dimensions, metric, time bucket, dimension value)`
2. Choose the **engine**: `MergeTree` for immutable rollups, `AggregatingMergeTree` for stateful aggregates
3. Set `orderByFields` to prioritize common equality filters, then time, then search/group-by dimensions
4. For fan-in: define a **union schema** with zero/empty defaults for columns not present in each branch

Also read from `clickhouse-best-practices`:
- `schema-pk-plan-before-creation` — ORDER BY is immutable after table creation
- `schema-pk-cardinality-order` — order columns low-to-high cardinality in ORDER BY
- `schema-pk-prioritize-filters` — include all frequently filtered columns
- `schema-pk-filter-on-orderby` — queries must filter on ORDER BY prefix for index scans
- `schema-types-lowcardinality` — apply LowCardinality to dimension strings with <10K unique values (metric, route, topic_name, etc.)
- `schema-types-minimize-bitwidth` — use smallest numeric type that fits the data
- `schema-partition-start-without` — start without partitioning; add only if lifecycle management or drop-partition is needed

### Step 3 — Plan the Materialized Views

Per `mv-write-time-aggregation`:

1. One MV per source table (for fan-in) or per query shape (for fan-out)
2. Each MV `SELECT` must produce the exact serving table schema
3. Pre-aggregate at the chosen time bucket using `toStartOfInterval`
4. Use `sum`, `count`, etc. — not `-State`/`-Merge` unless using `AggregatingMergeTree`

Also read from `clickhouse-best-practices`:
- `query-mv-incremental` — use `-State`/`-Merge` functions only with `AggregatingMergeTree`; plain aggregates are correct for `MergeTree` targets
- `insert-optimize-avoid-final` — do not run `OPTIMIZE TABLE FINAL` on the serving table; let background merges work

### Step 4 — Verify Correctness

Per `mv-verify-correctness`, do not rewrite the API until all three checks pass:

1. **Infrastructure** — serving table and all MVs exist in `system.tables`
2. **Population** — insert a test row into each source table, verify it appears in the serving table with correct metric label and zero/empty defaults
3. **Aggregation parity** — for the same filters, raw source table aggregation and serving table aggregation produce identical results

For fan-in topologies, test each branch independently before testing combined results.

### Step 5 — Update the API

Rewrite the API query to read from the serving table instead of raw source tables. The serving table's grain and ORDER BY should make the query a simple scan with no heavy aggregation.

Also read from `clickhouse-best-practices`:
- `schema-pk-filter-on-orderby` — verify the rewritten query's WHERE clause uses the serving table's ORDER BY prefix

## Priority Ranking

| Rank | Rule | Impact |
|------|------|--------|
| 1 | `mv-select-strategy` | HIGH |
| 2 | `mv-design-serving-table` | CRITICAL |
| 3 | `mv-fan-in-schema` | HIGH |
| 4 | `mv-write-time-aggregation` | CRITICAL |
| 5 | `mv-verify-correctness` | CRITICAL |
