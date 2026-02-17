---
title: Create a Context Map Documenting the MV Design
impact: MEDIUM
impactDescription: "Enables future maintainers and agents to understand design rationale without re-deriving it"
tags: [materialized-view, documentation, context-map]
---

## Create a Context Map Documenting the MV Design

**Impact: MEDIUM**

After completing the MV design, write a context map that documents the input validation results, chosen strategy, serving table design, MV plan, and tradeoffs. This allows future agents or engineers to understand the rationale without re-analyzing the codebase.

**Context map template:**

```markdown
# [Feature] Serving MV Context

## Input validation
- ClickHouse query function path: `path/to/api.ts` (present)
- MooseStack source table model paths:
  - `path/to/source1.ingest.ts` (present)
  - `path/to/source2.ingest.ts` (present)
- Access patterns (filters/group-bys/sorts) from API spec:
  - filters: [list all WHERE conditions]
  - group-by: [list all GROUP BY columns]
  - sort: [list any ORDER BY or none]
- Missing required inputs: none

## Serving table + MV design
- Serving table + MV definitions path: `path/to/serving-mv.ts`
- Chosen strategy: `fan-in | fan-out | cascade | single`
  - reason: [why this strategy fits]
- Serving table grain:
  - one row per `(dimensions...)`
- Engine/order key:
  - engine name
  - orderByFields: [list]
- MV plan:
  - MV1 from source1 -> description
  - MV2 from source2 -> description
- Tradeoffs:
  - [list known tradeoffs and limitations]
```

**File location:** Place the context map at `context/context-map.md` relative to the app root, alongside the implementation files it references.

**MooseStack - Example Context Map:**

```markdown
# Metric Table Serving MV Context

## Input validation
- ClickHouse query function path: `app/metrics/api/metric_table.api.ts` (present)
- MooseStack source table model paths:
  - `app/metrics/ingest/consumption-event.ingest.ts`
  - `app/metrics/ingest/topic-to-olap-event.ingest.ts`
  - `app/metrics/ingest/streaming-function-event.ingest.ts`
  - `app/metrics/ingest/ingest-event.ingest.ts`
  (all present)
- Access patterns from API spec:
  - filters: time range, search via ILIKE, orgId, projectId, branchId
  - group-by: metric-specific dimension (route, topic_name, function_name)
  - sort: none
- Missing required inputs: none

## Serving table + MV design
- Definitions path: `app/models/metric-table-serving-mv.ts`
- Chosen strategy: `fan-in`
  - reason: source branches are independent by metric type;
    fan-in avoids UNION while preserving shape parity
- Serving table grain:
  - one row per (metric, orgId, projectId, branchId, bucket_start, dimension)
- Engine/order key:
  - MergeTree
  - orderByFields: orgId, projectId, branchId, metric, bucket_start,
    route, topic_name, function_name
- MV plan:
  - ConsumptionMV from ConsumptionEvent_0_0 -> route aggregates
  - StorageMV from TopicToOLAPEvent_0_0 -> topic aggregates
  - ProcessingMV from StreamingFunctionEvent_0_0 -> function aggregates
  - IngestionMV from IngestEvent_0_0 -> route aggregates
- Tradeoffs:
  - per-second pre-aggregation shifts read-time summations to write-time
  - unified schema uses zero/empty defaults across fan-in MVs
```
