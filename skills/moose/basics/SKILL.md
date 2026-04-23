---
name: moose-basics
allowed-tools:
  - Bash
  - Read
  - AskUserQuestion
description: >
  MUST USE when defining Stream, IngestApi, Api, MaterializedView, View,
  OlapTable, WebApp, or Workflow. Use when importing from `@514labs/moose-lib`.
  Use when `moose dev` fails, `moose query` returns unexpected results,
  hot-reload seems stuck, or an ingest/egress endpoint isn't responding.
when_to_use: >
  Explains what `moose dev` is doing under the hood, canonical class
  signatures (Stream, IngestApi, Api, MaterializedView, View, OlapTable,
  WebApp), URL conventions for ingest and analytics APIs, how to read
  `moose.log`, how to use the moose-dev MCP for introspection, and the
  recovery recipe when hot-reload gets stuck.
paths: "**/*.ts,**/*.tsx"
---

# Moose Basics

A MooseStack project is a declarative TypeScript/Python project that gets translated into a running analytics stack: HTTP ingest → Redpanda → ClickHouse → aggregation views → HTTP egress APIs. `moose dev` runs that stack locally and hot-reloads when you edit `app/`.

The sections below are independent — jump to whichever is relevant.

## Golden rules — apply always

1. **Use `moose ls` (or the `mcp__moose-dev__get_infra_map` MCP tool) as the source of truth for URLs and table names.** Never curl or query a guessed path. After every edit to `app/index.ts`, run `moose ls`. If your route/table isn't listed, the TS compile failed — check logs (rule 3), don't keep poking.
2. **Use the explicit `OlapTable` + `Stream` + `IngestApi` trio.** Do NOT use `IngestPipeline` — it's deprecated and will misbehave. If it appears in scaffolded comments or your training memory, ignore it.
3. **Use the `mcp__moose-dev__get_logs` MCP tool to diagnose errors.** It takes a `level` filter (ERROR/WARN/INFO) and a `search` regex so you can jump straight to compile failures, schema conflicts, or ingest errors instead of `tail`-ing raw `moose.log`. Call it first when ingest returns errors, tables are missing, or a hot-reload seems stuck. Only fall back to `grep -iE 'error|failed|cannot' moose.log` if the MCP tool is unavailable.

---

## 1. What `moose dev` is doing

When you run `moose dev --dockerless` inside a scaffolded project, Moose starts (and supervises) a local stack as native host processes:

| Component | Port | Role |
|-----------|------|------|
| ClickHouse | 18123 (HTTP), 9000 (native) | OLAP store; tables created from your `OlapTable` / `MaterializedView` / `View` declarations |
| Redpanda | 19092 | Kafka-compatible buffer between HTTP ingest and ClickHouse |
| Redis | 6379 | Coordination + cache |
| Temporal | 7233 | Workflow engine (for `Workflow` definitions) |
| Moose webserver | 4000 | HTTP surface: `POST /ingest/<Pipeline>` and any `Api<...>` routes under `/api/...` |
| moose-dev MCP | `http://localhost:4000/mcp` | Introspection MCP — see §4 |

`--dockerless` means Moose runs these as native processes, not Docker containers.

Moose then:
1. Reads your `app/` directory (entry: `app/index.ts`).
2. Derives declared infrastructure: tables, streams, ingest endpoints, APIs, materialized views, workflows.
3. Reconciles against reality via DDL on ClickHouse, topic creation on Redpanda, process spawns.
4. Watches `app/` for changes and re-reconciles on save (**hot-reload**).

Runtime data flow:
```
POST /ingest/UserActivity
  → Redpanda topic "UserActivity"
  → sync process consumes and writes rows
  → ClickHouse table local.UserActivity
```

Ingest and sync are decoupled: `POST /ingest/...` returns 200 as long as the webserver is up and the route is registered, **even if the sync pump is broken**. So a 200 here doesn't guarantee data actually landed — verify with `moose query`.

---

## 2. Running a Moose project

Start the dev stack (logs go to stdout; redirect if you need to read them later):
```
nohup moose dev --dockerless > moose.log 2>&1 &
```
Wait for health:
```
for i in $(seq 1 30); do
  curl -sf http://localhost:4000/health && break
  sleep 1
done
```

Stop local infra (preserves data):
```
moose clean
```

List declared infrastructure — always trust `moose ls` over speculation:
```
moose ls
```
Shows tables, streams, ingest APIs, analytics APIs, materialized views, functions, workflows. Table names it prints are the names you query directly. (Do **not** prefix with `local_` in queries; that's an internal id form that has been phased out.)

Run SQL against the local ClickHouse:
```
moose query "SELECT count() FROM UserActivity"
```
No auth needed; queries run in the default `local` database. Use unqualified table names — `SELECT ... FROM UserActivity`, not `FROM local.UserActivity` (the SQL parser in `moose query` rejects `database.table` forms like `currentDatabase().X`).

Look up documentation for a concept:
```
moose docs                                      # list topics
moose docs search "MaterializedView"
moose docs moosestack/apis/analytics-api
```

Use `moose docs` **before** guessing syntax. It's faster and correct.

---

## 3. Reading logs when something is broken

Agents routinely miss the fact that the error is already in the log. Always check.

### Where logs live

| Path | What's in it |
|---|---|
| `moose.log` (wherever you redirected) | Combined Moose log + stderr of spawned subprocesses |
| `.moose/native_infra/clickhouse/logs/clickhouse-server.log` | ClickHouse server log (warnings, DDL failures, auth errors) |
| `.moose/native_infra/redpanda/logs/redpanda.log` | Redpanda broker log |

### Common signatures to grep for

| Grep | Meaning & what to do |
|---|---|
| `grep -iE 'error\|failed\|refused\|panic' moose.log` | Any broken infra — read the first hit; the earliest error is usually the root cause |
| `Failed to run moose-tspc` | `node_modules` missing — run `npm install` in the project root |
| `UNKNOWN_TABLE` | Query hit a table that doesn't exist — check `moose ls` for the real name |
| `REQUIRED_PASSWORD` | Hit ClickHouse HTTP on `:18123` without `panda:pandapass` — use `moose query` instead |
| `ALTER MODIFY COLUMN` + `Cannot convert` | Incompatible schema change; existing rows can't be cast to the new column type. See §6 |
| `connection refused` on `:4000` | Webserver isn't running — `moose dev` crashed or didn't start |
| `Keeper.*(connection\|timeout)` | ClickHouse Keeper not ready yet; wait 5 s and retry, or restart |

### Check what's actually running

```
ps aux | grep -E 'moose|clickhouse|redpanda|redis|temporal' | grep -v grep
curl -sf http://localhost:4000/health
```

If `/health` doesn't respond, the webserver isn't up. Read `moose.log` from the top — the first error is the cause.

---

## 4. Using the moose-dev MCP server

A running `moose dev` exposes an MCP server at `http://localhost:4000/mcp`, pre-configured in Claude Code as `mcp__moose-dev__*`. It's the authoritative source of truth for project state — use it instead of trial-and-erroring `curl` paths.

**When to reach for it:**
- You edited `app/index.ts` and want to confirm the change registered
- You're unsure what tables/streams/APIs exist or what URL an API serves at
- You want schema/column details without running SQL

If MCP isn't available, the equivalent CLI fallbacks are:
```
moose ls                                               # all declared infra
moose query "DESCRIBE TABLE UserActivity"              # column schema
moose query "SELECT name FROM system.tables WHERE database='local'"
```

---

## 5. Defining infrastructure (TypeScript)

### Ingest → stream → table

Compose three declarations: an `OlapTable`, a `Stream` wired to the table as its `destination`, and an `IngestApi` wired to the stream as its `destination`. Each is a separate first-class resource — use whichever subset you need.

```ts
// app/index.ts
import { OlapTable, Stream, IngestApi } from "@514labs/moose-lib";

export interface UserActivity {
  event_id: string;
  event_ts: Date;
  user_id: string;
  action: string;
  duration_ms: number;
}

// ClickHouse table — the persistent store
export const UserActivityTable = new OlapTable<UserActivity>("UserActivity", {
  orderByFields: ["event_ts", "user_id"],
});

// Redpanda topic — buffer between ingest and table, auto-sinks into the table
export const UserActivityStream = new Stream<UserActivity>("UserActivity", {
  destination: UserActivityTable,
});

// HTTP ingest — POST /ingest/UserActivity, produces into the stream
export const UserActivityIngest = new IngestApi<UserActivity>("UserActivity", {
  destination: UserActivityStream,
});
```

Save → `moose dev` hot-reloads.

> **⚠️ Do not use `IngestPipeline`**. The bundled `new IngestPipeline<T>(name, {ingestApi, stream, table})` shorthand is **deprecated**. Always use the explicit `OlapTable` + `Stream` + `IngestApi` trio shown above. If the scaffolded `app/index.ts` (or any example you find) mentions `IngestPipeline`, ignore it — replace or rewrite with the trio. If the trio hits a compile error, **debug the trio** — do NOT retreat to `IngestPipeline` as a "simpler fallback"; it will fail in the current runtime.

> **🚨 Do not guess URLs. Run `moose ls` after EVERY infra change.** `moose dev` hot-reload may or may not have succeeded, and the actual routes Moose exposes are what `moose ls` prints — not what you expect based on the class name. Before curling any endpoint, confirm the exact URL:

```
$ moose ls
Tables
│ UserActivity │ event_id, event_ts, user_id, action, duration_ms │
Streams
│ UserActivity │ ... │ destination: UserActivity │
Ingest APIs
│ UserActivity │ path: ingest/UserActivity │ method: POST │
```

The `path` column is authoritative. If `moose ls` doesn't list your ingest API, the TS compile failed — check `moose.log`, fix the error, do not POST events.

Post events (confirm path with `moose ls` first):
```
curl -X POST http://localhost:4000/ingest/UserActivity \
  -H 'Content-Type: application/json' \
  -d '{"event_id":"e1","event_ts":"2026-01-15T09:00:00Z","user_id":"u1","action":"view","duration_ms":100}'
```

If the `moose-dev` MCP (`mcp__moose-dev__*`) is available, `get_infra_map` is strictly better than `moose ls` — structured output, always current, tells you exactly which URL serves each API. Use it whenever you edit `app/index.ts`.

### Analytics API (egress)

The second type parameter of `Api<T, R>` is the **response shape** — for list endpoints this is an **array type** like `TopProductsRow[]`, not a single row. The handler's `Promise<R>` must match.

```ts
import { Api } from "@514labs/moose-lib";

interface TopProductsInput { limit?: number; }
interface TopProductsRow { product_id: string; count: number; }

export const topProducts = new Api<TopProductsInput, TopProductsRow[]>(
  "top-products",
  async ({ limit = 10 }, { client, sql }) => {
    const query = sql.statement`
      SELECT product_id, count() AS count
      FROM ${UserActivityTable}
      GROUP BY product_id
      ORDER BY count DESC
      LIMIT ${limit}
    `;
    const data = await client.query.execute<TopProductsRow>(query);
    return await data.json();
  }
);
```

Key points:
- `Api<TInput, TRow[]>` — second parameter is the **array** response shape.
- `sql.statement\`…\`` — use `sql.statement`, not bare `` sql`…` ``. Interpolating an `OlapTable` (`${UserActivityTable}`) or a `View` inserts the correct table/view name. **To query from a `MaterializedView`, use `${theMV.targetTable}`** — the MV itself is not an accepted `sql.statement` interpolation type.
- `client.query.execute<TRow>(query)` — pass the **row** type as the generic (singular). `.json()` then returns `Promise<TRow[]>`, which matches the handler signature.
- Handler's second arg is `{ client, sql }` — destructured from `MooseUtils`. Don't annotate the type; let TS infer.
- **After writing the Api, run `moose ls`** to confirm it registered and to read the actual URL. Do NOT curl a guessed path like `/api/top-products` without first verifying with `moose ls` or the `get_infra_map` MCP tool — if compilation failed the route won't exist, and the default path convention may not match what you expect.

### Materialized view

Keeps a derived ClickHouse table fresh as rows land in the source table. Pass the source `OlapTable`(s) in `selectTables` so Moose knows what triggers the materialization.

```ts
import { MaterializedView, sql } from "@514labs/moose-lib";

interface HourlyActivityRow {
  hour: Date;
  action: string;
  event_count: number;
}

export const hourlyActivity = new MaterializedView<HourlyActivityRow>({
  tableName: "HourlyActivity",
  materializedViewName: "hourly_activity_mv",
  orderByFields: ["hour", "action"],
  selectStatement: sql.statement`
    SELECT
      toStartOfHour(event_ts) AS hour,
      action,
      count() AS event_count
    FROM ${UserActivityTable}
    GROUP BY hour, action
  `,
  selectTables: [UserActivityTable],
});
```

- Use `sql.statement\`…\`` (same as analytics APIs, different from `View` below).
- `selectTables` is **required** — omit and the MV won't refresh.

### View (simple logical view)

A lightweight ClickHouse VIEW — no materialization, just a named query you can reference.

```ts
import { View, sql } from "@514labs/moose-lib";

export const RecentActivityView = new View(
  "RecentActivityView",
  sql`SELECT * FROM ${UserActivityTable} WHERE event_ts > now() - INTERVAL 1 DAY`,
  [UserActivityTable],
);
```

- Third arg is the source-tables list, same purpose as `selectTables` above.
- `View` uses bare `` sql`…` ``, not `sql.statement`.

### WebApp (mount a custom Express/Fastify app)

If you need request handling beyond `Api<…>` (custom middleware, static files, a full framework), mount a Node web app on a sub-path of the Moose webserver.

```ts
import { WebApp } from "@514labs/moose-lib";
import express from "express";

const app = express();
app.get("/custom", (_req, res) => res.json({ hello: "world" }));

export const customWebApp = new WebApp("custom", app, {
  mountPath: "/custom",
});
```

`WebApp` works with any Connect-compatible framework (Express, Fastify, etc.). Registered under `/<mountPath>` on port 4000.

---

## 6. Recovery when `moose dev` is in a bad state

Symptoms: ingest returns 200 but new rows don't appear, `moose ls` errors, `curl /health` hangs or 503s, or `moose dev` restart exits immediately.

**Step 1: always read the log first.**
```
tail -80 moose.log
grep -iE 'error|failed|refused|cannot convert|keeper' moose.log | tail -20
```
The error tells you which recipe to follow below.

### Common failure modes

**(a) TypeScript compilation fails (`Failed to run moose-tspc`)**
→ `cd` into project root and run `npm install`. Then restart `moose dev`.

**(b) Schema drift (`ALTER ... Cannot convert column`)**
→ You changed a column type in a way that can't be applied to existing rows. Two options:
- **Revert the offending edit** (simplest; hot-reload will recover)
- **Reset local data**: `pkill -f 'moose dev'; moose clean` (or `rm -rf .moose` if `moose clean` doesn't help), then restart. Loses all rows in the dev DB.

**(c) Port already in use**
→ Another process is bound. `pkill -f 'moose dev'; sleep 2`, then restart.

**(d) Ingest returns 200 but `moose query` shows 0 rows**
→ Sync pump is broken (common after a failed hot-reload). Check `moose.log` for errors. Most likely root cause is schema drift — see (b). A clean restart usually fixes it.

### Clean restart recipe

```
pkill -f 'moose dev' 2>/dev/null; sleep 2
moose clean 2>/dev/null || true
rm -rf .moose
nohup moose dev --dockerless > moose.log 2>&1 &
for i in $(seq 1 45); do
  curl -sf http://localhost:4000/health && break
  sleep 1
done
moose ls   # sanity check
```

If `/health` still doesn't respond after 45 s, read `moose.log` from the top.

---

## Quick reference

| Task | Command |
|---|---|
| Start stack | `nohup moose dev --dockerless > moose.log 2>&1 &` |
| Stop (preserve data) | `moose clean` |
| List declared infra | `moose ls` |
| Run SQL | `moose query "SELECT ..."` |
| Describe table | `moose query "DESCRIBE <Name>"` |
| Find docs | `moose docs search "<topic>"` |
| Tail logs | `tail -f moose.log` |
| Find errors | `grep -iE 'error\|failed\|refused' moose.log` |
| Health check | `curl -sf http://localhost:4000/health` |
| Ingest event | `curl -X POST http://localhost:4000/ingest/<Pipeline> -H 'Content-Type: application/json' -d '{...}'` |

## When `moose dev` starts acting odd

1. `curl -sf http://localhost:4000/health` — is the webserver alive?
2. `tail -80 moose.log` — what was the last error?
3. `moose ls` — does declared state match expectation?
4. `moose query "SELECT count() FROM <table>"` — is data actually landing?
5. If everything above is confused: clean restart (§6).

Do not fabricate APIs with a plain Node/Express server when Moose's `Api` abstraction isn't cooperating — use `moose docs search "Api"`, check `moose ls` for the registered path, and read `moose.log` for the compilation/registration error. A fake server will pass a "does HTTP respond" assertion but won't be reading from ClickHouse.
