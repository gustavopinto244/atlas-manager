# Atlas Manager deployment host qualification

This runbook describes the read-only deployment qualification boundary from
Issue #272. It is not a host-preparation or installation authorization.

The executable is distributed beside the installer in the reviewed bundle:

```text
atlas-manager-host-qualification
```

Supported actions are exactly:

```text
qualify
verify-prepared
verify-disabled-installation
verify-removed
```

Recommended operator sequence:

```text
inspect deployment bundle
        ↓
run qualify
        ↓
review qualified or preparation_required
        ↓
perform separately approved identity preparation, if required
        ↓
run verify-prepared
        ↓
run atlas-manager-installer install-disabled
        ↓
run verify-disabled-installation
        ↓
retain the bounded report and its SHA-256 outside source control
```

After a separately approved disabled uninstall:

```text
atlas-manager-installer uninstall-disabled
        ↓
atlas-manager-host-qualification verify-removed
```

The qualifier requires effective UID zero in production, but it is strictly
read-only. It does not create accounts or groups, enroll
`atlas-manager-power`, create locks, change permissions, call systemd, start
or stop Atlas Manager, execute the helper, access RTC or D-Bus, or perform a
power operation.

`preparation_required` means only that the fixed identities are completely
absent and the other inspected assumptions are safe. Partial identities,
unsafe account files, unmanaged deployment files, an enabled service, active
runtime state, an existing deployment lock, unsafe configuration metadata, or
insufficient capacity produce `blocked`.

The application qualification tool is independent from
`atlas-manager-power-helper-host-qualification`. The latter remains the
authority for helper installation and power-host checks. No physical Atlas
host or VM drill is part of this runbook.

When `qualify` returns `preparation_required`, use the separate
`atlas-manager-runtime-identity-installer` procedure. The qualifier remains
read-only and never creates the account or groups. A valid managed identity
preparation is reported as `prepared`; an interrupted preparation journal is
blocked and requires operator review.
