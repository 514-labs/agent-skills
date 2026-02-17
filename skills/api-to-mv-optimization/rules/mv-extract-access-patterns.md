---
title: Extract Access Patterns from the API Query
impact: CRITICAL
impactDescription: "Serving table design that misses a filter or group-by forces a full redesign"
tags: [materialized-view, access-patterns, analysis]
---

## Extract Access Patterns from the API Query

**Impact: CRITICAL**

The serving table's grain, ORDER BY, and MV SELECT are all derived from the API's access patterns. Missing a filter or group-by column means the serving table cannot satisfy the query, forcing a redesign.

**Incorrect (designing from intuition):**

```sql
-- Guessing at which columns matter
CREATE TABLE serving (
  timestamp DateTime,
  value Float64
) ENGINE = MergeTree()
ORDER BY timestamp;
-- Misses tenant filters → full table scans for every org
```

**Correct (systematic extraction):**

```sql
-- From the API query, extract:
-- 1. WHERE filters:
--    - time range: bucket_start >= from AND bucket_start <= to
--    - equality: orgId = ?, projectId = ?, branchId = ?, metric = ?
--    - search: dimension ILIKE '%search%'
-- 2. GROUP BY columns:
--    - metric-specific: route, topic_name, or function_name
-- 3. Aggregates:
--    - sum(bytes), sum(count), sum(latency), sum(count_in), sum(count_out)
-- 4. Per-metric branches (switch/case in the API):
--    - consumption → route + bytes/count/latency
--    - storage → topic_name + bytes/count
--    - processing → function_name + bytes/count_in/count_out
--    - ingestion → route + bytes/count/latency
```

**MooseStack - Analyzing an Api Handler:**

```typescript
// Given this API handler:
export const MetricTableEgress = new Api<QueryParams>(
  "metric_table",
  async ({ from, to, search, metric }, { client, sql, jwt }) => {
    // Extract from the handler:
    // 1. Filters from WHERE: time range (from/to), orgId, projectId, branchId, metric
    // 2. Search: ILIKE on metric-specific dimension column
    // 3. Group-by: route | topic_name | function_name (varies by metric)
    // 4. Aggregates: sum(bytes), sum(count), sum(latency), etc.

    // The switch(metric) block reveals per-branch access patterns:
    //   CONSUMPTION → GROUP BY route, SUM(bytes, count, latency)
    //   STORAGE     → GROUP BY topic_name, SUM(bytes, count)
    //   PROCESSING  → GROUP BY function_name, SUM(bytes, count_in, count_out)
    //   INGESTION   → GROUP BY route, SUM(bytes, count, latency)
  }
);
```

```python
# Given this API handler:
metric_table_egress = Api(
    "metric_table",
    handler=metric_table_handler,
)

# Extract from the handler:
# 1. Filters: time range, orgId, projectId, branchId, metric
# 2. Search: ILIKE on dimension column
# 3. Group-by: varies by metric type
# 4. Aggregates: sum(bytes), sum(count), etc.
```

Reference: [ClickHouse ORDER BY Optimization](https://clickhouse.com/docs/best-practices/select-the-best-primary-key)
