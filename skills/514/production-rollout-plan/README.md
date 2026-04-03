# production-rollout-plan

A **workflow skill** for planning safe production rollouts of chosen changes in 514/Moose projects.

Unlike rule-based skills, this skill is a single `SKILL.md` with no rules directory or build system. Edit `SKILL.md` directly.

## What it does

The agent runs through five stages:

| Stage | Goal |
|-------|------|
| **SETUP** | Identify the project, exact target deployment, and list affected production resources |
| **CLASSIFY** | Determine rollout type and operational risk from the migration artifacts |
| **PLAN** | Define rollout, validation, rollback, backfill, and cutover steps from the migration sequence |
| **REVIEW** | Present the plan for approval and revision |
| **HANDOFF** | Emit the reviewed rollout plan in the conversation |

## Prerequisites

- **514 CLI** — authenticated (`514 auth login`); used to resolve the exact target deployment plus any stored env vars via `514 deployment list`, `514 env list`, and `514 env get`
- A 514/Moose project with at least one active production deployment

## Usage

```
/production-rollout-plan [project-slug]
```

If a project slug is provided, the agent skips the project selection prompt. Otherwise it lists available projects and asks the user to choose.

## Relationship to other skills

`production-rollout-plan` is the production-shipping planner.

It reviews migration artifacts from the current branch to classify risk and propose rollout steps.

Use it:
- after `perf-optimize` has selected a winning candidate and opened the performance PR
- after `perf-optimize` when the user wants to ship a single chosen change without benchmarking
- whenever a developer already has a chosen change and needs a safe path to production

## Editing

This is a workflow skill — all logic lives in `SKILL.md`. There is no build step.
