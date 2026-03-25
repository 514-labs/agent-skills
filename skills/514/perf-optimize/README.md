# perf-optimize

A **workflow skill** for discovering and planning ClickHouse optimizations in a 514/Moose deployment.

Unlike rule-based skills, this skill is a single `SKILL.md` with no rules directory or build system. Edit `SKILL.md` directly.

## What it does

The agent runs through four stages:

| Stage | Goal |
|-------|------|
| **SETUP** | Authenticate, identify the target project, and capture production schema context |
| **PROFILE** | Collect query, schema, and storage evidence from production |
| **PLAN** | Propose candidate optimizations and identify the benchmark target interface |
| **NEXT STEP** | Either validate one direct branch-local change for `production-rollout-plan` or hand off candidates to `perf-benchmark` |

## Prerequisites

- **514 CLI** — authenticated (`514 auth login`)
- **moose** — available locally for branch-local DDL validation
- A 514/Moose project with at least one active production deployment

## Usage

```
/perf-optimize [project-slug]
```

If a project slug is provided, the agent skips the project selection prompt. Otherwise it lists available projects and asks the user to choose.

## Relationship to downstream skills

`perf-optimize` is the discovery skill. It profiles production, proposes candidate schema changes, and produces the discovery handoff.

Use:
- `perf-benchmark` when the user wants controlled multi-branch benchmarking and ranking
- `production-rollout-plan` when the user has chosen a specific change and needs a safe path to production

## Editing

This is a workflow skill — all logic lives in `SKILL.md`. There is no build step.
