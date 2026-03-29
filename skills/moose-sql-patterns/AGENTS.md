# MooseStack SQL Patterns — Agent Reference

> Auto-generated reference for AI coding agents. See SKILL.md for the review procedure.

## Prerequisite

Run `dashboard-preflight` for new API handlers. Compose with `clickhouse-best-practices` for query optimization and `api-to-mv-optimization` for MV design.

## Overview

This skill provides 5 rules for writing safe, correct dynamic ClickHouse queries in MooseStack using the `sql` template tag.

## Rules

### CRITICAL

#### sql-parameterize-values
Use the `sql` template tag for all value interpolation. The tag auto-escapes and parameterizes. Never use string concatenation or template literals without `sql`. Fragments compose: `sql` can interpolate other `sql` fragments.

#### sql-safe-identifiers
Use `ApiHelpers.column()` and `ApiHelpers.table()` for dynamic column and table names. The `sql` tag parameterizes values, not identifiers. Raw strings as identifiers bypass parameterization. Also available: `ConsumptionHelpers.column()` for model-backed references.

#### sql-allow-list-dynamics
Constrain dynamic columns, operators, sort fields, and granularities to allow-lists. Use TypeScript enums + switch for compile-time exhaustiveness. Use `Record<string, Sql>` maps for value-to-fragment lookups. Reject unknown values with 400.

### HIGH

#### sql-dynamic-where
Build WHERE clauses with `Sql[]` arrays + `joinQueries`. Never manually stitch fragments with conditional AND/OR glue. Use nested `joinQueries` for OR groups within AND chains. Return `Sql[]` from helper functions for composability.

#### sql-validate-inputs
Validate all inputs before SQL interpolation. `parseInt()` always with radix 10 + `isNaN()` check. `JSON.parse()` always in try/catch. JWT tenant dims: check presence, return 401. Search strings: trim + length check before ILIKE.

## Quick Reference

```
Step 1: Parameterize values    → sql-parameterize-values
Step 2: Safe identifiers       → sql-safe-identifiers
Step 3: Dynamic WHERE          → sql-dynamic-where
Step 4: Allow-list dynamics    → sql-allow-list-dynamics
Step 5: Validate inputs        → sql-validate-inputs
```
