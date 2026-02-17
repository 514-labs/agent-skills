# MooseStack SQL Patterns Skill

Rules for writing safe, correct dynamic ClickHouse queries in MooseStack using the `sql` template tag.

## Install

```bash
npx skills add 514-labs/agent-skills
```

Works with Claude Code, Cursor, Copilot, Windsurf, Gemini CLI, Codex, and 20+ other agents.

## What It Does

MooseStack's `sql` template tag prevents SQL injection by parameterizing values, but dynamic queries still need careful handling for identifiers, optional filters, allow-lists, and input validation. This skill codifies the correct patterns.

## Rules

| Rule | Impact | Description |
|------|--------|-------------|
| `sql-parameterize-values` | CRITICAL | Use the `sql` tag for all value interpolation |
| `sql-safe-identifiers` | CRITICAL | Use `ApiHelpers.column()`/`.table()` for dynamic identifiers |
| `sql-allow-list-dynamics` | CRITICAL | Constrain dynamic values to enums, switches, or maps |
| `sql-dynamic-where` | HIGH | Build WHERE clauses with `Sql[]` + `joinQueries` |
| `sql-validate-inputs` | HIGH | Parse and validate before interpolation |

## Composes With

- `dashboard-preflight` — run first for new APIs to discover project context
- `clickhouse-best-practices` — for query optimization (ORDER BY alignment, JOINs, etc.)
- `api-to-mv-optimization` — for pre-aggregation when the query is an optimization candidate

## Origin

Derived from production MooseStack API handlers at [514 Labs](https://fiveonefour.com), covering telemetry dashboards, log viewers, and customer analytics.
