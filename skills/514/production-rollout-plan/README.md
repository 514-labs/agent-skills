# production-rollout-plan

A **workflow skill** for planning safe production rollouts of chosen changes in 514/Moose projects, always grounded in a freshly generated Moose migration plan against the intended remote production target.

Unlike rule-based skills, this skill is a single `SKILL.md` with no rules directory or build system. Edit `SKILL.md` directly.

## What it does

The agent runs through five stages:

| Stage | Goal |
|-------|------|
| **SETUP** | Identify the project, exact target deployment, resolve remote auth mode, generate the migration plan, and list affected production resources |
| **CLASSIFY** | Determine rollout type and operational risk from the generated migration |
| **PLAN** | Define rollout, validation, rollback, backfill, and cutover steps from the generated migration sequence |
| **REVIEW** | Present the plan for approval and revision |
| **HANDOFF** | Emit the reviewed rollout plan in the conversation |

## Prerequisites

- **514 CLI** — authenticated (`514 auth login`); used to resolve the exact target deployment plus any stored env vars via `514 deployment list`, `514 env list`, and `514 env get`
- **moose** — available locally; `moose generate migration --save` is required for every rollout plan, using either `--url` + `--token` or `--clickhouse-url`, plus `--redis-url` when Redis-backed state is configured
- A 514/Moose project with at least one active production deployment

## Usage

```
/production-rollout-plan [project-slug]
```

If a project slug is provided, the agent skips the project selection prompt. Otherwise it lists available projects and asks the user to choose.

## Relationship to other skills

`production-rollout-plan` is the production-shipping planner.

It always requires freshly generated migration evidence from the current branch before classifying risk or proposing rollout steps, and that migration must be generated against the intended remote production target.

In practice the skill should:
- use `514 deployment list --project ... --json` to find the production deployment `url` for `FIVEONEFOUR_HOST`
- use `514 env list --project ... --branch ... --json` first to check whether `MOOSE_AUTHENTICATION__ADMIN_API_KEY` is already configured on the target hosted deployment
- use `514 env get --project ... --branch ...` only if the team intentionally stores `CLICKHOUSE_URL`, `REDIS_URL`, or a plain admin bearer token in project envs for automation
- if the remote hash exists but the bearer token is missing, ask before rotating credentials with `moose generate hash-token --json`, `514 env set`, and a redeploy
- stop and raise a blocker if the required admin API token or direct ClickHouse credentials still cannot be resolved securely

Use it:
- after `perf-optimize` has selected a winning candidate and opened the performance PR
- after `perf-optimize` when the user wants to ship a single chosen change without benchmarking
- whenever a developer already has a chosen change and needs a safe path to production

## Editing

This is a workflow skill — all logic lives in `SKILL.md`. There is no build step.
