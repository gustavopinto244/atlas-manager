# Backups and event-history plan

## Existing backup surface

The source already supports target discovery, run history, manual runs,
schedule read/update/removal, retention read/update/prune and scheduler ticks.
File stores exist for run history, target policy, scheduler cursor and claims.
The dashboard currently exposes these through primitive forms.

## Backup delivery

- CLI: delivered — `backups list/status/runs` (read), `backups run` (manual
  run), `backups run-status <run-id>`, `backups schedule show/set/remove` and
  `backups retention show/set/prune`. All reuse the ADR-031 authenticated
  transport against existing routes; the milestone added no backup route.
  Their side effects and confirmations are documented in `docs/cli.md`.
- `backups scheduler tick` stays deliberately **unexposed** by the CLI. Its
  `claim_protected` replay policy and reentrancy-guarded compare-and-set cursor
  make it internal, cron-triggered maintenance whose correctness depends on not
  being invoked ad hoc; a contract test asserts no CLI descriptor exists for it.
- A manual run is synchronous and is judged only by the run's own `succeeded`
  status; a retention prune is judged only by its `result`, where `partial` is a
  known partial failure and `busy`/`blocked` are indeterminate outcomes. The
  destructive prune keeps its confirmation with no CLI bypass flag.
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
