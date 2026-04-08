---
title: Verify MV Population and Aggregation Parity Before Updating the API
impact: CRITICAL
impactDescription: "Catches silent MV failures, schema mismatches, and aggregation drift before they reach production dashboards"
tags: [materialized-view, testing, verification, correctness]
---

## Verify MV Population and Aggregation Parity Before Updating the API

**Impact: CRITICAL**

MaterializedViews can silently fail — wrong column order, type mismatches, or missing source table references cause the MV to be created but never populate. Always verify the full path (source insert → MV trigger → serving table row) before rewriting the API to read from the serving table.

**Incorrect (ship without verification):**

```sql
-- Create MV
CREATE MATERIALIZED VIEW ConsumptionMV TO MetricTableServing AS
SELECT ... FROM ConsumptionEvent_0_0 GROUP BY ...;

-- Immediately rewrite API to read from serving table
-- No verification that the MV actually populates
SELECT route, sum(bytes) FROM MetricTableServing WHERE ...;
-- Returns empty results — MV SELECT had a column type mismatch
```

**Correct (verify before rewriting API):**

Three verification steps, in order:

### 1. Infrastructure check — tables and views exist

```sql
-- Verify serving table exists
SELECT name, engine FROM system.tables
WHERE database = currentDatabase() AND name = 'MetricTableServing';

-- Verify all MVs exist and point to the correct target
SELECT name, as_select FROM system.tables
WHERE database = currentDatabase() AND engine = 'MaterializedView'
  AND name LIKE 'MetricTableServing%';
```

### 2. Population check — insert triggers MV

```sql
-- Insert a known row into a source table
INSERT INTO ConsumptionEvent_0_0
  (timestamp, orgId, projectId, branchId, route, bytes, count, latency)
VALUES (now(), 'test-org', 'test-project', 'test-branch', '/api/test', 100, 1, 50);

-- Verify it appears in the serving table
SELECT * FROM MetricTableServing
WHERE orgId = 'test-org' AND metric = 'consumption';
-- Should return exactly 1 row with bytes=100, count=1, latency=50
-- and topic_name='', function_name='', count_in=0, count_out=0
```

### 3. Aggregation parity check — MV matches raw query

```sql
-- Query the raw source table directly (the "before" query)
SELECT route, sum(bytes) AS bytes, sum(count) AS count, sum(latency) AS latency
FROM ConsumptionEvent_0_0
WHERE timestamp >= '2024-01-01' AND timestamp <= '2024-12-31'
  AND orgId = 'org-1' AND projectId = 'proj-1' AND branchId = 'branch-1'
GROUP BY route;

-- Query the serving table (the "after" query)
SELECT route, sum(bytes) AS bytes, sum(count) AS count, sum(latency) AS latency
FROM MetricTableServing
WHERE bucket_start >= '2024-01-01' AND bucket_start <= '2024-12-31'
  AND metric = 'consumption'
  AND orgId = 'org-1' AND projectId = 'proj-1' AND branchId = 'branch-1'
GROUP BY route;

-- Results MUST match. If they don't:
--   - Check toStartOfInterval bucketing vs raw timestamp filtering
--   - Check toFloat64 casts in MV SELECT
--   - Check GROUP BY columns match between MV and verification query
```

### For fan-in topologies: test each branch independently

```sql
-- Test each MV in isolation before testing the combined serving table.
-- Insert one test row per source table, verify each produces the correct
-- serving table row with the right metric label and zero/empty defaults.

-- Branch 1: consumption (has route, not topic_name/function_name)
INSERT INTO ConsumptionEvent_0_0 (...) VALUES (...);
SELECT * FROM MetricTableServing WHERE metric = 'consumption' AND orgId = 'test';
-- Expect: route='...', topic_name='', function_name='', count_in=0, count_out=0

-- Branch 2: storage (has topic_name, not route/function_name)
INSERT INTO TopicToOLAPEvent_0_0 (...) VALUES (...);
SELECT * FROM MetricTableServing WHERE metric = 'storage' AND orgId = 'test';
-- Expect: route='', topic_name='...', function_name='', count_in=0, count_out=0

-- Branch 3: processing (has function_name, not route/topic_name)
INSERT INTO StreamingFunctionEvent_0_0 (...) VALUES (...);
SELECT * FROM MetricTableServing WHERE metric = 'processing' AND orgId = 'test';
-- Expect: route='', topic_name='', function_name='...', count_in=N, count_out=M

-- Branch 4: ingestion (has route, not topic_name/function_name)
INSERT INTO IngestEvent_0_0 (...) VALUES (...);
SELECT * FROM MetricTableServing WHERE metric = 'ingestion' AND orgId = 'test';
-- Expect: route='...', topic_name='', function_name='', count_in=0, count_out=0
```

**Common failure modes:**

| Symptom | Likely Cause |
|---------|-------------|
| Serving table exists but is always empty | MV SELECT has column count or type mismatch with target |
| Some branches populate, others don't | Missing or wrong `selectTables` reference in non-populating MV |
| Aggregation parity fails by small amounts | `toFloat64` cast missing — integer overflow or truncation in MV |
| Parity fails for time-boundary rows | `toStartOfInterval` bucketing vs raw `timestamp` filter mismatch |
| Duplicate-looking rows | MergeTree hasn't merged yet — use `FINAL` in verification query only |

**MooseStack - Verification Workflow:**

```typescript
// After defining MVs, start the moose dev server and verify:
//
// 1. Infrastructure: check ClickHouse system tables
//    SELECT name FROM system.tables WHERE name = 'MetricTableServing';
//    SELECT name FROM system.tables WHERE engine = 'MaterializedView';
//
// 2. Population: use the moose ingest endpoint to send a test event
//    POST /ingest/ConsumptionEvent/0.0
//    { "timestamp": "...", "orgId": "test", "route": "/test", "bytes": 100, ... }
//
//    Then query:
//    SELECT * FROM MetricTableServing WHERE orgId = 'test';
//
// 3. Parity: compare raw vs serving table results for the same filters
//    Run both queries, diff the results — they must match.
//
// 4. Fan-in: repeat step 2 for each source pipeline,
//    verify each produces the correct metric label and defaults.
```

```python
# After defining MVs, start the moose dev server and verify:
#
# 1. Infrastructure: check system.tables for serving table and MVs
# 2. Population: POST test event to /ingest/ConsumptionEvent/0.0
# 3. Parity: compare raw vs serving table query results
# 4. Fan-in: test each source pipeline independently
```

**Quality gate:** Do not rewrite the API to read from the serving table until all three checks pass (infrastructure, population, aggregation parity). For fan-in, all branches must pass independently.

Reference: [Use Materialized Views](https://clickhouse.com/docs/best-practices/use-materialized-views)
