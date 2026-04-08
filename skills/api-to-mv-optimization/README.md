# API-to-MV Optimization Skill

A guided workflow skill for converting ClickHouse API queries into pre-aggregated MaterializedView architectures using MooseStack.

## Install

```bash
npx skills add 514-labs/agent-skills
```

Works with Claude Code, Cursor, Copilot, Windsurf, Gemini CLI, Codex, and 20+ other agents.

## Prerequisite

Run `dashboard-preflight` first to discover project context, validate inputs, and extract access patterns. This skill consumes the context map it produces.

## What It Does

When your ClickHouse API scans raw event tables and aggregates on every request, this skill walks agents through converting it to a serving table backed by MaterializedViews that pre-aggregate at write time.

**Before:** Dashboard queries scan billions of raw rows (~500ms-2s per query)
**After:** Dashboard queries read thousands of pre-aggregated rows (~5-20ms per query)

## Rules

| Rule | Impact | Description |
|------|--------|-------------|
| `mv-select-strategy` | HIGH | Choose fan-in, fan-out, cascade, or single MV topology |
| `mv-design-serving-table` | CRITICAL | Design grain and ORDER BY from access patterns |
| `mv-fan-in-schema` | HIGH | Use zero/empty defaults for union schema across fan-in MVs |
| `mv-write-time-aggregation` | CRITICAL | Pre-aggregate at insert time with time bucketing |
| `mv-verify-correctness` | CRITICAL | Verify MV population and aggregation parity before updating API |

## Workflow

1. **Run `dashboard-preflight`** — produces context map with validated inputs
2. **Select strategy** — choose MV topology based on source structure
3. **Design serving table** — define grain, engine, ORDER BY
4. **Plan MVs** — one MV per source (fan-in) or per shape (fan-out)
5. **Verify correctness** — infrastructure, population, aggregation parity
6. **Update API** — rewrite query to read from serving table

## Origin

Derived from a production telemetry dashboard optimization at [514 Labs](https://fiveonefour.com), converting a multi-source metric table API from runtime UNION aggregation to fan-in MaterializedViews.
