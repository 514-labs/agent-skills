# MooseStack Skills — TODO

## MooseStack Best Practices
- [ ] Create a data model
- [ ] Configure an OlapTable
- [ ] Export in index.ts / __init__.py
- [ ] Set up an IngestPipeline
- [ ] Define a MaterializedView
- [ ] Build an Api handler
- [ ] Set up Flows
- [ ] Streaming topics

## Skill Quality (from PR feedback)

### Tighten triggers in SKILL.md description
- [ ] Add migration-specific triggers: "Postgres → ClickHouse", "OLTP to OLAP rewrite"
- [ ] Add pattern triggers: "latest row per key", "DISTINCT ON", "join-heavy analytics query"
- [ ] Add triggers: "materialized view / rollup / serving table", "dashboard performance", "semantic mismatch / grain"
- [ ] Narrow description so skill doesn't fire on every ClickHouse mention

### Add migration rewrite patterns (rules)
- [ ] Latest row per key — argMax pattern (and when it's safe)
- [ ] DISTINCT ON — rewrite options (argMax, window functions, rollup table)
- [ ] Join-time enrichment — serving table, dictionary, or denormalized rollup
- [ ] Dashboard GROUP BY — pre-aggregation via MV/rollup

### Add validation checklist
- [ ] "Verify" block template: compare row counts, key cardinalities, null rates, spot-check entities
- [ ] Guidance for running queries against old system vs new ClickHouse/MooseStack

### Add "don't do this" list
- [ ] Don't translate Postgres idioms literally
- [ ] Don't keep join-heavy dashboard queries if the goal is performance
- [ ] Don't validate only on toy data
