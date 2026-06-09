# AGENTS.md

This file provides guidance to AI coding agents (Claude Code, Cursor, Copilot, etc.) when working with code in this repository.

## Repository Overview

A collection of skills for AI coding agents, following the open specification at [agentskills.io](https://agentskills.io). The repo is currently a bare skeleton — skills live under `skills/{namespace}/{skill-name}/`.

## Repository Structure

```
agent-skills/
├── skills/
│   └── _template/        # Starting point for new skills
│       ├── SKILL.md      # Skill definition (frontmatter + instructions)
│       ├── metadata.json # Version, organization, abstract
│       └── README.md     # Maintainer guide and conventions
├── .github/
│   └── workflows/
│       └── ci.yml        # Validates skill structure
├── AGENTS.md             # This file
├── CLAUDE.md             # Claude Code-specific guidance
└── README.md             # User-facing documentation
```

## Creating a New Skill

1. Copy `skills/_template/` to `skills/{namespace}/{skill-name}/`
2. Fill in the `SKILL.md` frontmatter (`name`, `description`) and body
3. Update `metadata.json` (version, abstract, references)
4. Replace the README with maintainer notes
5. Add the skill to the table in the root `README.md`

### Naming Conventions

- **Namespace and skill directories**: `kebab-case` (e.g. `skills/514/my-skill/`)
- **SKILL.md**: always uppercase, always this exact filename

### SKILL.md Format

```markdown
---
name: {skill-name}
description: {One sentence describing when to use this skill. Include trigger phrases.}
---

# {Skill Title}

{What the skill does.}

## When to Apply

- {Use case 1}

## Instructions

{Step-by-step guidance for the agent.}
```

### Best Practices for Context Efficiency

Skills are loaded on-demand — only the skill name and description are loaded at startup. The full `SKILL.md` loads into context only when the agent decides the skill is relevant.

- **Keep SKILL.md under 500 lines** — put detailed reference material in separate files
- **Write specific descriptions** — helps the agent know exactly when to activate the skill
- **Use progressive disclosure** — reference supporting files that get read only when needed

## Contributing Guidelines

- Keep skills focused and actionable
- Use real code that can be executed (avoid pseudo-code)
- Test instructions before committing
- Follow the existing style and structure
