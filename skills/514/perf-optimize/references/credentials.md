# ClickHouse Credential Setup for Benchmarks

## Export shared credentials once

Export platform variables into the benchmark scaffold's `.env.preview` from the baseline branch. This file becomes the shared ClickHouse connection layer for every benchmark run.

```bash
514 env list --project <PROJECT> -b perf/baseline --platform --dotenv > .env.preview
```

## Preferred contract: URL

Platform vars expose `MOOSE_CLICKHOUSE_CONFIG__URL`. Validate that `.env.preview` contains it.

## Deriving split env vars from the URL

If the benchmark scaffold needs individual Moose ClickHouse env vars instead of a single URL, add a parsing step in the benchmark setup script to derive and write these keys into `.env.preview`:


| Env var                              | Derivation                                |
| ------------------------------------ | ----------------------------------------- |
| `MOOSE_CLICKHOUSE_CONFIG__HOST`      | URL hostname                              |
| `MOOSE_CLICKHOUSE_CONFIG__HOST_PORT` | URL port                                  |
| `MOOSE_CLICKHOUSE_CONFIG__USER`      | URL username                              |
| `MOOSE_CLICKHOUSE_CONFIG__PASSWORD`  | URL password                              |
| `MOOSE_CLICKHOUSE_CONFIG__DB_NAME`   | URL path database segment                 |
| `MOOSE_CLICKHOUSE_CONFIG__USE_SSL`   | `true` when scheme is HTTPS, else `false` |


Do this derivation once when preparing `.env.preview`.

## Resolving the baseline DB name

Store as `BASELINE_DB`. If `.env.preview` already includes `MOOSE_CLICKHOUSE_CONFIG__DB_NAME`, use that value. Otherwise parse it from `MOOSE_CLICKHOUSE_CONFIG__URL`.

## Reuse across candidate branches

After `.env.preview` exists, do not re-export shared settings (host, port, user, password, SSL) for each candidate. Only override `MOOSE_CLICKHOUSE_CONFIG__DB_NAME` when switching benchmark targets.

## Blocker conditions

Stop and carry a blocker if:

- the deployment appears but env vars cannot be resolved
- `.env.preview` cannot be populated
- `MOOSE_CLICKHOUSE_CONFIG__URL` is missing
- any required derived env var cannot be produced from the URL

