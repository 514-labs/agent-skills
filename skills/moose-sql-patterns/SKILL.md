---
name: moose-sql-patterns
description: "MUST USE when writing ClickHouse queries in MooseStack Api handlers. Covers the sql template tag, dynamic WHERE/GROUP BY/ORDER BY construction, safe identifier references, allow-list validation, and input parsing. Prevents SQL injection and malformed queries."
---

# MooseStack SQL Patterns

Rules for writing safe, correct dynamic ClickHouse queries in MooseStack using the `sql` template tag, `joinQueries`, and `ApiHelpers`.

## Prerequisite

Run `dashboard-preflight` first if this is a new API or query handler. The context map provides the access patterns (filters, group-bys, aggregates) that inform which dynamic patterns you need.

## Compose With

- `clickhouse-best-practices` — for query optimization decisions (`schema-pk-filter-on-orderby`, `query-join-*`)
- `api-to-mv-optimization` — if the query is an optimization candidate, do MV design before SQL authoring

## When to Apply

Use this skill when:
- Writing a new `Api` handler that queries ClickHouse
- Adding dynamic filters, sorting, or grouping to an existing query
- Constructing conditional query branches (metric types, entity types)
- Reviewing or refactoring existing query code for safety

## Review Procedure

### Step 1 — Parameterize All Values

Per `sql-parameterize-values`:
- Every value that enters a query MUST go through the `sql` template tag
- The `sql` tag auto-escapes and parameterizes — never use string concatenation
- Composable: `sql` fragments can be interpolated into other `sql` fragments

### Step 2 — Use Helpers for Dynamic Identifiers

Per `sql-safe-identifiers`:
- Column names: `ApiHelpers.column(name)` or `ConsumptionHelpers.column(name)`
- Table names: `ApiHelpers.table(name)` or `ConsumptionHelpers.table(name)`
- Never interpolate raw strings as identifiers — even inside `sql` tags, identifiers are not parameterized the same way values are

### Step 3 — Build Dynamic Clauses with joinQueries

Per `sql-dynamic-where`:
- Accumulate conditions as `Sql[]` arrays
- Combine with `joinQueries({ prefix, values, separator, suffix })`
- Never manually stitch `sql` fragments with conditional AND/OR glue

### Step 4 — Constrain All Dynamic Inputs to Allow-Lists

Per `sql-allow-list-dynamics`:
- Dynamic columns → TypeScript enum + switch, or map lookup
- Dynamic operators → switch statement with explicit cases
- Dynamic sort/group fields → map of allowed values to `sql` fragments
- Dynamic granularities → union type + validation before use
- Reject unknown values with a 400 response, never pass them through

### Step 5 — Validate and Parse Before Interpolation

Per `sql-validate-inputs`:
- `parseInt()` always with radix 10, always check `isNaN()` before use
- `JSON.parse()` always in try/catch
- String inputs: trim and check length before ILIKE interpolation
- JWT tenant dimensions: check for presence before building WHERE clause

## Priority Ranking

| Rank | Rule | Impact |
|------|------|--------|
| 1 | `sql-parameterize-values` | CRITICAL |
| 2 | `sql-safe-identifiers` | CRITICAL |
| 3 | `sql-allow-list-dynamics` | CRITICAL |
| 4 | `sql-dynamic-where` | HIGH |
| 5 | `sql-validate-inputs` | HIGH |
