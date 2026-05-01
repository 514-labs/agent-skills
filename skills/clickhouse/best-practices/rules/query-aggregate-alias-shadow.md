---
title: Avoid Aggregate Aliases That Shadow Source Columns in WHERE
impact: HIGH
impactDescription: "Prevents ILLEGAL_AGGREGATION errors at runtime"
tags: [query, aggregation, alias, CTE]
---

## Avoid Aggregate Aliases That Shadow Source Columns in WHERE

**Impact: HIGH**

When a SELECT aliases an aggregate to the same name as a source column (e.g., `any(category) AS category`), the alias *shadows* the column inside that SELECT. A `WHERE category = ...` on the same SELECT resolves to the alias — the aggregate result — and ClickHouse raises:

> Code: 184. DB::Exception: Aggregate function any(category) AS category is found in WHERE in query.

This is a runtime resolution error, so type checking and PR review usually miss it. Move the filter to a context where the column reference is unambiguous.

**Incorrect (filter on aggregate-aliased column in same SELECT):**

```sql
-- The WHERE-side `category` resolves to `any(category) AS category` (the aggregate),
-- not the underlying column. ClickHouse raises ILLEGAL_AGGREGATION.
WITH inv AS (
    SELECT
        product_id,
        any(category) AS category,
        sum(stock_qty) AS stock_qty
    FROM inventory
    WHERE category NOT IN ('Trials', 'Samples')
    GROUP BY product_id
)
SELECT * FROM inv;
```

**Correct (filter in a downstream CTE where the alias is a plain projection):**

```sql
WITH inv AS (
    SELECT
        product_id,
        any(category) AS category,
        sum(stock_qty) AS stock_qty
    FROM inventory
    GROUP BY product_id
),
cleaned AS (
    SELECT *
    FROM inv
    WHERE category NOT IN ('Trials', 'Samples')
)
SELECT * FROM cleaned;
```

**Also correct (push filter into a subquery before the aggregate):**

```sql
WITH inv AS (
    SELECT
        product_id,
        any(category) AS category,
        sum(stock_qty) AS stock_qty
    FROM (
        SELECT *
        FROM inventory
        WHERE category NOT IN ('Trials', 'Samples')
    )
    GROUP BY product_id
)
SELECT * FROM inv;
```

**Also correct (use HAVING to filter the aggregated result):**

```sql
-- HAVING is evaluated after aggregation, so the alias is the right reference.
-- Note: HAVING filters AFTER aggregation runs, so it is slightly less efficient
-- than filtering before; prefer the subquery form for large inputs.
WITH inv AS (
    SELECT
        product_id,
        any(category) AS category,
        sum(stock_qty) AS stock_qty
    FROM inventory
    GROUP BY product_id
    HAVING category NOT IN ('Trials', 'Samples')
)
SELECT * FROM inv;
```

**Also correct (rename the alias so it doesn't shadow):**

```sql
-- If you control the alias, simply giving the aggregate a distinct name
-- removes the collision entirely.
WITH inv AS (
    SELECT
        product_id,
        any(category) AS category_first,
        sum(stock_qty) AS stock_qty
    FROM inventory
    WHERE category NOT IN ('Trials', 'Samples')
    GROUP BY product_id
)
SELECT * FROM inv;
```

**MooseStack - Apply this pattern in API query handlers:**

When an API query builds CTEs that fan in through `any()` / `argMax()` / `groupArray()` aggregates and the caller passes a filter on one of those columns, route the filter to a downstream CTE. This keeps the filter optional (toggle-able) and avoids the alias collision.

```typescript
import { Api } from "@514labs/moose-lib";

interface Params {
  excludeCategories?: string[];
}

const stockReportApi = new Api<Params, Result[]>(
  "stock-report",
  async (params, { client }) => {
    const exclusions = params.excludeCategories ?? [];
    // Bind the filter to the downstream CTE where `inv.category` is a plain
    // column reference, not the `any(category) AS category` alias.
    const categoryFilter = exclusions.length
      ? `AND inv.category NOT IN ({categories: Array(String)})`
      : "";

    const query = `
      WITH inv AS (
        SELECT
          product_id,
          any(category) AS category,
          sum(stock_qty) AS stock_qty
        FROM inventory
        GROUP BY product_id
      ),
      cleaned AS (
        SELECT *
        FROM inv
        WHERE 1=1 ${categoryFilter}
      )
      SELECT * FROM cleaned
    `;
    return client.query(query, { categories: exclusions });
  }
);
```

```python
from moose_lib import Api
from pydantic import BaseModel

class Params(BaseModel):
    exclude_categories: list[str] = []

async def stock_report_handler(params: Params, ctx):
    # Bind the filter to the downstream CTE where `inv.category` is a plain
    # column reference, not the `any(category) AS category` alias.
    category_filter = (
        "AND inv.category NOT IN ({categories: Array(String)})"
        if params.exclude_categories else ""
    )
    query = f"""
      WITH inv AS (
        SELECT
          product_id,
          any(category) AS category,
          sum(stock_qty) AS stock_qty
        FROM inventory
        GROUP BY product_id
      ),
      cleaned AS (
        SELECT *
        FROM inv
        WHERE 1=1 {category_filter}
      )
      SELECT * FROM cleaned
    """
    return await ctx.client.query(query, {"categories": params.exclude_categories})

stock_report_api = Api[Params, list]("stock-report", stock_report_handler)
```

Reference: [ClickHouse — Aggregate Functions and GROUP BY](https://clickhouse.com/docs/sql-reference/aggregate-functions)
