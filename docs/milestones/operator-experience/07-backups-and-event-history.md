# Backups and event-history plan

## Existing backup surface

The source already supports target discovery, run history, manual runs,
schedule read/update/removal, retention read/update/prune and scheduler ticks.
File stores exist for run history, target policy, scheduler cursor and claims.
The dashboard currently exposes these through primitive forms.

## Backup delivery

- CLI: list, status, runs and run target first; schedule/retention commands only
  when their complete side effects and confirmations are documented.
- Dashboard: Backups page with target status, recent runs, schedule, retention,
  busy state and explicit destructive prune UX.
- Overview: scheduler state, latest success/failure and interrupted runs.
- Preserve local-only artifact and no-restore limitations in the UI/docs.

## Existing event-history surface

The segmented store supports query, readiness, integrity, rotation, retention,
prune and exports. Administrative authorization decisions and protected
mutations already use the audit trail.

## Event delivery

- CLI: `atlas events`, filters, pagination and a defined `--tail` strategy.
- Dashboard: Events page with filters, status, actor, target, operation and
  integrity/retention summaries.
- Exports/download remain explicit protected operations.
- Tail must poll or stream through a bounded protected API; it must not read
  persistence files directly.

## New milestone events

Add domain/audit vocabulary for:

- CLI-originated service mutations (same backend operation, source metadata
  may identify presentation channel without changing principal);
- service schedule update/removal;
- machine schedule update/removal;
- any new backup mutation;
- diagnostic fix only in a future ADR, not this milestone.

Do not create duplicate events merely because both CLI and API adapters observe
the same mutation. The protected application operation owns the audit record.

## Tests

- backup command/page mappings;
- busy/conflict and interrupted state;
- event filters, pagination/tail cancellation;
- audit started/succeeded/rejected/failed sequences;
- no secret-bearing fields;
- segmented store integrity/retention/export regressions.
