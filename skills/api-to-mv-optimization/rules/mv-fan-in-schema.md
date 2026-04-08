---
title: Use Zero/Empty Defaults for Fan-In Union Schema
impact: HIGH
impactDescription: "Strict schema across fan-in MVs prevents insert failures and query mismatches"
tags: [materialized-view, fan-in, schema, union]
---

## Use Zero/Empty Defaults for Fan-In Union Schema

**Impact: HIGH**

When multiple MVs fan into one serving table, each MV's SELECT must produce the exact target schema. Columns that don't exist in a source branch must use explicit zero/empty defaults. Missing columns cause silent insert failures; type mismatches cause runtime errors.

**Incorrect (missing columns in fan-in MV):**

```sql
-- ConsumptionMV only selects columns it has — missing topic_name, function_name, count_in, count_out
CREATE MATERIALIZED VIEW ConsumptionMV TO MetricTableServing AS
SELECT toStartOfInterval(timestamp, INTERVAL 1 second) AS bucket_start,
       orgId, projectId, branchId, 'consumption' AS metric,
       route, sum(bytes) AS bytes, sum(count) AS count, sum(latency) AS latency
FROM ConsumptionEvent_0_0
GROUP BY bucket_start, orgId, projectId, branchId, route;
-- INSERT fails: column count mismatch with target table
```

**Correct (explicit defaults for all missing columns):**

```sql
CREATE MATERIALIZED VIEW ConsumptionMV TO MetricTableServing AS
SELECT toStartOfInterval(timestamp, INTERVAL 1 second) AS bucket_start,
       orgId, projectId, branchId, 'consumption' AS metric,
       route,
       '' AS topic_name,          -- not in consumption, default empty
       '' AS function_name,       -- not in consumption, default empty
       sum(toFloat64(bytes)) AS bytes,
       sum(toFloat64(count)) AS count,
       sum(toFloat64(latency)) AS latency,
       toFloat64(0) AS count_in,  -- not in consumption, default zero
       toFloat64(0) AS count_out  -- not in consumption, default zero
FROM ConsumptionEvent_0_0
GROUP BY bucket_start, orgId, projectId, branchId, route;
```

**Key points:**
- Use `''` for String columns not present in the source
- Use `toFloat64(0)` (or appropriate typed zero) for numeric columns
- Cast aggregates with `toFloat64()` to match the target column type exactly
- Column order in SELECT must match the target table's column order

**MooseStack - Fan-In MV with Typed Defaults:**

```typescript
import { MaterializedView, sql } from "@514labs/moose-lib";

// Consumption events have route, bytes, count, latency
// but NOT topic_name, function_name, count_in, count_out
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
