---
title: Validate and Parse All Inputs Before SQL Interpolation
impact: HIGH
impactDescription: "Prevents NaN propagation, JSON parse crashes, and empty-string queries that return unexpected results"
tags: [sql, validation, input-parsing, moosestack]
---

## Validate and Parse All Inputs Before SQL Interpolation

**Impact: HIGH**

User inputs arrive as strings from query parameters. Parse them to their target type, validate the result, and reject invalid inputs with a 400 response *before* they reach the `sql` tag. The `sql` tag prevents injection, but it cannot prevent logical errors from NaN, undefined, or malformed data.

**Incorrect (no validation before interpolation):**

```typescript
// BROKEN: parseInt without NaN check — NaN propagates to ClickHouse
sql`WHERE bucket_start >= fromUnixTimestamp(${parseInt(from)})`

// BROKEN: JSON.parse without try/catch — crashes on malformed input
const filters = JSON.parse(decodeURIComponent(rawFilters));

// BROKEN: parseInt without radix — octal/hex parsing in edge cases
sql`WHERE count >= ${parseInt(minCount)}`

// BROKEN: no JWT validation — undefined orgId produces WHERE orgId = undefined
sql`WHERE orgId = ${jwtPayload.data.orgId}`
```

**Correct — integer parsing:**

```typescript
const fromUnix = parseInt(from, 10);
const toUnix = parseInt(to, 10);

if (isNaN(fromUnix) || isNaN(toUnix)) {
  return {
    body: { message: "from and to must be valid unix timestamps" },
    status: 400,
  };
}

sql`WHERE bucket_start >= fromUnixTimestamp(${fromUnix})
    AND bucket_start <= fromUnixTimestamp(${toUnix})`
```

**Correct — JSON parsing:**

```typescript
let attributeFilters: LogAttributeFilter[];
try {
  attributeFilters = JSON.parse(logAttributes);
  if (!Array.isArray(attributeFilters)) {
    return { body: { message: "filters must be a JSON array" }, status: 400 };
  }
} catch (e) {
  return { body: { message: "Invalid JSON in filters parameter" }, status: 400 };
}

// Now safe to iterate and build sql fragments
for (const filter of attributeFilters) {
  if (filter.key && typeof filter.key === "string") {
    if (filter.values && Array.isArray(filter.values) && filter.values.length > 0) {
      const valueFilters: Sql[] = [];
      for (const value of filter.values) {
        if (typeof value === "string" && value.length > 0) {
          valueFilters.push(
            sql`JSONExtractString(toString(logAttributes), ${filter.key}) = ${value}`
          );
        }
      }
      if (valueFilters.length > 0) {
        filters.push(
          joinQueries({ prefix: "(", values: valueFilters, separator: " OR ", suffix: ")" })
        );
      }
    }
  }
}
```

**Correct — JWT tenant dimensions:**

```typescript
const jwtPayload = JSON.parse(JSON.stringify(jwt)) as BorealJWTPayload;

if (!jwtPayload.data.orgId || !jwtPayload.data.projectId || !jwtPayload.data.branchId) {
  return {
    body: { message: "Missing required JWT payload data" },
    status: 401,
  };
}

const orgId = jwtPayload.data.orgId;
const projectId = jwtPayload.data.projectId;
const branchId = jwtPayload.data.branchId;

// Tenant isolation filters — always include in WHERE clause
filters.push(sql`orgId = ${orgId}`);
filters.push(sql`projectId = ${projectId}`);
filters.push(sql`branchId = ${branchId}`);
```

**Correct — string inputs for ILIKE:**

```typescript
// Trim and check before building wildcard pattern
if (search && search.trim()) {
  const searchTerm = "%" + search.trim() + "%";
  filters.push(sql`body ILIKE ${searchTerm}`);
}
// If search is empty/whitespace, no filter is added — not a broken ILIKE '%  %'
```

**Validation checklist:**

| Input Type | Parse | Validate | Reject With |
|-----------|-------|----------|-------------|
| Unix timestamp | `parseInt(value, 10)` | `isNaN()` | 400 |
| JSON body/params | `JSON.parse()` in try/catch | `Array.isArray()`, type checks | 400 |
| Enum/union string | — | `includes()` or switch | 400 |
| JWT tenant dims | extract from payload | check for presence | 401 |
| Search string | `.trim()` | `.length > 0` | skip filter |
| Pagination (limit/offset) | `parseInt(value, 10)` | `isNaN()`, range check | 400 with defaults |

**Key points:**
- Parse and validate *before* the `sql` tag — the tag prevents injection but not logic errors
- Always use radix 10 in `parseInt(value, 10)` — omitting radix is a subtle bug source
- JWT tenant dimensions are authorization boundaries — return 401 (not 400) when missing
- Empty/whitespace search strings should skip the filter entirely, not produce `ILIKE '%%'`
- Pagination values need range bounds — don't let users request `LIMIT 999999999`

Reference: [MooseStack API Documentation](https://docs.fiveonefour.com/moosestack)
