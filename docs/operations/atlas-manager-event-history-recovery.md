# Atlas Manager event-history recovery

The maintenance entrypoint supports only `inspect`, `verify`, `migrate-v1`,
and `recover-stale-lock`. A stale writer lock is never removed automatically.
Recovery requires `confirm_administrative_event_history_stale_lock_recovery`,
rechecks owner absence, removes only the exact lock, and writes a private
receipt. It does not delete transactions or alter history. The next safe
startup records a bounded recovery event through the normal audit boundary.

Interrupted rotation or retention remains recovery-required. Operators must
inspect the bounded state and follow the reviewed runbook; there is no force,
repair-chain, truncate, renumber, or event-edit action.
