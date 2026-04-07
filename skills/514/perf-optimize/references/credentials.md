# ClickHouse Credential Setup for Benchmarks

## Export credentials per branch

Before running benchmarks against any branch, export that branch's platform variables into `.env.preview`. Re-export each time you switch benchmark targets.

```bash
514 env list --project <PROJECT> -b <BRANCH> --platform --dotenv > .env.preview
```

This gives the benchmark scaffold a complete, self-contained set of credentials for the target branch — no manual overrides needed.

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

Validate that `.env.preview` contains the vars the benchmark scaffold actually reads.

## Blocker conditions

Stop and carry a blocker if:

- the deployment appears but env vars cannot be resolved
- `.env.preview` cannot be populated
- `MOOSE_CLICKHOUSE_CONFIG__DB_NAME` is missing
