# Atlas Manager mock activation rehearsal

The activation rehearsal is test infrastructure, not a production command. It
uses one synthetic Linux amd64 host, fake account and systemd executors, an
injected loopback health verifier, and sandbox-only filesystem paths.

The sequence is:

```text
disabled deployment
→ install-mock
→ verify-mock
→ activate-mock
→ verify-active-mock
→ deactivate
→ verify-inactive
→ remove-mock
→ verify disabled deployment
```

The rehearsal checks exact command construction, atomic state transitions,
independent locks, bounded reports, route absence, rollback, interrupted state,
metadata attacks, and mutation allowlists. It never invokes real `systemctl`,
account tools, Atlas Manager, npm, the power helper, RTC, or D-Bus.

The packaged application smoke test remains separate: it proves mock-only
application startup and graceful shutdown, while this rehearsal proves
cross-boundary deployment and lifecycle composition.
