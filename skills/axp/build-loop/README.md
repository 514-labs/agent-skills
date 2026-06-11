# axp-build-loop — maintainer guide

Workflow skill that drives the axp experiment build loop from a coding-agent
chat: INTAKE → GENERATE → IMPLEMENT → RUN → CHOOSE → LAP/PROMOTE.

## Design notes

- **Activation:** the `description` is deliberately directive and trigger-led
  ("ALWAYS invoke … trigger phrases …"). Community measurements put passive
  descriptions at ~50–77% auto-activation; directive ones near 100%. Keep that
  style when editing. The reliable entry point is still the explicit slash
  command — don't weaken the description assuming auto-trigger works.
- **State model:** conversation context is scratch state; `LOOP.md` inside the
  user's repo (`.axp/loops/<name>/`) is the durable journal. Any change to the
  loop's flow must keep `LOOP.md` sufficient for a cold session to resume.
- **Hard conventions** (naive-user prompt, Y₀ control, repeat-by-default,
  identical mocks, one-axis-per-lap) are what make lap results comparable.
  Treat them as invariants, not suggestions.
- **No invented trace fields:** the only documented `$AXP_TRACE_PATH` field the
  skill asserts on is `.tool_calls`. The skill instructs agents to inspect a
  real trace before writing finer assertions. If the trace schema gains stable
  documented fields, tighten the playbook metrics accordingly.

## axp version coupling

Requires `axp` with `files:` staging (`axp run --file`, shipped June 2026,
514-labs/axp#472). Staging is local-Docker-only; the skill says so. When
remote staging delivery ships, update the Requirements section.

## Versioning

Bump `metadata.json` `version` on behavior changes to the workflow (stage
order, gates, conventions); patch-bump for wording fixes.
