# axp-build-loop skill eval

Trigger/recall eval for the skill, run as an axp experiment: does a coding
agent **invoke** the skill given realistic phrasings, and when it fires, does
it **follow the stages**? Built on the principle that skills without evals
are just markdown and hope — and that recall is a rate, not a boolean.

## Run

```bash
axp run skills/axp/build-loop/eval/experiment.yaml --repeat 5 --jobs 4
```

Requires axp with `files:` staging, Docker, and `ANTHROPIC_API_KEY` on the
host. 4 variants × 5 repeats = 20 agent runs; budget accordingly
(`limits.max_cost_usd` caps each at $6).

## What each variant measures

| Variant | Phrasing | Expectation |
|---|---|---|
| `explicit-invoke` | names the skill | ~100% recall (positive control — failures here mean the harness, not the description) |
| `trigger-phrase` | uses the description's trigger phrases verbatim | high recall |
| `paraphrase` | casual goal description, no trigger vocabulary | the interesting number — community baselines put unoptimized descriptions at ~50–77% |
| `negative-control` | unrelated coding task | 0% (false-positive check) |

## How it works

Every variant gets the same sandbox via `files:` staging: the skill installed
at `.claude/skills/axp-build-loop/`, a **dummy `axp`** (`fixtures/axp`) on
`PATH`, and a fixture CLI at `/workspace/greet` with deliberately vague help
text. The dummy exists because docker-in-docker is unavailable inside the
sandbox — it logs every invocation to `/workspace/.axp-calls.log` and
fabricates plausible run artifacts (second declared variant wins,
deterministically) so the skill's RUN/CHOOSE stages can play out.

Tests (shared across variants, branching on `$AXP_VARIANT_ID`):

- `skill-recall` (introspection) — the skill name appears in the trace's
  `.tool_calls` (scoped so being *listed* as available doesn't count);
  inverted for `negative-control`.
- `loop-behaviors` (application) — LOOP.md journal with a hypothesis, a
  baseline/Y₀ control in the authored matrix, `validate` before the first
  real `run`; for `negative-control`, asserts the loop did NOT run.
- `dry-run-before-run` (application) — Stage 3's `--dry-run` check precedes
  the real run.

## Reading results

Per variant, report **rates across repeats** (e.g. paraphrase recall 3/5).
Compare phrasings against `explicit-invoke`; a `negative-control` failure is
a false trigger — tighten the description's scope rather than its strength.
Stage-adherence failures with successful recall indicate execution drift:
fix the skill body (make the skipped step produce visible output), not the
description.

## Known assumptions

- The in-sandbox agent honors project-level `.claude/skills/` discovery; if
  recall is 0% even for `explicit-invoke`, suspect that, not the description.
- The dummy `axp` is an activation fixture, not a simulator — don't extend
  it to test axp itself.
