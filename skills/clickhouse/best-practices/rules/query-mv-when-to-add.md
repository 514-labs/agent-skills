---
title: When to Propose a Materialized View
impact: HIGH
impactDescription: "Reduces repeated full-table scans from billions of rows to thousands; query time from seconds to milliseconds"
tags: [query, materialized-view, optimization, detection]
---

## When to Propose a Materialized View

**Impact: HIGH**

The incremental and refreshable MV rules explain how to build materialized views. This rule explains **when to detect** that a slow query would benefit from one. Look for three signals during performance profiling:

**1. Aggregation over a large table:** A query with `GROUP BY` that scans millions or billions of rows using pre-aggregable functions (`count`, `uniq`, `sum`, `avg`, `min`, `max`, `quantile`). Common in dashboard endpoints and analytics APIs that recompute the same aggregation on every request.

**2. Complex joins with stable dimensions:** Multi-table JOINs where dimension tables (customers, products, categories) change infrequently. Repeating the join on every read is wasteful when the denormalized result could be refreshed periodically.

**3. High query frequency:** The same query template appears dozens or hundreds of times per hour in `system.query_log`. High frequency amplifies the benefit of pre-computation — even a moderate per-query improvement compounds into significant cluster savings.

**Decision matrix:**

| Signal | Recommended MV Type | Alternative to Consider First |
|--------|---------------------|-------------------------------|
| `GROUP BY` over large table, real-time data needed | Incremental MV with `AggregatingMergeTree` | Improve ORDER BY key order, add skipping index |
| Complex multi-table JOIN, staleness acceptable | Refreshable MV on a schedule | Dictionary for small dimensions, denormalized schema |
| Simple filter/sort slow due to full scan | Not an MV case | Fix ORDER BY, add skipping index |

**Trade-offs to weigh before proposing:**

- **Insert overhead:** Incremental MVs add processing at insert time — measure insert throughput if the table has high write volume
- **Staleness:** Refreshable MVs serve data up to one refresh interval old — confirm the use case tolerates this
- **Storage cost:** The target table duplicates data in aggregated or denormalized form
- **Backfill:** Incremental MVs only process rows inserted after creation — historical data requires a manual `INSERT INTO ... SELECT` backfill

**Incorrect (repeated full aggregation with no MV considered):**

```sql
-- Dashboard endpoint: runs on every page load, scans 2B rows each time
SELECT
    project_id,
    toStartOfDay(timestamp) AS day,
    count() AS total_events,
    uniq(user_id) AS unique_users,
    avg(duration_ms) AS avg_duration
FROM events
WHERE timestamp >= now() - INTERVAL 30 DAY
GROUP BY project_id, day
ORDER BY day;
-- system.query_log: read_rows=2,147,483,648  query_duration_ms=12400
-- Executed 50+ times/hour from the analytics dashboard
```

**Correct (detect the pattern and propose an incremental MV):**

```sql
-- Detection reasoning:
-- 1. GROUP BY over 2B+ rows (aggregation pattern)
-- 2. Uses count(), uniq(), avg() — all support -State/-Merge
-- 3. Executed 50+/hour with the same template (high frequency)
-- 4. Real-time data needed (rules out refreshable MV)
-- => Propose incremental MV with AggregatingMergeTree target

-- Target table for pre-aggregated data
CREATE TABLE events_daily_agg (
    project_id UInt64,
    day DateTime,
    total_events AggregateFunction(count),
    unique_users AggregateFunction(uniq, UInt64),
    avg_duration AggregateFunction(avg, Float64)
) ENGINE = AggregatingMergeTree()
ORDER BY (project_id, day);

-- Incremental MV — processes new inserts automatically
CREATE MATERIALIZED VIEW events_daily_agg_mv TO events_daily_agg AS
SELECT
    project_id,
    toStartOfDay(timestamp) AS day,
    countState() AS total_events,
    uniqState(user_id) AS unique_users,
    avgState(duration_ms) AS avg_duration
FROM events
GROUP BY project_id, day;

-- Backfill existing data (one-time operation after MV creation)
INSERT INTO events_daily_agg
SELECT
    project_id,
    toStartOfDay(timestamp) AS day,
    countState() AS total_events,
    uniqState(user_id) AS unique_users,
    avgState(duration_ms) AS avg_duration
FROM events
GROUP BY project_id, day;

-- New dashboard query: reads thousands of rows instead of billions
SELECT
    project_id, day,
    countMerge(total_events) AS total_events,
    uniqMerge(unique_users) AS unique_users,
    avgMerge(avg_duration) AS avg_duration
FROM events_daily_agg
WHERE day >= now() - INTERVAL 30 DAY
GROUP BY project_id, day
ORDER BY day;
```

**MooseStack — Detecting and Implementing an Incremental MV:**

```typescript
import { Key, OlapTable, MaterializedView } from "@514labs/moose-lib";

// Source table — the large fact table being scanned repeatedly
interface Event {
  id: Key<string>;
  projectId: number;
  timestamp: Date;
  userId: number;
  durationMs: number;
}

export const eventsTable = new OlapTable<Event>("events", {
  orderByFields: ["projectId", "timestamp"]
});

// Aggregated target table
interface EventDailyAgg {
  projectId: number;
  day: Date;
  totalEvents: number;
  uniqueUsers: number;
  avgDuration: number;
}

export const eventsDailyAggTable = new OlapTable<EventDailyAgg>("events_daily_agg", {
  orderByFields: ["projectId", "day"],
  engine: "AggregatingMergeTree()"
});

// Incremental MV that pre-aggregates at insert time
export const eventsDailyAggMV = new MaterializedView<Event, EventDailyAgg>({
  name: "events_daily_agg_mv",
  source: eventsTable,
  destination: eventsDailyAggTable,
  query: `
    SELECT
      project_id,
      toStartOfDay(timestamp) AS day,
      countState() AS total_events,
      uniqState(user_id) AS unique_users,
      avgState(duration_ms) AS avg_duration
    FROM events
    GROUP BY project_id, day
  `
});
```

```python
from moose_lib import Key, OlapTable, MaterializedView
from pydantic import BaseModel

# Source table — the large fact table being scanned repeatedly
class Event(BaseModel):
    id: Key[str]
    project_id: int
    timestamp: str
    user_id: int
    duration_ms: float

events_table = OlapTable[Event]("events", {
    "order_by_fields": ["project_id", "timestamp"]
})

# Aggregated target table
class EventDailyAgg(BaseModel):
    project_id: int
    day: str
    total_events: int
    unique_users: int
    avg_duration: float

events_daily_agg_table = OlapTable[EventDailyAgg]("events_daily_agg", {
    "order_by_fields": ["project_id", "day"],
    "engine": "AggregatingMergeTree()"
})

# Incremental MV that pre-aggregates at insert time
events_daily_agg_mv = MaterializedView(
    name="events_daily_agg_mv",
    source=events_table,
    destination=events_daily_agg_table,
    query="""
      SELECT
        project_id,
        toStartOfDay(timestamp) AS day,
        countState() AS total_events,
        uniqState(user_id) AS unique_users,
        avgState(duration_ms) AS avg_duration
      FROM events
      GROUP BY project_id, day
    """
)
```

Reference: [Use Materialized Views](https://clickhouse.com/docs/best-practices/use-materialized-views)
