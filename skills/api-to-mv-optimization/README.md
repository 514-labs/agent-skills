# API-to-MV Optimization Skill

A guided workflow skill for converting ClickHouse API queries into pre-aggregated MaterializedView architectures using MooseStack.

## Install

```bash
npx skills add 514-labs/agent-skills
```

Works with Claude Code, Cursor, Copilot, Windsurf, Gemini CLI, Codex, and 20+ other agents.

## What It Does

When your ClickHouse API scans raw event tables and aggregates on every request, this skill walks agents through converting it to a serving table backed by MaterializedViews that pre-aggregate at write time.

**Before:** Dashboard queries scan billions of raw rows (~500ms-2s per query)
**After:** Dashboard queries read thousands of pre-aggregated rows (~5-20ms per query)

## Rules

| Rule | Impact | Description |
|------|--------|-------------|
| `mv-validate-inputs` | CRITICAL | Validate API file and source tables before designing |
| `mv-extract-access-patterns` | CRITICAL | Extract filters, group-bys, aggregates from the API query |
| `mv-select-strategy` | HIGH | Choose fan-in, fan-out, cascade, or single MV topology |
| `mv-design-serving-table` | CRITICAL | Design grain and ORDER BY from access patterns |
| `mv-fan-in-schema` | HIGH | Use zero/empty defaults for union schema across fan-in MVs |
| `mv-write-time-aggregation` | CRITICAL | Pre-aggregate at insert time with time bucketing |

## Workflow

1. **Validate inputs** — confirm API file and all source tables exist
2. **Extract access patterns** — list filters, group-bys, aggregates
3. **Select strategy** — choose MV topology based on source structure
4. **Design serving table** — define grain, engine, ORDER BY
5. **Plan MVs** — one MV per source (fan-in) or per shape (fan-out)
6. **Update API** — rewrite query to read from serving table

## Origin

Derived from a production telemetry dashboard optimization at [514 Labs](https://fiveonefour.com), converting a multi-source metric table API from runtime UNION aggregation to fan-in MaterializedViews.
