---
title: Pre-Aggregate at Write Time with Time Bucketing
impact: CRITICAL
impactDescription: "Shifts O(billions) read-time scans to O(1) per-insert aggregation; dashboard queries read thousands of rows"
tags: [materialized-view, aggregation, performance, time-bucket]
---

## Pre-Aggregate at Write Time with Time Bucketing

**Impact: CRITICAL**

MaterializedViews execute their SELECT on each inserted block, writing pre-aggregated results to the target table. This shifts expensive aggregation from read time (every dashboard load) to write time (once per insert batch). The serving table stores rollups at a chosen time granularity.

**Incorrect (aggregating raw data at read time):**

```sql
-- Every dashboard load scans billions of raw events
SELECT route, sum(bytes), sum(count), sum(latency)
FROM ConsumptionEvent_0_0
WHERE timestamp >= now() - INTERVAL 7 DAY
  AND orgId = 'org123'
GROUP BY route;
-- ~500ms-2s per query, scaling with data volume
```

**Correct (read pre-aggregated serving table):**

```sql
-- MV pre-aggregates at write time into per-second buckets
CREATE MATERIALIZED VIEW ConsumptionMV TO MetricTableServing AS
SELECT
  toStartOfInterval(timestamp, INTERVAL 1 second) AS bucket_start,
  orgId, projectId, branchId, 'consumption' AS metric,
  route, '' AS topic_name, '' AS function_name,
  sum(toFloat64(bytes)) AS bytes,
  sum(toFloat64(count)) AS count,
  sum(toFloat64(latency)) AS latency,
  toFloat64(0) AS count_in, toFloat64(0) AS count_out
FROM ConsumptionEvent_0_0
GROUP BY bucket_start, orgId, projectId, branchId, route;

-- Dashboard query now reads thousands of pre-aggregated rows
SELECT route, sum(bytes), sum(count), sum(latency)
FROM MetricTableServing
WHERE bucket_start >= fromUnixTimestamp(?) AND bucket_start <= fromUnixTimestamp(?)
  AND metric = 'consumption' AND orgId = 'org123'
GROUP BY route;
-- ~5-20ms, independent of raw data volume
```

**Choosing the time bucket:**

| Bucket | Rows per Day (per metric+tenant) | Use Case |
|--------|----------------------------------|----------|
| 1 second | ~86,400 | High-resolution dashboards, short time ranges |
| 1 minute | ~1,440 | Standard dashboards, medium time ranges |
| 1 hour | ~24 | Long-term trends, wide time ranges |

Start with per-second buckets. If the serving table grows too large, cascade to coarser buckets with a second MV layer.

**MooseStack - Time-Bucketed MV:**

```typescript
import { MaterializedView, sql } from "@514labs/moose-lib";

export const ConsumptionMV = new MaterializedView<MetricTableServingRow>({
  materializedViewName: "MetricTableServingConsumptionMV",
  targetTable: MetricTableServing,
  selectTables: [ConsumptionEventPipeline.table! as any],
  selectStatement: sql`
    SELECT
      toStartOfInterval(timestamp, INTERVAL 1 second) AS bucket_start,
      orgId, projectId, branchId,
      'consumption' AS metric,
      route,
      '' AS topic_name,
      '' AS function_name,
      sum(toFloat64(bytes)) AS bytes,
      sum(toFloat64(count)) AS count,
      sum(toFloat64(latency)) AS latency,
      toFloat64(0) AS count_in,
      toFloat64(0) AS count_out
    FROM ConsumptionEvent_0_0
    GROUP BY bucket_start, orgId, projectId, branchId, route
  `,
});
```

```python
from moose_lib import MaterializedView, sql

consumption_mv = MaterializedView(
    name="MetricTableServingConsumptionMV",
    target_table=metric_table_serving,
    select_tables=[consumption_event_pipeline.table],
    select_statement=sql("""
        SELECT
          toStartOfInterval(timestamp, INTERVAL 1 second) AS bucket_start,
          orgId, projectId, branchId,
          'consumption' AS metric,
          route,
          '' AS topic_name,
          '' AS function_name,
          sum(toFloat64(bytes)) AS bytes,
          sum(toFloat64(count)) AS count,
          sum(toFloat64(latency)) AS latency,
          toFloat64(0) AS count_in,
          toFloat64(0) AS count_out
        FROM ConsumptionEvent_0_0
        GROUP BY bucket_start, orgId, projectId, branchId, route
    """),
)
```

Reference: [Use Materialized Views](https://clickhouse.com/docs/best-practices/use-materialized-views)
