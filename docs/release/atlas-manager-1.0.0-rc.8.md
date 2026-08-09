# Atlas Manager 1.0.0-rc.8

`1.0.0-rc.8` supersedes the uninstalled Advanced Manager readiness candidate
that was initially built as `1.0.0-rc.7`. The Atlas host already has a distinct
qualified `1.0.0-rc.7` generation installed at the immutable managed release
path. Reusing that version for different bytes would make the installer reject
the candidate with `release_exists`; deleting or overwriting the installed
directory would violate source binding and rollback safety.

The rc.8 change is intentionally limited to release identity and its
authoritative runtime, CI, test, contract, evidence, and documentation
references. Functional behavior remains the behavior reviewed in the Advanced
Manager readiness milestone.

Qualification must start again from the rc.8 source commit and produce two
independent, byte-identical deployment bundles and operator packages. The Atlas
host may be changed only after read-only qualification proves that the current
rc.7 lifecycle is healthy and the rc.8 installer plans an explicit
deactivation boundary.

The supported upgrade sequence is:

1. deactivate and verify the current mock lifecycle;
2. install and verify rc.8 as a side-by-side disabled release;
3. replace and verify the managed administrative configuration;
4. activate and verify the rc.8 mock lifecycle;
5. validate Cloudflare Access, dashboard, services, scheduling, backups,
   events, infrastructure, listeners, logs, and rollback state.

Throughout qualification and deployment, power remains constrained to:

```text
POWER_MANAGEMENT_BACKEND=mock
MACHINE_POWER_EFFECTS_ACTIVATION=disabled
MACHINE_POWER_SCHEDULER_ENABLED=false
ADMINISTRATIVE_WAKE_ALARM_HTTP_ENABLED=false
ADMINISTRATIVE_SHUTDOWN_HTTP_ENABLED=false
```

No real shutdown, reboot, poweroff, RTC write, or wake operation is part of
this release procedure.
