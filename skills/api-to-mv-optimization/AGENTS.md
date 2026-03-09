# API-to-MV Optimization — Agent Reference

> Auto-generated reference for AI coding agents. See SKILL.md for the review procedure.

## Prerequisite

Requires a completed context map from `dashboard-preflight`. Do not start without validated inputs.

## Compose With

Read `clickhouse-best-practices` rules at each step. Key cross-references:
- **Step 1 (Strategy):** `query-mv-incremental`, `query-mv-refreshable`
- **Step 2 (Serving table):** `schema-pk-plan-before-creation`, `schema-pk-cardinality-order`, `schema-pk-prioritize-filters`, `schema-pk-filter-on-orderby`, `schema-types-lowcardinality`, `schema-types-minimize-bitwidth`, `schema-partition-start-without`
- **Step 3 (MVs):** `query-mv-incremental`, `insert-optimize-avoid-final`
- **Step 5 (API):** `schema-pk-filter-on-orderby`

## Overview

This skill provides a guided workflow for converting ClickHouse API queries into pre-aggregated MaterializedView architectures. It contains 5 rules focused on MV design and verification.

## Rules

### CRITICAL

#### mv-design-serving-table
Design the Serving Table Grain and ORDER BY from Access Patterns. Grain: one row per (tenant dimensions, metric type, time bucket, dimension value). ORDER BY: equality filters first, then time, then search/group-by dimensions. Use MergeTree for immutable rollups.

#### mv-write-time-aggregation
Pre-Aggregate at Write Time with Time Bucketing. Shifts O(billions) read-time scans to O(1) per-insert aggregation. Use `toStartOfInterval` for time bucketing. Start with per-second buckets; cascade to coarser buckets if serving table grows too large.

### HIGH

#### mv-select-strategy
Choose the Right MV Strategy for Your Source Topology. Four strategies: fan-in (many sources → one serving), fan-out (one source → many serving), cascade (MV → MV), single. Fan-in avoids runtime UNION when sources are independent.

#### mv-fan-in-schema
Use Zero/Empty Defaults for Fan-In Union Schema. Each MV SELECT must produce the exact target schema. Use `''` for missing String columns, `toFloat64(0)` for missing numeric columns. Column order must match the target table.

#### mv-verify-correctness
Verify MV Population and Aggregation Parity Before Updating the API. Three checks: infrastructure (tables + views exist), population (insert triggers MV), aggregation parity (serving table matches raw table results). For fan-in, test each branch independently. Do not update the API until all checks pass.

## Quick Reference

```
Preflight: dashboard-preflight  → context map with validated inputs + access patterns
Step 1: Select strategy         → mv-select-strategy
Step 2: Design serving table    → mv-design-serving-table + mv-fan-in-schema
Step 3: Plan MVs                → mv-write-time-aggregation
Step 4: Verify correctness      → mv-verify-correctness
Step 5: Update API              → (manual: rewrite query to read from serving table)
```
