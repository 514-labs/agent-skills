# CLAUDE.md

This file provides guidance to AI coding agents working with this repository.

## Repository Purpose

This is an **Agent Skills** repository — a collection of skills that extend AI coding agents with domain-specific expertise. It is currently a bare skeleton awaiting new skills.

Skills follow the open specification at [agentskills.io](https://agentskills.io).

## Repository Structure

```
agent-skills/
├── skills/
│   └── _template/        # Starting point for new skills
│       ├── SKILL.md      # Skill definition (frontmatter + instructions)
│       ├── metadata.json # Version, organization, abstract
│       └── README.md     # Maintainer guide and conventions
├── AGENTS.md             # Agent guidance (skill format, conventions)
└── README.md             # User-facing documentation
```

## Adding a New Skill

1. Copy `skills/_template/` to `skills/{namespace}/{skill-name}/`
2. Fill in `SKILL.md` — set `name` and `description` in the frontmatter, write the instructions
3. Update `metadata.json` with the abstract and references
4. Replace the README with maintainer notes
5. Add the skill to the table in the root `README.md`

## Conventions

- Skill directories are `kebab-case`, grouped under a namespace directory (e.g. `skills/514/my-skill/`)
- `SKILL.md` is always uppercase, always that exact filename
- Keep `SKILL.md` under 500 lines — only the name and description load at startup; the full file loads on demand
- Write a specific `description` so agents know exactly when to activate the skill
