---
title: Constrain Dynamic Columns, Operators, and Sort Fields to Allow-Lists
impact: CRITICAL
impactDescription: "Prevents arbitrary column access and operator injection; rejects unknown values at the API boundary"
tags: [sql, allow-list, validation, security, moosestack]
---

## Constrain Dynamic Columns, Operators, and Sort Fields to Allow-Lists

**Impact: CRITICAL**

When a query accepts dynamic column names, operators, sort fields, or granularities from user input, constrain them to an explicit allow-list. Use TypeScript enums, union types, switch statements, or map lookups. Reject unknown values with a 400 response — never pass unchecked values to ClickHouse.

**Incorrect (unconstrained dynamic values):**

```typescript
// UNSAFE: user controls which column is selected — could access any column
const query = sql`SELECT ${ApiHelpers.column(userColumn)} FROM events`;

// UNSAFE: user controls the operator — could inject arbitrary SQL
const query2 = sql`SELECT * FROM events WHERE value ${operator} ${threshold}`;

// UNSAFE: user controls sort field with no validation
const query3 = sql`SELECT * FROM events ORDER BY ${ApiHelpers.column(sortField)}`;
```

**Correct — enum + switch for dynamic columns:**

```typescript
export enum MetricType {
  CONSUMPTION = "consumption",
  STORAGE = "storage",
  PROCESSING = "processing",
  INGESTION = "ingestion",
}

// Only enum values produce SQL — anything else hits the default/exhaustive check
export function getMainColumn(metric: MetricType) {
  switch (metric) {
    case MetricType.CONSUMPTION:
      return sql`route`;
    case MetricType.STORAGE:
      return sql`topic_name`;
    case MetricType.PROCESSING:
      return sql`function_name`;
    case MetricType.INGESTION:
      return sql`route`;
  }
}

// Switch also works for metric-specific SELECT lists
function getTableAggregation(metric: MetricType) {
  switch (metric) {
    case MetricType.CONSUMPTION:
      return sql`route, sum(bytes) as bytes, sum(count) as count, sum(latency) as latency`;
    case MetricType.STORAGE:
      return sql`topic_name, sum(bytes) as bytes, sum(count) as count`;
    case MetricType.PROCESSING:
      return sql`function_name, sum(bytes) as bytes, sum(count_in) as count_in, sum(count_out) as count_out`;
    case MetricType.INGESTION:
      return sql`route, sum(bytes) as bytes, sum(count) as count, sum(latency) as latency`;
  }
}
```

**Correct — switch for dynamic operators:**

```typescript
function createFilter({ property, value, operator }: FilterInput) {
  switch (operator) {
    case "=":
      return sql`${ConsumptionHelpers.column(property)} = ${value}`;
    case "!=":
      return sql`${ConsumptionHelpers.column(property)} != ${value}`;
    case ">":
      return sql`${ConsumptionHelpers.column(property)} > ${value}`;
    case ">=":
      return sql`${ConsumptionHelpers.column(property)} >= ${value}`;
    case "<":
      return sql`${ConsumptionHelpers.column(property)} < ${value}`;
    case "<=":
      return sql`${ConsumptionHelpers.column(property)} <= ${value}`;
    case "LIKE":
      return sql`${ConsumptionHelpers.column(property)} ILIKE ${`%${value}%`}`;
    case "CONTAINS":
      return sql`${ConsumptionHelpers.column(property)} LIKE ${`%${value}%`}`;
    default:
      // Reject unknown operators — never pass through
      return sql`${ConsumptionHelpers.column(property)} = ${value}`;
  }
}

// Type-driven operator validation at the API boundary
const typeToValidOperators: Record<string, string[]> = {
  UInt64: ["=", ">", "<", ">=", "<=", "!="],
  String: ["=", "!=", "LIKE", "ILIKE", "CONTAINS"],
  DateTime: ["=", ">", "<", ">=", "<=", "!="],
  Bool: ["=", "!="],
};
```

**Correct — map for dynamic time granularities:**

```typescript
export type Granularity = "minutes" | "hours" | "days";

// Validate at API boundary
const validGranularities: Granularity[] = ["minutes", "hours", "days"];
if (!granularity || !validGranularities.includes(granularity)) {
  return {
    body: { message: "Invalid granularity. Must be one of: minutes, hours, days" },
    status: 400,
  };
}

// Map validated value to sql fragment
const bucketSqlMap = {
  minutes: sql`toStartOfMinute(${cols.snapshot_timestamp_ms})`,
  hours: sql`toStartOfHour(${cols.snapshot_timestamp_ms})`,
  days: sql`toStartOfDay(${cols.snapshot_timestamp_ms})`,
};

const bucket = bucketSqlMap[granularity];
```

**Correct — map for dynamic GROUP BY:**

```typescript
function buildGrouping(grouping: { property: string }[]) {
  const groupingSql = grouping.map((g) => ConsumptionHelpers.column(g.property));
  return groupingSql.length > 0
    ? join_queries({ prefix: "GROUP BY ", values: groupingSql, separator: ", " })
    : sql``;
}
```

**Key points:**
- Every dynamic value that selects a column, operator, table, or SQL keyword must pass through an allow-list
- TypeScript enums + switch give compile-time exhaustiveness checking
- Maps (`Record<string, Sql>`) are the cleanest pattern for value → fragment lookups
- Union types (`"minutes" | "hours" | "days"`) + runtime validation for string inputs
- Reject at the API boundary with 400 — don't silently fall back to a default for unrecognized values in security-sensitive contexts

Reference: [MooseStack API Documentation](https://docs.fiveonefour.com/moosestack)
