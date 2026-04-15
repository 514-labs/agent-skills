---
name: 514-use-moose
argument-hint: "[optional: project-directory or app name]"
allowed-tools:
  - Bash
  - Read
  - AskUserQuestion
description: >
  Use for open-ended prompts about building a data/analytics agent on MooseStack when the
  user needs a new project from the official agent template only. Walks harness init
  (typescript-agent) and the template Quickstart—nothing else. Triggers: analytics agent,
  production-ready analytics agent, Moose harness template, typescript-agent, data
  engineering agent greenfield, multi-tenant analytics harness from scratch.
---

# Use Moose (new analytics agent from template)

**Single goal:** take a vague “build an analytics / data-engineering agent” ask and execute only the **new-project** path: scaffold from the official **`typescript-agent`** harness template and get it **running locally** per the template Quickstart.

**Out of scope for this skill:** product design, custom ingestion, semantic layer work, Langfuse, guardrails, deploy, or editing an **existing** Moose repo—after Quickstart works, hand off to the full tutorial or other skills.

---

## 1. Confirm intent

Use **AskUserQuestion** if needed:

- They want a **new** repo from the **typescript-agent** template (not “add to my current Moose app”).
- They can run **Docker** for `pnpm dev:start` and are okay installing **514** + **moose** CLIs.

If they already have a Moose project or only need ClickHouse tuning / 514 deploy help, **do not** run this flow—point them to the right doc or skill instead.

---

## 2. Pull exact commands from Moose docs

Do not guess harness flags. Prefer:

```bash
moose docs guides/production-ready-analytics-agent/tutorial --lang ts --raw
```

Use that page as the source of truth for `moose harness init` and Quickstart. If the CLI surface differs, **what the docs show wins**.

---

## 3. Install harness CLIs (user approval)

From the tutorial (“Get Running Locally”): install **514** and **moose** via the documented installer (typically a `curl` one-liner). Treat it like any sensitive shell snippet—show it and get explicit approval before running.

---

## 4. Scaffold the template

From the same tutorial section, run **`moose harness init`** with:

- `--template typescript-agent` (required for this skill),
- `--name` from the user (or a sensible default they confirm),
- `--agent` flags only for agents they use (omit to auto-detect per docs),
- `--lsp` when they want SQL/LSP support (recommended in docs).

Example shape (adjust names/flags per live docs):

```bash
moose harness init \
  --name my-analytics-agent-app \
  --template typescript-agent \
  --lsp
```

Then follow the **Quickstart** in the [template README](https://github.com/514-labs/moosestack/tree/main/templates/typescript-agent#quickstart): dependency install, `pnpm env:prepare`, AI provider env for the **in-app** analytics agents, `pnpm dev:start`, open the app URL, sign in as demo tenants until chat works as described in the tutorial.

**Stop this skill** when Quickstart success criteria from the tutorial are met (e.g. streamed chat + tenant-scoped data as in the doc).

---

## 5. What’s next (not this skill)

For customizing data, APIs, MCP tools, multitenancy, guardrails, and deploy, continue with the full guide:

- Tutorial (all sections): `moose docs guides/production-ready-analytics-agent/tutorial --lang ts --raw`
- Or open in browser: [Production-Ready Analytics Agent — Tutorial](https://docs.fiveonefour.com/guides/production-ready-analytics-agent/tutorial)
