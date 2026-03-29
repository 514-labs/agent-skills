---
title: Choose the Right MV Strategy for Your Source Topology
impact: HIGH
impactDescription: "Wrong strategy creates unnecessary complexity or misses optimization opportunities"
tags: [materialized-view, strategy, architecture]
---

## Choose the Right MV Strategy for Your Source Topology

**Impact: HIGH**

The relationship between source tables and serving tables determines the MV topology. Choosing the wrong strategy creates unnecessary complexity or forces runtime JOINs/UNIONs that defeat the purpose of pre-aggregation.

**Strategy Decision Matrix:**

| Strategy | Source Tables | Serving Tables | When to Use |
|----------|-------------|----------------|-------------|
| **Fan-in** | Many → | One | Independent sources share a common query shape. Avoids runtime UNION. |
| **Fan-out** | One → | Many | One source serves multiple query patterns with different grains. |
| **Cascade** | One → One → | One | Multi-level aggregation (raw → hourly → daily). |
| **Single** | One → | One | Simple case: one source, one query shape. |

**Incorrect (using UNION ALL at query time):**

```sql
-- Runtime UNION across 4 source tables on every dashboard load
SELECT 'consumption' AS metric, route, sum(bytes) AS bytes
FROM ConsumptionEvent_0_0 WHERE ...
GROUP BY route
UNION ALL
SELECT 'storage' AS metric, topic_name, sum(bytes) AS bytes
FROM TopicToOLAPEvent_0_0 WHERE ...
GROUP BY topic_name
UNION ALL
-- ... 2 more branches
-- Scans all 4 raw tables every time
```

**Correct (fan-in with one MV per source):**

```sql
-- One serving table, 4 MVs that write at insert time
-- No UNION needed at query time — all data is pre-merged

-- MV 1: consumption events → serving table
CREATE MATERIALIZED VIEW ConsumptionMV TO MetricTableServing AS
SELECT toStartOfInterval(timestamp, INTERVAL 1 second) AS bucket_start,
       orgId, projectId, branchId, 'consumption' AS metric,
       route, '' AS topic_name, '' AS function_name,
       sum(bytes) AS bytes, sum(count) AS count, sum(latency) AS latency,
       0 AS count_in, 0 AS count_out
FROM ConsumptionEvent_0_0
GROUP BY bucket_start, orgId, projectId, branchId, route;

-- MV 2, 3, 4: similar pattern for other sources
-- Query is now a simple scan of the serving table
```

**MooseStack - Fan-in with Multiple MaterializedViews:**

```typescript
import { MaterializedView, OlapTable, sql } from "@514labs/moose-lib";
import { ConsumptionEventPipeline } from "../ingest/consumption-event.ingest";
import { IngestEventPipeline } from "../ingest/ingest-event.ingest";

// One serving table
export const MetricTableServing = new OlapTable<MetricTableServingRow>(
  "MetricTableServing",
  { orderByFields: ["orgId", "projectId", "branchId", "metric", "bucket_start"] }
);

// One MV per source — fan-in topology
export const ConsumptionMV = new MaterializedView<MetricTableServingRow>({
  materializedViewName: "MetricTableServingConsumptionMV",
  targetTable: MetricTableServing,
  selectTables: [ConsumptionEventPipeline.table! as any],
  selectStatement: sql`
    SELECT toStartOfInterval(timestamp, INTERVAL 1 second) AS bucket_start,
           orgId, projectId, branchId, 'consumption' AS metric,
           route, '' AS topic_name, '' AS function_name,
           sum(toFloat64(bytes)) AS bytes, sum(toFloat64(count)) AS count,
           sum(toFloat64(latency)) AS latency,
           toFloat64(0) AS count_in, toFloat64(0) AS count_out
    FROM ConsumptionEvent_0_0
    GROUP BY bucket_start, orgId, projectId, branchId, route
  `,
});
```

```python
from moose_lib import MaterializedView, OlapTable, sql

# One serving table
metric_table_serving = OlapTable(
    "MetricTableServing",
    order_by_fields=["orgId", "projectId", "branchId", "metric", "bucket_start"]
)

# One MV per source — fan-in topology
consumption_mv = MaterializedView(
    name="MetricTableServingConsumptionMV",
    target_table=metric_table_serving,
    select_tables=[consumption_event_pipeline.table],
    select_statement=sql("""
        SELECT toStartOfInterval(timestamp, INTERVAL 1 second) AS bucket_start,
               orgId, projectId, branchId, 'consumption' AS metric,
               route, '' AS topic_name, '' AS function_name,
               sum(toFloat64(bytes)) AS bytes, sum(toFloat64(count)) AS count,
               sum(toFloat64(latency)) AS latency,
               toFloat64(0) AS count_in, toFloat64(0) AS count_out
        FROM ConsumptionEvent_0_0
        GROUP BY bucket_start, orgId, projectId, branchId, route
    """),
)
```

Reference: [Use Materialized Views](https://clickhouse.com/docs/best-practices/use-materialized-views)
