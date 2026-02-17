# API-to-MV Optimization — Agent Reference

> Auto-generated reference for AI coding agents. See SKILL.md for the review procedure.

## Overview

This skill provides a guided workflow for converting ClickHouse API queries into pre-aggregated MaterializedView architectures. It contains 7 rules organized as a sequential workflow.

## Rules

### CRITICAL

#### mv-validate-inputs
Validate API and Source Tables Before Designing MVs. Prevents wasted design effort on incomplete or stale inputs. Always confirm the API file, all source table models, and access patterns exist before proceeding with MV design.

#### mv-extract-access-patterns
Extract Access Patterns from the API Query. The serving table's grain, ORDER BY, and MV SELECT are all derived from the API's access patterns. List every WHERE filter, GROUP BY column, aggregate function, and per-metric branch.

#### mv-design-serving-table
Design the Serving Table Grain and ORDER BY from Access Patterns. Grain: one row per (tenant dimensions, metric type, time bucket, dimension value). ORDER BY: equality filters first, then time, then search/group-by dimensions. Use MergeTree for immutable rollups.

#### mv-write-time-aggregation
Pre-Aggregate at Write Time with Time Bucketing. Shifts O(billions) read-time scans to O(1) per-insert aggregation. Use `toStartOfInterval` for time bucketing. Start with per-second buckets; cascade to coarser buckets if serving table grows too large.

### HIGH

#### mv-select-strategy
Choose the Right MV Strategy for Your Source Topology. Four strategies: fan-in (many sources → one serving), fan-out (one source → many serving), cascade (MV → MV), single. Fan-in avoids runtime UNION when sources are independent.

#### mv-fan-in-schema
Use Zero/Empty Defaults for Fan-In Union Schema. Each MV SELECT must produce the exact target schema. Use `''` for missing String columns, `toFloat64(0)` for missing numeric columns. Column order must match the target table.

### MEDIUM

#### mv-create-context-map
Create a Context Map Documenting the MV Design. Write to `context/context-map.md` with sections for input validation, serving table design, MV plan, and tradeoffs. Enables future maintainers to understand rationale without re-analysis.

## Quick Reference

```
Step 1: Validate inputs          → mv-validate-inputs
Step 2: Extract access patterns  → mv-extract-access-patterns
Step 3: Select strategy          → mv-select-strategy
Step 4: Design serving table     → mv-design-serving-table + mv-fan-in-schema
Step 5: Plan MVs                 → mv-write-time-aggregation
Step 6: Create context map       → mv-create-context-map
Step 7: Update API               → (manual: rewrite query to read from serving table)
```
