# Skill Template

Copy this directory to create a new skill:

```bash
cp -r skills/_template skills/{namespace}/{skill-name}
```

Then:

1. Edit `SKILL.md` — set `name` and `description` in the frontmatter, write the skill body
2. Edit `metadata.json` — set the abstract and any reference links
3. Replace this README with maintainer notes for the new skill
4. Add the skill to the table in the repo root `README.md`

## Conventions

- Skill directories are `kebab-case`, grouped under a namespace directory (e.g. `skills/514/my-skill/`)
- `SKILL.md` is always uppercase and always that exact filename
- Keep `SKILL.md` under 500 lines — only the name and description are loaded at startup; the full file loads on demand
- Write a specific `description` so agents know exactly when to activate the skill
