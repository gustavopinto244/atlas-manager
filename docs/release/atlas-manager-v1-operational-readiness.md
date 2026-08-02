# v1 operational readiness

The documented lifecycle covers install, verify, mock-administrative
configuration, disabled replacement, disabled rollback, activation, active
verification, deactivation, upgrade, release rollback, backup recovery,
event-history recovery, identity-readiness recovery, and bounded uninstall.

Replacement and rollback never start the service. Broken history, interrupted
transactions, stale locks, invalid identity configuration, and unsafe managed
state fail closed and require operator review.
