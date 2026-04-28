---
name: 514-cli
allowed-tools:
  - Bash
  - Read
  - AskUserQuestion
description: >
  Use when interacting with the 514 platform — logging in,
  creating a new project from a template, linking an existing
  project, waiting for deployments to be ready, and browsing docs.
---

# 514 CLI Basics

The 514 CLI manages authentication, projects, and deployments on the hosting platform.

Command shape: `514 <resource> <action> [args] [flags]`

All commands accept `--json` for machine-readable output and `-o <ORG>` to override the active organization.

---

## 1. Authentication

Log in (opens browser for OAuth):
```
514 auth login
```

Check who's logged in:
```
514 auth whoami --json
```

Log out:
```
514 auth logout
```

### Organizations

List orgs the user belongs to:
```
514 org list --json
```

Switch the active org:
```
514 org switch <ORG>
```

---

## 2. Projects

List projects in the active org:
```
514 project list --json
```

### Creating a new project from a template

Bootstrap a new project from a template — creates the GitHub repo and triggers the first deploy.

```
514 project create --template <NAME> --name <PROJECT> --no-input
```

Useful flags:
- `--template <NAME>` — template to scaffold from (e.g. `typescript-express`). Bare `--template` opens an interactive picker.
- `--name <PROJECT>` — project name (also used for the new GitHub repo).
- `--org <ORG>` — target org (defaults to the active org).
- `--owner <GH_OWNER>` — GitHub owner for the new repo (defaults to the authenticated user).
- `--visibility public|private` — repo visibility (default `private`).
- `--no-input` — required in non-interactive contexts; without it the CLI prompts.

Exit 0 means the build was triggered, not that traffic is serving — wait for it (see Deployments below). Don't follow this with `project setup` or `git clone`; the platform builds from the GitHub repo directly.

### Linking an existing project

If the user already has a local repo and a 514 project, link them:
```
514 project link [ORG/PROJECT]
```
When `ORG/PROJECT` is omitted the CLI shows an interactive picker. Use `--force-relink` to switch to a different project.

### Setting up an existing project locally

Clone a 514 project and set up the local dev environment:
```
514 project setup <ORG/PROJECT>
```
Useful flags:
- `--path <DIR>` — parent directory for clone
- `--branch <NAME>` — create a feature branch
- `--no-branch` — skip branch creation
- `--run install` — run dependency install after clone
- `--push` — push the branch after creation

---

## 3. Deployments

List deployments for a project:
```
514 deployment list --project <ORG/PROJECT> --json
```
Useful flags:
- `--status <STATUS>` — filter by status (repeatable)
- `--branch-id <ID>` — filter by branch
- `--limit <N>` — number of results (default: 20)

When running inside a linked repo, `--project` can be omitted.

### Waiting for a deployment

```
514 deployment wait [DEPLOY_ID] --project <ORG/PROJECT>
```
Polls until the deploy reaches a final status. With no `DEPLOY_ID`, picks the latest deploy on the current git branch (must be in a linked repo). Final statuses: `Deployed` (success), `Terminated` / `Deleted` (gone), `Error` / `OrgInfraError` / `RedisCredentialsFailed` (failed).

### Verifying the deployed URL

After `Deployed`, probe the URL directly — ingress can lag the status by ~30s:
```
GET <url>/health
```
Response: `{"healthy":[...],"unhealthy":[]}`. Treat the deployment as serving when `unhealthy` is empty and at minimum `ClickHouse`, `Redpanda`, and `Consumption API` are in `healthy`. Transient `404`s or `"fault filter abort"` during warmup are expected — retry every few seconds.

---

## 4. Docs

Search the 514 documentation from the terminal:
```
514 doc search <QUERY>
```

Show a specific page:
```
514 doc show <PAGE>
```

List all available pages:
```
514 doc list --json
```

---

## 5. Updating the CLI

```
514 cli update
```

---

## Quick reference

| What | Command |
|------|---------|
| Log in | `514 auth login` |
| Who am I | `514 auth whoami --json` |
| Log out | `514 auth logout` |
| List orgs | `514 org list --json` |
| Switch org | `514 org switch <ORG>` |
| List projects | `514 project list --json` |
| Create from template | `514 project create --template <NAME> --name <PROJECT> --no-input` |
| Link project | `514 project link [ORG/PROJECT]` |
| Set up project locally | `514 project setup <ORG/PROJECT>` |
| List deployments | `514 deployment list --project <ORG/PROJECT> --json` |
| Wait for deployment | `514 deployment wait [DEPLOY_ID] --project <ORG/PROJECT>` |
| Health check | `curl <url>/health` |
| Search docs | `514 doc search <QUERY>` |
| Update CLI | `514 cli update` |
