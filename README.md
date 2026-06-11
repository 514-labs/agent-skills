# Agent Skills

A collection of skills that extend AI coding agents with domain-specific expertise.

Skills follow the open specification at [agentskills.io](https://agentskills.io).

## Install

```bash
npx skills add 514-labs/agent-skills
```

Works with Claude Code, Cursor, Copilot, Windsurf, Gemini CLI, Codex, and [20+ other agents](https://agentskills.io).

## Skills

| Skill | Description |
|-------|-------------|
| [`axp-build-loop`](./skills/axp/build-loop/) | Drive the axp experiment build loop from a coding-agent chat: generate variants of a CLI / MCP server / hooks / install script / docs / schema, build them in parallel worktrees, evaluate them in isolated sandboxes against a naive agent, rank vs a baseline control, then promote the winner to a PR or iterate another lap |

## Adding a Skill

Copy [`skills/_template/`](./skills/_template/) to `skills/{namespace}/{skill-name}/`, fill in `SKILL.md` and `metadata.json`, and add a row to the table above. See the [template README](./skills/_template/README.md) for conventions.

## License

Apache 2.0 — see [LICENSE](./LICENSE).
