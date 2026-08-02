# Atlas Manager disabled deployment rehearsal

The disabled deployment rehearsal is sandbox-only Go test infrastructure. It
is not a production deployment command and must never be pointed at a host
root.

It builds two valid deterministic Linux `amd64` bundles, then reuses the
production packages for this sequence:

```text
qualify
identity inspect and prepare-disabled
verify-managed
verify-prepared
install-disabled release A
verify-disabled
verify-disabled-installation
install-disabled release B
verify-disabled
rollback-disabled
verify-disabled
uninstall-disabled
verify-removed
verify-managed
```

The synthetic host uses one temporary sandbox, a fake account-command
executor, injected Node.js and systemd observations, and deterministic
account IDs. It never reads the real account database, invokes account tools,
calls systemd, starts Atlas Manager, installs or executes the power helper, or
accesses RTC or D-Bus.

The test compares repeated bundle builds, snapshots the sandbox before and
after each step, and checks exact mutation allowlists. Canonical bounded JSON
evidence contains only release metadata, result classifications, report
digests, mutation classifications, and a deterministic hash chain. It contains
no account records, IDs, environment values, temporary paths, or command
output.

The packaged mock-only application smoke test remains separate: this rehearsal
proves deployment lifecycle composition, not application startup,
authentication, helper readiness, hardware wake, or shutdown behavior.

Run from the deployment module with:

```bash
go test ./internal/rehearsal -count=1
```

CI runs the complete deployment test suite and the focused rehearsal test. No
physical Atlas host or VM is used.

Issue #278 extends the sandbox lifecycle after disabled installation with the
canonical mock runtime configuration and reversible service lifecycle. The
service remains loopback-only, mock-first, disabled for power effects and the
machine scheduler, and has no administrative routes. The activation rehearsal
uses a fake systemd executor and injected health checks; it never runs a real
systemd command.
