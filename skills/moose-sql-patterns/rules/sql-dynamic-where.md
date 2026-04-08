---
title: Build Dynamic WHERE Clauses with Sql Arrays and joinQueries
impact: HIGH
impactDescription: "Prevents malformed SQL from manual fragment stitching; scales cleanly with optional filters"
tags: [sql, dynamic-query, where-clause, moosestack]
---

## Build Dynamic WHERE Clauses with Sql Arrays and joinQueries

**Impact: HIGH**

When a query has optional filters, accumulate conditions as a `Sql[]` array and combine them with `joinQueries`. Never manually stitch `sql` fragments with conditional AND/OR glue — it produces fragile code that breaks when filter combinations change.

**Incorrect (manual fragment stitching):**

```typescript
import { sql } from "@514labs/moose-lib";

// FRAGILE: manual AND glue breaks when filters are optional
const userFilter = user ? sql`data_name = ${user}` : sql``;
const sessionFilter = session_type ? sql`session_type = ${session_type}` : sql``;
const sessionAnd = user && session_type ? sql` AND ` : sql``;
const wherePrefix = user || session_type ? sql`WHERE ` : sql``;

// If only sessionFilter is present, this produces: WHERE  AND session_type = '...'
const filter = sql`${wherePrefix} ${userFilter} ${sessionAnd} ${sessionFilter}`;
```

**Correct (Sql[] array + joinQueries):**

```typescript
import { sql, joinQueries, Sql } from "@514labs/moose-lib";

// Clean: accumulate conditions, joinQueries handles separators
const filters: Sql[] = [];

if (user) filters.push(sql`data_name = ${user}`);
if (session_type) filters.push(sql`session_type = ${session_type}`);
if (workoutName) filters.push(sql`workoutname = ${workoutName}`);

const whereClause = filters.length > 0
  ? joinQueries({ prefix: "WHERE ", values: filters, separator: " AND " })
  : sql``;

const query = sql`
  SELECT * FROM SessionActivity_0_0
  ${whereClause}
  ORDER BY timestamp DESC
`;
```

**Building complex filter groups (AND + OR):**

```typescript
import { sql, joinQueries, Sql } from "@514labs/moose-lib";

function buildBaseFilters(
  orgId: string,
  projectId: string,
  startTime: string,
  endTime: string,
  severityLevels: string | undefined,
  search: string | undefined,
): Sql[] {
  const filters: Sql[] = [];

  // Required filters — always present
  filters.push(sql`orgId = ${orgId}`);
  filters.push(sql`projectId = ${projectId}`);
  filters.push(sql`timestamp >= parseDateTime64BestEffort(${startTime}, 3)`);
  filters.push(sql`timestamp <= parseDateTime64BestEffort(${endTime}, 3)`);

  // Optional severity filter — OR group within AND chain
  if (severityLevels) {
    const levels = severityLevels.split(",").map((l) => l.trim().toUpperCase());
    const conditions: Sql[] = levels
      .filter((l) => SEVERITY_RANGES[l])
      .map((l) => {
        const [min, max] = SEVERITY_RANGES[l];
        return sql`(severityNumber >= ${min} AND severityNumber <= ${max})`;
      });

    if (conditions.length > 0) {
      filters.push(
        joinQueries({ prefix: "(", values: conditions, separator: " OR ", suffix: ")" })
      );
    }
  }

  // Optional search filter
  if (search && search.trim()) {
    filters.push(sql`body ILIKE ${"%" + search.trim() + "%"}`);
  }

  return filters;
}

// Combine all filters
const filters = buildBaseFilters(orgId, projectId, startTime, endTime, severity, search);
const whereClause = joinQueries({ prefix: "WHERE ", values: filters, separator: " AND " });

const query = sql`
  SELECT * FROM ${runtimeLogsTable}
  ${whereClause}
  ORDER BY timestamp DESC
  LIMIT ${limit} OFFSET ${offset}
`;
```

**joinQueries API:**

```typescript
joinQueries({
  prefix: "WHERE ",     // Prepended before first value (only if values is non-empty)
  values: filters,      // Sql[] array of conditions
  separator: " AND ",   // Inserted between each value
  suffix: ")",          // Appended after last value (optional)
})
```

**Key points:**
- Always accumulate conditions as `Sql[]`, never stitch fragments with conditional glue
- `joinQueries` handles empty arrays gracefully — no dangling WHERE or AND
- Use nested `joinQueries` for OR groups inside an AND chain
- Return `Sql[]` from helper functions so callers can compose filters
- The `prefix` is only added when `values` is non-empty

Reference: [MooseStack API Documentation](https://docs.fiveonefour.com/moosestack)
