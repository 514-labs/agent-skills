# ClickHouse Credential Setup for Benchmarks

## Export shared credentials once

Export platform variables into the benchmark scaffold's `.env.preview` from the baseline branch. This file becomes the shared ClickHouse connection layer for every benchmark run.

```bash
514 env list --project <PROJECT> -b perf/baseline --platform --dotenv > .env.preview
```

Replace `perf/baseline` with the actual baseline branch name if it differs.

## Expected env vars

The platform export writes both the full connection URL and the individual split credential vars:

| Env var | Value |
| ------- | ----- |
| `MOOSE_CLICKHOUSE_CONFIG__URL` | Full HTTPS connection string |
| `MOOSE_CLICKHOUSE_CONFIG__HOST` | Hostname |
| `MOOSE_CLICKHOUSE_CONFIG__HOST_PORT` | Port |
| `MOOSE_CLICKHOUSE_CONFIG__USER` | Username |
| `MOOSE_CLICKHOUSE_CONFIG__PASSWORD` | Password |
| `MOOSE_CLICKHOUSE_CONFIG__DB_NAME` | Database name |
Validate that `.env.preview` contains the vars the benchmark scaffold actually reads. The split vars are ready to use directly — no URL parsing step is needed.

## Resolving the baseline DB name

Store as `BASELINE_DB`. Read `MOOSE_CLICKHOUSE_CONFIG__DB_NAME` from `.env.preview`.

## Reuse across candidate branches

After `.env.preview` exists, do not re-export shared settings (host, port, user, password, SSL) for each candidate. Only override `MOOSE_CLICKHOUSE_CONFIG__DB_NAME` when switching benchmark targets.

## Blocker conditions

Stop and carry a blocker if:

- the deployment appears but env vars cannot be resolved
- `.env.preview` cannot be populated
- `MOOSE_CLICKHOUSE_CONFIG__DB_NAME` is missing
