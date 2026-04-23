# moose-basics

A **workflow skill** that teaches agents how to use MooseStack locally: the anatomy of `moose dev --dockerless`, reading logs, using the moose-dev MCP, defining basic infrastructure (ingest pipelines, APIs, materialized views), and recovering from a broken dev state.

## What it covers

| Section | Contents |
|---------|----------|
| **1. What `moose dev` is doing** | Components (ClickHouse, Redpanda, Redis, Temporal, Moose webserver, moose-dev MCP) and the ingest → stream → table data flow |
| **2. Running a Moose project** | `moose dev`, `moose clean`, `moose ls`, `moose query`, `moose docs` |
| **3. Reading logs** | Where logs live, common error signatures, health checks |
| **4. Using the moose-dev MCP server** | When to reach for MCP vs CLI fallbacks |
| **5. Defining infrastructure** | `IngestPipeline`, `Api`, `MaterializedView` with canonical TS examples |
| **6. Recovery when `moose dev` is broken** | Schema drift, tspc missing, port conflicts, clean-restart recipe |

## Why this exists

Observed in agent-evals traces: 77% of moose-involved runs hit stack-state trouble (reload failures, port conflicts, schema drift); 14% gave up and fabricated a fake Node.js/Express API server to pass scoring. The dominant failure mode is not "agent can't write Moose code" but "agent doesn't know what to check when the stack misbehaves."

This skill gives the agent:

- A mental model of what the stack actually is (so it stops treating `moose dev` as a black box)
- Concrete grep-able log patterns (so errors are findable without tailing)
- Explicit guidance to use `moose docs` / `moose ls` / `moose query` instead of guessing paths
- A "do not fabricate" reminder at the end (reduces the Express-server give-up mode)

## Editing

Single-file workflow skill — all logic is in `SKILL.md`. No build step.

## Extending

When new MooseStack CLI commands or core concepts ship:

1. Pick the relevant section (or add a new one)
2. Add the command/concept with a concrete, copy-pasteable example
3. Update the Quick Reference table at the bottom of `SKILL.md`
4. Bump `metadata.json` version
