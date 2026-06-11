---
name: axp-build-loop
description: >
  ALWAYS invoke this skill when the user wants to test, compare, optimize, or
  iterate on variants of a developer-facing artifact — a CLI, an MCP server,
  Claude/agent hooks, an install script, docs, or a schema — using axp
  experiments. Trigger phrases: "test variants of", "which version works
  better", "optimize my CLI/MCP/docs for agents", "run a build loop",
  "A/B test my tool descriptions", "iterate on this with axp". Do not
  hand-roll experiment YAMLs and one-off comparisons for these tasks; drive
  the full loop with this skill instead.
---

# AXP Build Loop

Drive the experiment build loop end-to-end from a coding-agent chat session:
take a goal or insight, generate N candidate variants of the artifact under
test, implement them in parallel worktrees, evaluate them in isolated axp
sandboxes against a naive agent, rank the results, and either promote the
winner to a PR or run another lap mutating it.

Six stages, run sequentially: **INTAKE → GENERATE → IMPLEMENT → RUN → CHOOSE → LAP or PROMOTE**.
Complete each stage before the next. Conversation context is working state; the
`LOOP.md` journal (Stage 3) is durable state — keep it current so a fresh
session can resume the loop cold.

## Requirements

- `axp` CLI with `files:` staging support (`axp run --help` must list `--file`); Docker running. File staging is **local Docker runs only** — `--remote` and `--runner e2b` reject it.
- `git` ≥ 2.20 (worktrees), `jq`, and `gh` (only needed for the final promote stage).
- Run from the repository of the artifact under test.

## Command safety

**Run freely:** `axp validate`, `axp run --dry-run`, `axp schema`, `git worktree list`, `git status`, `git log`, `git diff`, reading any file under `.axp/`.

**Gate behind explicit user approval (use AskUserQuestion):**

- `axp run` (real run — spends tokens and time; show variant count × repeat and the estimated agent invocations)
- `git worktree add` / branch creation
- `git push`, `gh pr create` (Stage 6 — outward-facing)

Never write to the user's working tree outside `.axp/loops/` and the variant worktrees.

## Hard conventions (apply to every experiment this skill authors)

1. **Naive-user prompt.** `flow.prompt` is a realistic end-user task ("set up logging with this CLI"), never test-aware ("call the foo tool"). A test-aware prompt silently invalidates the experiment.
2. **Y₀ control.** Every matrix includes an unmodified-baseline variant. All claims are relative to Y₀.
3. **Repeat by default.** Agent behavior is stochastic. Default `--repeat 5` (ask the user to lower it only for cost reasons) and report rates ("tool fired 4/5"), not booleans.
4. **Identical mocks below the varied layer.** The surface the test agent touches (help text, errors, tool descriptions, docs, schema messages) must be real; anything beneath it (network, databases) may be stubbed — but with the *same* stub in every variant, with realistic exit codes and error text.
5. **One axis per lap.** Each lap varies one mutation axis from the playbook; the hypothesis is written down before the run.

## Per-artifact playbook

Branch on the artifact type at intake. Each variant's `setup` installs its build; mutation axes and metrics guide GENERATE and CHOOSE.

| Artifact | Mutation axes (pick ONE per lap) | Key introspection metrics |
|---|---|---|
| CLI | `--help` text; error-message wording; flag names; JSON vs text output | wrong-flag attempts, retries after error, help re-reads |
| MCP server | tool names; tool descriptions; granularity (one fat tool vs several thin) | activation rate (did the agent pick the tool at all), schema-validation failures, fallback to bash |
| Agent hooks | trigger condition; injected message wording; hook event choice | behavior delta post-hook, false-trigger rate |
| Install script | error handling; preflight checks; idempotency; verbosity | exit codes on fresh sandboxes, agent's recovery path on failure |
| Docs | structure (task-oriented vs reference); placement (README / llms.txt / agent config); length | task success with docs only, resort-to-reading-source, time to first correct call |
| Schema | field names; defaults; error message quality | validate-failure count before first valid instance, hallucinated fields |

---

## Stage 1 — INTAKE

Goal: pin down what is under test and anchor the baseline.

1. Identify the artifact type (table above) from the user's goal; ask if ambiguous.
2. Fingerprint the cwd against it: binary name in `Cargo.toml` / `package.json` `bin`, MCP server entrypoint, docs dir. If the repo doesn't contain the stated artifact, stop and ask.
3. Capture the baseline: `git rev-parse --short HEAD`, dirty-tree status. A dirty tree needs an explicit answer: is the dirty state or the committed state the baseline?
4. Pick a loop name (kebab-case, e.g. `mycli-help-text`) and create the loop home: `.axp/loops/<name>/` (add it to `.gitignore` if not covered).
5. Confirm in one gate (AskUserQuestion): artifact, baseline commit, loop name, run budget (variants × repeat).

## Stage 2 — GENERATE

Goal: a falsifiable variant plan, approved before any implementation.

1. Pick ONE mutation axis from the playbook for this lap. State the hypothesis in one sentence ("more example-driven --help reduces wrong-flag attempts").
2. Propose Y₁–Y₄ concrete mutations along that axis, plus Y₀ control. 3–5 candidates total is the sweet spot; more dilutes the repeat budget.
3. Design the evaluation:
   - `flow.prompt`: the naive-user task (convention 1).
   - Application tests: did the task outcome land (files exist, command exits 0, endpoint answers).
   - Introspection tests: read `$AXP_TRACE_PATH` with `jq` for the playbook metrics — e.g. `[ "$(jq '.tool_calls | length' "$AXP_TRACE_PATH")" -lt 30 ]`. Inspect the trace from a previous run (or lap 1's Y₀) to learn its exact fields before writing fine-grained assertions; do not invent fields.
4. Present the plan as a table (variant id, mutation, predicted effect) and gate on user OK.

## Stage 3 — IMPLEMENT

Goal: each variant's artifact built and staged; experiment YAML validated.

1. For each Yᵢ (i ≥ 1): `git worktree add .axp/loops/<name>/worktrees/y<i> <baseline>` (one approval covers all worktrees of the lap), implement the mutation there, and build the artifact. Independent mutations may be implemented by parallel subagents — one per worktree.
2. Author `.axp/loops/<name>/lap<N>.yaml`. If an experiment-authoring skill is available in the host environment (e.g. `axp-create-experiment`), use it; otherwise follow `axp schema` and the docs at https://docs.514.ai. Per variant:
   - `overrides.files` staging the variant's build, with `source` **relative to the YAML's directory** (e.g. `./worktrees/y1/target/release/mycli` → `dest: tools/mycli`); Y₀ stages the baseline build the same way.
   - `overrides.setup` for any in-sandbox install steps. Files land **before** `setup`, so setup may reference them.
   - Add an `.axpignore` (gitignore syntax) inside any staged *directory* to keep junk out; `.git/` is excluded automatically.
3. `axp validate lap<N>.yaml`, then `axp run --dry-run` and check the staging table for `MISSING`/`UNBOUND` rows.
4. Write or update `LOOP.md` (format below) with the lap's hypothesis and variant table.

### LOOP.md format

```markdown
# Loop: <name>
Goal: <the user's goal / originating insight>
Baseline: <commit> (<clean|dirty: which>)

## Lap <N> — axis: <mutation axis>
Hypothesis: <one sentence>
| Variant | Mutation | Result (filled after CHOOSE) |
|---|---|---|
| y0 | baseline control | |
| y1 | <mutation> | |
Run: <run id> · Decision: <winner y_k / another lap / stopped> — <user's words>
```

## Stage 4 — RUN

Goal: the lap's evaluations executed without babysitting.

1. Gate: show the final command and the cost shape (`N variants × R repeats = N×R agent runs`), get approval.
2. Run `axp run lap<N>.yaml --repeat <R> --jobs <J>` **in the background**; variants already parallelize inside one run, so `--jobs` ≥ variant count.
3. While it runs, monitor the newest `.axp/runs/<run_id>/` — per-variant `run.json` appears as variants finish. Report progress; on `setup_check_failed` or `staging_failed`, stop the lap and diagnose rather than letting the matrix burn budget.

## Stage 5 — CHOOSE

Goal: a ranked, evidence-backed comparison the user decides on.

1. Collect per-variant evidence from `.axp/runs/<run_id>/variants/*/`: `run.json` (status, exit reason, cost/usage fields), `tests/application/*.json` and `tests/introspection/*.json` (pass/fail + tails). With platform auth, `axp experiment run results get` aggregates the same; without it, the artifacts suffice.
2. Rank: (a) application-test pass **rate** across repeats — an unreliable winner is not a winner; (b) playbook introspection metrics; (c) cost/wall-clock as tiebreak. Everything is reported **relative to Y₀**.
3. Present a table: variant, mutation, pass rate, key metric(s), Δ vs Y₀. Call out surprises (Y₀ winning is a real and useful outcome — the hypothesis was wrong).
4. Fill the lap's Result column in `LOOP.md`, then gate: **promote the winner**, **run another lap**, or **stop**. Record the decision verbatim in `LOOP.md`.

## Stage 6 — LAP or PROMOTE

**Another lap:** return to Stage 2 with the winner as the new reference point. Either deepen the same axis (y3 → y3′, y3″) or switch to the next playbook axis. New worktrees branch from the winner's worktree commit. Increment the lap number; never overwrite a previous lap's YAML or worktrees.

**Promote:**
1. Create a branch from the baseline, apply the winning worktree's diff (`git diff <baseline>..<winner-worktree-head>` → apply, or cherry-pick its commits).
2. Gate, then `git push` and `gh pr create`. The PR body is generated from `LOOP.md`: goal, laps and hypotheses, the winner's metrics table vs Y₀ (with n = repeat count), and a link to the run artifacts.
3. Clean up on user confirmation: `git worktree remove` the lap worktrees (keep `LOOP.md` and the lap YAMLs — they are the experiment record).

**Stop:** fill in `LOOP.md` with why, so the loop can be resumed later.

## Failure handling

- `staging_failed` / `MISSING` source: the worktree build didn't produce the artifact where the YAML expects it — fix the `files:` entry or the build, re-`--dry-run`.
- `setup_check_failed`: the sandbox environment is broken for that variant; read `setup-checks/<name>.json` tails. Fix before re-running; do not compare a lap in which variants failed for environmental reasons.
- Identical results across all variants incl. Y₀: suspect the staging didn't take effect (confirm the staged file inside `workspace/` artifact copy) or the prompt never exercises the mutated surface — fix the experiment, not the artifact.
