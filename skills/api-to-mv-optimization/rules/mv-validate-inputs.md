---
title: Validate API and Source Tables Before Designing MVs
impact: CRITICAL
impactDescription: "Prevents wasted design effort on incomplete or stale inputs"
tags: [materialized-view, validation, workflow]
---

## Validate API and Source Tables Before Designing MVs

**Impact: CRITICAL**

Always confirm all required artifacts exist before designing a MaterializedView architecture. Missing source tables or stale API references lead to broken MVs that silently fail at insert time.

**Incorrect (designing without validation):**

```sql
-- Jump straight to MV creation without checking source tables
CREATE MATERIALIZED VIEW my_mv TO serving AS
SELECT ... FROM events  -- Does "events" exist? Is it the right version?
GROUP BY ...;
```

**Correct (validate first, then design):**

```
Input validation checklist:
✓ ClickHouse query function path: app/metrics/api/metric_table.api.ts (present)
✓ Source table model paths:
  - app/metrics/ingest/consumption-event.ingest.ts (present)
  - app/metrics/ingest/topic-to-olap-event.ingest.ts (present)
  - app/metrics/ingest/streaming-function-event.ingest.ts (present)
  - app/metrics/ingest/ingest-event.ingest.ts (present)
✓ Access patterns extracted: filters, group-bys, sorts
✓ Missing required inputs: none
→ Proceed to design
```

**MooseStack - Locating Source Tables:**

In MooseStack, source tables are declared by `IngestPipeline` exports. Verify the pipeline's `.table` property is accessible:

```typescript
import { ConsumptionEventPipeline } from "../metrics/ingest/consumption-event.ingest";
import { IngestEventPipeline } from "../metrics/ingest/ingest-event.ingest";

// Verify source tables exist — these will fail at import time if missing
const consumptionTable = ConsumptionEventPipeline.table;
const ingestTable = IngestEventPipeline.table;
```

```python
from app.metrics.ingest.consumption_event import ConsumptionEventPipeline
from app.metrics.ingest.ingest_event import IngestEventPipeline

# Verify source tables exist
consumption_table = ConsumptionEventPipeline.table
ingest_table = IngestEventPipeline.table
```

Reference: [MooseStack Materialized Views](https://docs.fiveonefour.com/moosestack/materialized-views)
