---
name: dashboard-preflight
description: "You MUST run this before any dashboard skill — optimization, SQL authoring, QA, or integration. Discovers the MooseStack project context, validates inputs, and extracts access patterns into a context map that downstream skills consume."
---

# Dashboard Preflight

## Overview

Discover the MooseStack project structure, validate the target API and source tables exist, and extract access patterns into a structured context map. Every downstream dashboard skill (optimization, SQL authoring, query QA, integration, release safety) starts from this context map instead of re-discovering the project.

Run this once per task. If the task touches a different API or source tables, run it again.

## The Process

**Discover the project:**
- Find the MooseStack project root (look for `moose.config.ts` or `package.json` with `@514labs/moose-lib`)
- Scan for all ingest pipelines (`*.ingest.ts` / `*.ingest.py`)
- Scan for all API handlers (`*.api.ts` / `*.api.py`)
- Scan for all existing OlapTables and MaterializedViews (`*.ts` / `*.py` files exporting `OlapTable` or `MaterializedView`)
- Build a map: ingest pipelines → source tables → MVs → serving tables → APIs

**Validate the target:**
- Locate the specific API handler the user is working with
- Trace its query to find every source table it reads from
- Confirm each source table model file exists and is exported from the app index
- If any source is missing, stop and resolve before continuing

**Extract access patterns:**
- From the API handler's query, list every:
  - `WHERE` filter and its type (equality, range, ILIKE, IN)
  - `GROUP BY` column
  - Aggregate function and its input column (`sum(bytes)`, `count()`, etc.)
  - `ORDER BY` column (or note if absent)
- If the query has conditional branches (switch/case by metric type, entity type, etc.), extract patterns per branch
- Note the query's current data source: raw table, existing MV, or serving table

**Assess current state:**
- Is the query scanning raw event tables directly? (optimization candidate)
- Are there existing MVs that partially cover the access pattern? (extend vs replace)
- What tenant dimensions are used for isolation? (orgId, projectId, branchId, etc.)
- What is the time granularity of the source data vs what the API actually needs?

## Output: Context Map

Write the context map to `context/context-map.md` relative to the app root:

```markdown
# [Feature] Context

## Project structure
- MooseStack root: `path/to/root`
- Ingest pipelines: [list with paths]
- Source tables: [list with ClickHouse table names]
- Existing MVs: [list or "none"]
- API handlers: [list with paths]

## Target API
- Handler path: `path/to/api.ts`
- Current data source: [raw table / MV / serving table]
- Query shape: [brief description]

## Access patterns
- Filters: [list all WHERE conditions with types]
- Group-by: [list columns, note if per-branch]
- Aggregates: [list functions and input columns]
- Sort: [list or "none"]
- Conditional branches: [list branches and their distinct patterns, or "none"]

## Tenant dimensions
- [orgId, projectId, branchId, etc.]

## Current state assessment
- [Optimization candidate? Existing MVs? Time granularity gap?]

## Missing or unresolved
- [List anything that couldn't be validated, or "none"]
```

## After Preflight

Hand off to the appropriate downstream skill:
- **MV optimization** → `api-to-mv-optimization` (uses access patterns + source tables)
- **SQL authoring** → `building-performant-dashboards/references/02-sql-authoring.md`
- **Query QA** → `building-performant-dashboards/references/03-query-qa.md`
- **Query Layer integration** → `building-performant-dashboards/references/05-query-layer-integration.md`

The downstream skill reads the context map and starts from validated inputs — no re-discovery needed.

## Key Principles

- **Run once, reuse everywhere** — One preflight per API target, consumed by all downstream skills
- **Validate before designing** — Never start MV design, SQL authoring, or QA without confirmed inputs
- **Extract, don't assume** — Access patterns come from the actual query code, not intuition
- **Stop on missing inputs** — If a source table or API handler can't be found, resolve it before proceeding
- **Branch-aware** — Conditional query logic (switch/case) means multiple access patterns to capture
