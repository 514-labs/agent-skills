---
title: Use ApiHelpers for Dynamic Column and Table Names
impact: CRITICAL
impactDescription: "Prevents identifier injection; raw strings as column/table names bypass sql tag parameterization"
tags: [sql, identifiers, security, moosestack]
---

## Use ApiHelpers for Dynamic Column and Table Names

**Impact: CRITICAL**

The `sql` template tag parameterizes *values* (strings, numbers), not *identifiers* (column names, table names). If you interpolate a raw string where ClickHouse expects an identifier, it will be quoted as a string value, not as an identifier — or worse, allow injection. Use `ApiHelpers.column()` and `ApiHelpers.table()` for dynamic identifiers.

**Incorrect (raw string as identifier):**

```typescript
import { sql } from "@514labs/moose-lib";

// BROKEN: orderBy is parameterized as a value, not an identifier
// Produces: ORDER BY 'timestamp' DESC (string literal, not column reference)
const query = sql`SELECT * FROM events ORDER BY ${orderBy} DESC`;

// BROKEN: tableName is parameterized as a value
const query2 = sql`SELECT * FROM ${tableName} WHERE orgId = ${orgId}`;
```

**Correct (ApiHelpers for identifiers):**

```typescript
import { Api, ApiHelpers, sql } from "@514labs/moose-lib";

// Safe: ApiHelpers.column() produces a properly quoted identifier
function orderBySql(orderBy: string | undefined, desc: string | undefined) {
  if (!orderBy) {
    return sql`ORDER BY timestamp DESC`;
  }
  switch (desc) {
    case "ASC":
      return sql`ORDER BY ${ApiHelpers.column(orderBy)} ASC`;
    default:
      return sql`ORDER BY ${ApiHelpers.column(orderBy)} DESC`;
  }
}

// Safe: ApiHelpers.table() for dynamic table references
function getTableName(metric: MetricType) {
  switch (metric) {
    case MetricType.CONSUMPTION:
      return ApiHelpers.table("ConsumptionEvent_0_0");
    case MetricType.STORAGE:
      return ApiHelpers.table("TopicToOLAPEvent_0_0");
    case MetricType.PROCESSING:
      return ApiHelpers.table("StreamingFunctionEvent_0_0");
    case MetricType.INGESTION:
      return ApiHelpers.table("IngestEvent_0_0");
  }
}

const query = sql`SELECT * FROM ${getTableName(metric)} WHERE orgId = ${orgId}`;
```

**ConsumptionHelpers for model-backed identifiers:**

```typescript
import { ConsumptionHelpers, sql } from "@514labs/moose-lib";

// Safe: ConsumptionHelpers.column() references columns from a known model
function createFilter({ property, value, operator }: FilterInput) {
  switch (operator) {
    case "=":
      return sql`${ConsumptionHelpers.column(property)} = ${value}`;
    case "LIKE":
      return sql`${ConsumptionHelpers.column(property)} ILIKE ${`%${value}%`}`;
    case ">=":
      return sql`${ConsumptionHelpers.column(property)} >= ${value}`;
    default:
      return sql`${ConsumptionHelpers.column(property)} = ${value}`;
  }
}

// Safe: ConsumptionHelpers.table() for model-backed table names
const query = sql`SELECT * FROM ${ConsumptionHelpers.table(metricName)}`;
```

**When to use which helper:**
- `ApiHelpers` — general-purpose, works with any identifier string
- `ConsumptionHelpers` — model-specific, validates against the model's column/table definitions

**Key points:**
- `sql` tag parameterizes values, NOT identifiers
- Always use `ApiHelpers.column()` or `ConsumptionHelpers.column()` for dynamic column names
- Always use `ApiHelpers.table()` or `ConsumptionHelpers.table()` for dynamic table names
- Combine with allow-lists (see `sql-allow-list-dynamics`) to constrain which identifiers are valid

Reference: [MooseStack API Documentation](https://docs.fiveonefour.com/moosestack)
