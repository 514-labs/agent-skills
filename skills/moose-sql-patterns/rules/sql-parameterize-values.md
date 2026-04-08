---
title: Use the sql Template Tag for All Value Interpolation
impact: CRITICAL
impactDescription: "Prevents SQL injection; the sql tag auto-escapes all interpolated values"
tags: [sql, parameterization, security, moosestack]
---

## Use the sql Template Tag for All Value Interpolation

**Impact: CRITICAL**

The `sql` template tag from `@514labs/moose-lib` automatically parameterizes interpolated values. Every value that enters a ClickHouse query must go through this tag. Never use string concatenation, template literals without `sql`, or manual escaping.

The `sql` tag is composable — `sql` fragments can be interpolated into other `sql` fragments, allowing you to build queries from reusable parts.

**Incorrect (string concatenation):**

```typescript
import { Api } from "@514labs/moose-lib";

// UNSAFE: string concatenation bypasses parameterization
const query = `SELECT * FROM events WHERE orgId = '${orgId}'`;

// UNSAFE: template literal without sql tag
const query2 = `SELECT * FROM events WHERE timestamp >= ${from}`;

// UNSAFE: building SQL strings with + operator
const whereClause = "WHERE orgId = '" + orgId + "'";
```

**Correct (sql template tag):**

```typescript
import { Api, sql } from "@514labs/moose-lib";

// Safe: values are parameterized automatically
const query = sql`SELECT * FROM events WHERE orgId = ${orgId}`;

// Safe: integer values are also parameterized
const query2 = sql`
  SELECT * FROM events
  WHERE bucket_start >= fromUnixTimestamp(${parseInt(from, 10)})
    AND bucket_start <= fromUnixTimestamp(${parseInt(to, 10)})
`;

// Safe: ILIKE wildcards work — the value is still parameterized
const searchTerm = "%" + search.trim() + "%";
const query3 = sql`SELECT * FROM events WHERE body ILIKE ${searchTerm}`;
```

**Composing sql fragments:**

```typescript
// sql fragments can be interpolated into other sql fragments
function getAggregation(metric: MetricType) {
  switch (metric) {
    case MetricType.CONSUMPTION:
      return sql`route, sum(bytes) as bytes, sum(count) as count`;
    case MetricType.STORAGE:
      return sql`topic_name, sum(bytes) as bytes, sum(count) as count`;
  }
}

// The fragment is safely composed into the outer query
const query = sql`
  SELECT ${getAggregation(metric)}
  FROM MetricTableServing
  WHERE metric = ${metric}
`;
```

**Key points:**
- Import `sql` from `@514labs/moose-lib`
- Use `sql\`...\`` for every query, even simple ones
- Values interpolated with `${}` are parameterized, not concatenated
- `sql` fragments compose: you can return `sql\`...\`` from functions and interpolate them
- String building (wildcards for ILIKE) happens *before* the `sql` tag — the final value is still parameterized

Reference: [MooseStack API Documentation](https://docs.fiveonefour.com/moosestack)
