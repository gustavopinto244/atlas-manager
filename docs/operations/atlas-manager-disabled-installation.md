# Atlas Manager disabled installation

This runbook describes the file-level installation contract delivered by
Issue #270. It is an operator procedure, not an automatic deployment.

The reviewed bundle is for Linux amd64 and contains production JavaScript
dependencies, `/usr/bin/node` as the fixed runtime, a strict manifest, and the
operator installer. Verify its archive hash and run:

```text
atlas-manager-installer inspect-bundle
```

Before mutation, the local administrator must independently verify that the
`atlas-manager` user, its primary `atlas-manager` group, and the
`atlas-manager-power` group already exist with the reviewed home and shell.
The installer never creates or modifies these identities or memberships.

The only mutation actions are:

```text
atlas-manager-installer install-disabled
atlas-manager-installer verify-disabled
atlas-manager-installer rollback-disabled
atlas-manager-installer uninstall-disabled
```

The installer uses only these fixed production locations:

```text
/opt/atlas-manager/releases
/opt/atlas-manager/current
/etc/systemd/system/atlas-manager.service
/etc/atlas-manager/atlas-manager.env.example
/etc/atlas-manager/atlas-manager.env
/var/lib/atlas-manager
/var/lib/atlas-manager-deployment/state.json
/run/atlas-manager-deployment.lock
/run/atlas-manager
/usr/bin/node
```

`install-disabled` installs the unit and safe environment template but does
not create the real `atlas-manager.env`, enable the unit, reload systemd,
start the service, or restart it. The unit uses `Restart=no` and the exact
runtime identity. `/run/atlas-manager` is treated as an active-service
indicator; install, rollback, and uninstall stop rather than signal a process
when it exists.

An upgrade installs a side-by-side release and atomically moves `current`,
retaining one managed previous release. Rollback selects only that recorded
release. Both operations preserve operator configuration and application
state. Uninstall removes only valid managed releases, the managed selector,
unit, template, and deployment state; it preserves the real environment,
runtime state, users, groups, helper, event history, scheduler cursors, and
occurrence claims.

The installer never runs npm, systemctl, loginctl, a shell, the application,
or the Linux power helper. It performs no host qualification, RTC operation,
D-Bus request, wake mutation, reboot, or shutdown. A failed or ambiguous
state is preserved for inspection and must not be repaired or adopted
manually under this contract.

Before and after these actions, use the separate
`atlas-manager-host-qualification` executable for read-only evidence. The
installer does not invoke it, and the qualifier does not invoke the installer.

If the required identities are absent, prepare them first with the separate
`atlas-manager-runtime-identity-installer`. That tool requires the exact
operator confirmation, starts only from a completely absent identity state,
and has no committed identity-removal action. Identity preparation must be
verified before `install-disabled`; it does not enable or start the service.
