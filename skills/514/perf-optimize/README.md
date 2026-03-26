# perf-optimize

A **workflow skill** for profiling, benchmarking, and selecting ClickHouse optimizations in a 514/Moose deployment.

Unlike rule-based skills, this skill is a single `SKILL.md` with no rules directory or build system. Edit `SKILL.md` directly.

## What it does

The agent runs through seven stages:

| Stage | Goal |
|-------|------|
| **SETUP** | Authenticate, identify the target project, find the active deployment, and capture baseline DDL |
| **PROFILE** | Collect production query, schema, and storage evidence, then map hot query patterns back to code |
| **PROPOSE** | Present candidate optimizations, benchmark targets, and experiment risk to the user |
| **BASELINE** | Scaffold the benchmark harness, create the frozen control branch, ensure comparable seed data, and benchmark baseline |
| **EXPERIMENT** | Create experiment branches, apply approved optimizations, validate locally, seed, and benchmark each candidate |
| **COMPARE** | Rank baseline vs candidate benchmark results and select a winner |
| **SHIP** | Create the winning PR with benchmark evidence and route production rollout planning to `production-rollout-plan` |

## Prerequisites

- **514 CLI** — authenticated (`514 auth login`)
- **git** — available locally for baseline/candidate branch creation
- **gh CLI** — available locally for creating the winning pull request
- **moose** — available locally, including `moose add benchmark` and `moose dev`
- **pnpm** — available for the benchmark suite
- A 514/Moose project with at least one active production deployment

## Usage

```
/perf-optimize [project-slug]
```

If a project slug is provided, the agent skips the project selection prompt. Otherwise it lists available projects and asks the user to choose.

## Relationship to downstream skills

`perf-optimize` is the end-to-end optimization workflow in this repo. It profiles production, proposes candidate schema changes, benchmarks a frozen baseline against experiment branches, and opens the winning PR.

Use:
- `production-rollout-plan` when the winning candidate, or any other chosen change, needs a safe path to production

## Editing

This is a workflow skill — all logic lives in `SKILL.md`. There is no build step.
