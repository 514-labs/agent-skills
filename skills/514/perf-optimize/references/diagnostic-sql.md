# Diagnostic SQL Templates

Batch these together and **prompt the user once** showing all diagnostic SQL before running.

## Part sizes

Storage footprint per table and partition:

```
514 clickhouse query 'SELECT database, table, partition, sum(rows) AS total_rows, formatReadableSize(sum(bytes_on_disk)) AS disk_size, count() AS part_count FROM system.parts WHERE active = 1 AND database NOT IN ('\''system'\'', '\''INFORMATION_SCHEMA'\'', '\''information_schema'\'') GROUP BY database, table, partition ORDER BY sum(bytes_on_disk) DESC LIMIT 20' --project <PROJECT> --branch <BRANCH> --json
```

## Column cardinality

Candidates for `LowCardinality`:

```
514 clickhouse query 'SELECT database, table, name AS column, type FROM system.columns WHERE database NOT IN ('\''system'\'', '\''INFORMATION_SCHEMA'\'', '\''information_schema'\'') AND type LIKE '\''%String%'\'' ORDER BY database, table, name' --project <PROJECT> --branch <BRANCH> --json
```

## Row counts for benchmark tables

Used in Stage 4e and Stage 5 step 8:

```
514 clickhouse query 'SELECT table, sum(rows) AS total_rows FROM system.parts WHERE active = 1 AND database = '\''<DB>'\'' AND table IN (<TABLE_LIST>) GROUP BY table ORDER BY table' --project <PROJECT> --branch <BRANCH> --json
```

