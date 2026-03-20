# Agent Skills — MooseStack + ClickHouse

A collection of skills that extend AI coding agents with domain-specific expertise for building data applications with [MooseStack](https://docs.fiveonefour.com/moosestack) and [ClickHouse](https://clickhouse.com/docs).

## Install

```bash
npx skills add 514-labs/agent-skills
```

Works with Claude Code, Cursor, Copilot, Windsurf, Gemini CLI, Codex, and [20+ other agents](https://agentskills.io).

## Skills

| Skill | Type | Description |
|-------|------|-------------|
| [`clickhouse-best-practices`](./skills/clickhouse/best-practices/) | Reference (28 rules) | Schema design, query optimization, and data ingestion best practices — ClickHouse SQL + MooseStack TypeScript & Python |
| [`514-cli`](./skills/514/cli/) | Workflow | 514 CLI basics — logging in, linking a project, checking deployments, browsing docs |
| [`514-debug`](./skills/514/debug/) | Workflow | Deployment debugging — status checks, log tailing, slow query discovery, resource inspection, diagnostic SQL |
| [`perf-optimize`](./skills/514/perf-optimize/) | Workflow (5 stages) | Guided performance optimization: profile a deployment, identify bottlenecks, apply fixes, verify on preview, ship a PR |

---

## clickhouse-best-practices

Forked from [ClickHouse/agent-skills](https://github.com/ClickHouse/agent-skills), which provides 28 battle-tested rules for schema design, query optimization, and data ingestion — all in ClickHouse SQL. We extended every rule with [MooseStack](https://docs.fiveonefour.com/moosestack) TypeScript and Python examples so your agents apply the same discipline when writing application code, not just raw DDL.

### What you're building

Teams use MooseStack + ClickHouse to ship analytics features inside their applications — the kind of features where performance, schema design, and data modeling directly impact the end user. This skill makes sure your agents get those decisions right from the start.

**Fast, customer-facing dashboards.** Your users expect interactive charts and filters that respond in milliseconds, not seconds. When analytical queries outgrow your transactional database, moving them to ClickHouse yields [10–100x faster dashboards](https://docs.fiveonefour.com/guides/performant-dashboards) — but only if the schema is designed for your actual access patterns. This skill teaches agents to choose the right `orderByFields`, partitioning, and types so the data model performs well from day one.

**Data-connected chat in your app.** LLMs can now query your database through [MCP](https://docs.fiveonefour.com/guides/chat-in-your-app), turning natural language into live analytics. The quality of those answers depends on how your data is modeled: clean schemas, well-chosen types, and materialized views that pre-aggregate the right dimensions. This skill ensures agents build chat-ready data models that return fast, accurate results.

### What's inside

**28 rules**, each with ClickHouse SQL + MooseStack TypeScript + MooseStack Python examples:

| Category | Rules | Impact | e.g. |
|---|---|---|---|
| Key ordering / `orderByFields` | 4 | CRITICAL | order columns low-to-high cardinality, prioritize filter columns |
| Type selection | 5 | CRITICAL | prefer native types, minimize bit-width, avoid Nullable |
| JOIN optimization | 5 | CRITICAL | filter before joining, ANY for single matches |
| Insert batching | 1 | CRITICAL | 10K-100K rows per batch |
| Mutation avoidance | 2 | CRITICAL | no ALTER TABLE UPDATE/DELETE |
| Partitioning | 4 | HIGH | lifecycle management, keep cardinality under 1,000 |
| Skipping indices | 1 | HIGH | bloom filters for non-ORDER BY filters |
| Materialized views | 2 | HIGH | incremental for real-time, refreshable for batch |
| Async inserts | 2 | HIGH | high-frequency small batches |
| OPTIMIZE avoidance | 1 | HIGH | let merges happen naturally |
| JSON usage | 1 | MEDIUM | use JSON type for dynamic schemas |

Browse the rules: [`skills/clickhouse/best-practices/`](./skills/clickhouse/best-practices/) | Human-friendly overview: [SKILL.md](./skills/clickhouse/best-practices/SKILL.md)

### Example prompts

> Here's a sample of our source data [paste schema or CSV header]. Our queries filter heavily by region and time range. Using the `clickhouse-best-practices-ts-py` skill, create an optimized TypeScript data model with the right `orderByFields`, partitioning, and type annotations. Use `moose query` to validate the table performs well for those access patterns.

> Using the `clickhouse-best-practices-ts-py` skill, review this `OlapTable` definition against the queries in our Next.js frontend at `app/dashboard/`. Are the `orderByFields` in the right order given actual filter and GROUP BY patterns? Should any string columns be `LowCardinality`? Is Nullable justified on these fields?

> I need to track order line items with frequent updates to fulfillment status. Using the `clickhouse-best-practices-ts-py` skill, what table engine and data model should I use to avoid mutations? Show me the TypeScript and Python versions.

You don't strictly need to name the skill — most agents will activate it automatically when they see ClickHouse or MooseStack context. We like to call it explicitly when we want a formal review against the full ruleset.

For best results, have `moose dev` running and connect the [MooseStack MCP server](https://docs.fiveonefour.com/moosestack/moosedev-mcp) to your agent. This lets the agent query your local ClickHouse, inspect infrastructure, and validate its recommendations against real data.

---

## 514-cli

The foundational **workflow skill** for the 514 platform. Teaches agents how to authenticate, discover projects, inspect deployed schemas, and run metrics queries — the building blocks that other 514 workflow skills (like `perf-optimize`) rely on.

### Sections

| Section | What it covers |
|---------|----------------|
| **Authentication** | Login, whoami, org switching |
| **Projects** | List, link, setup |
| **Deployments** | List and filter deployments |
| **Docs** | Search and browse 514 docs from the terminal |

### Prerequisites

- **514 CLI** — installed and on your PATH

---

## 514-debug

A **workflow skill** for diagnosing deployment issues. When something is broken or behaving unexpectedly, this skill walks agents through the 514 CLI's observability commands to figure out what's going on.

### Sections

| Section | What it covers |
|---------|----------------|
| **Deployment status** | Health checks, status filters, branch targeting |
| **Logs** | Error filtering, full-text search, time ranges, live tailing |
| **Query metrics** | Slow queries, memory-heavy queries, duration/rows filters |
| **Resource inspection** | Tables, views, streams, functions, endpoints, syncs |
| **Diagnostic queries** | Ad-hoc ClickHouse SQL — table sizes, running queries, recent errors |

### Prerequisites

- **514 CLI** — installed and on your PATH

---

## perf-optimize

A **workflow skill** that guides an agent through profiling and optimizing ClickHouse performance in a 514/Moose deployment. Instead of passive reference rules, this skill drives the agent through a five-stage process end to end.

### Stages

| Stage | Goal |
|-------|------|
| **SETUP** | Authenticate with 514 CLI, identify the target project and active deployment |
| **PROFILE** | Fetch schema and query data, analyze against an optimization checklist, produce a plan |
| **OPTIMIZE** | Create a preview branch from main, validate changes locally with `moose dev`, then push the updated branch |
| **VERIFY** | Compare before/after metrics on the preview deployment |
| **SHIP** | Create a PR with performance evidence |

### Usage

```
/perf-optimize [project-slug]
```

If a project slug is provided, the agent skips the project selection prompt. Otherwise it lists available projects and asks the user to choose.

### Prerequisites

- **514 CLI** — authenticated (`514 auth login`)
- **gh CLI** — for creating the pull request
- A 514/Moose project with at least one active deployment

**Docs:** [MooseStack](https://docs.fiveonefour.com/moosestack) | [ClickHouse](https://clickhouse.com/docs)

---

## Supported Agents

The installer auto-detects which agents you have. Skills are agent-agnostic — same skill, every assistant:

| Agent | Config Directory |
|-------|------------------|
| [Claude Code](https://claude.ai/code) | `.claude/skills/` |
| [Cursor](https://cursor.sh) | `.cursor/skills/` |
| [Windsurf](https://codeium.com/windsurf) | `.windsurf/skills/` |
| [GitHub Copilot](https://github.com/features/copilot) | `.github/skills/` |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | `.gemini/skills/` |
| [Cline](https://github.com/cline/cline) | `.cline/skills/` |
| [Codex](https://openai.com/codex) | `.codex/skills/` |
| [Goose](https://github.com/block/goose) | `.goose/skills/` |
| [Roo Code](https://roo.ai) | `.roo/skills/` |
| [OpenHands](https://github.com/All-Hands-AI/OpenHands) | `.openhands/skills/` |

And [13 more](https://agentskills.io).

## Acknowledgments

The ClickHouse team's [agent-skills](https://github.com/ClickHouse/agent-skills) repo did the hard work of codifying ClickHouse best practices into agent-consumable rules. This project wouldn't exist without it.

## License

Apache 2.0 — see [LICENSE](./LICENSE).
