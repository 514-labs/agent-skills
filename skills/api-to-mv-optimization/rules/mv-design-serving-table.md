---
title: Design the Serving Table Grain and ORDER BY from Access Patterns
impact: CRITICAL
impactDescription: "Correct grain and key ordering enables index-only scans; wrong choices force full table scans"
tags: [materialized-view, serving-table, order-by, schema]
---

## Design the Serving Table Grain and ORDER BY from Access Patterns

**Impact: CRITICAL**

The serving table's grain (what one row represents) and ORDER BY key determine whether queries hit the sparse index or scan the entire table. Both must be derived directly from the API's access patterns.

**Grain rule:** one row per `(tenant dimensions, metric type, time bucket, dimension value)`.

**ORDER BY rule:** equality filters first (in descending cardinality order among frequently-filtered columns), then time, then search/group-by dimensions.

**Incorrect (arbitrary ORDER BY):**

```sql
CREATE TABLE MetricTableServing (
  bucket_start DateTime,
  orgId String,
  metric String,
  route String,
  bytes Float64
) ENGINE = MergeTree()
ORDER BY (bucket_start, orgId);
-- Time first means orgId filter skips nothing
-- Missing projectId, branchId → no tenant isolation at index level
```

**Correct (filter-aligned ORDER BY):**

```sql
CREATE TABLE MetricTableServing (
  bucket_start DateTime,
  orgId String,
  projectId String,
  branchId String,
  metric String,
  route String,
  topic_name String,
  function_name String,
  bytes Float64,
  count Float64,
  latency Float64,
  count_in Float64,
  count_out Float64
) ENGINE = MergeTree()
ORDER BY (orgId, projectId, branchId, metric, bucket_start,
          route, topic_name, function_name);
-- Equality filters (org/project/branch/metric) first → sparse index prunes most granules
-- Time next → range scan within tenant+metric partition
-- Dimension columns last → ILIKE search benefits from locality
```

**MooseStack - OlapTable with Filter-Aligned ORDER BY:**

```typescript
import { OlapTable, ClickHouseEngines } from "@514labs/moose-lib";

export interface MetricTableServingRow {
  bucket_start: Date;
  orgId: string;
  projectId: string;
  branchId: string;
  metric: string;
  route: string;
  topic_name: string;
  function_name: string;
  bytes: number;
  count: number;
  latency: number;
  count_in: number;
  count_out: number;
}

export const MetricTableServing = new OlapTable<MetricTableServingRow>(
  "MetricTableServing",
  {
    // Equality filters first, then time, then search dimensions
    orderByFields: [
      "orgId", "projectId", "branchId", "metric",
      "bucket_start",
      "route", "topic_name", "function_name",
    ],
    // Immutable rollups are append-only; MergeTree is sufficient
    engine: ClickHouseEngines.MergeTree,
  }
);
```

```python
from moose_lib import OlapTable
from pydantic import BaseModel

class MetricTableServingRow(BaseModel):
    bucket_start: datetime
    orgId: str
    projectId: str
    branchId: str
    metric: str
    route: str
    topic_name: str
    function_name: str
    bytes: float
    count: float
    latency: float
    count_in: float
    count_out: float

metric_table_serving = OlapTable[MetricTableServingRow](
    "MetricTableServing",
    order_by_fields=[
        "orgId", "projectId", "branchId", "metric",
        "bucket_start",
        "route", "topic_name", "function_name",
    ],
    engine="MergeTree",
)
```

Reference: [Select the Best Primary Key](https://clickhouse.com/docs/best-practices/select-the-best-primary-key)
