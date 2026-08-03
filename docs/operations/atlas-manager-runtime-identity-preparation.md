# Atlas Manager runtime identity preparation

This is an operator-run mutation step for the fixed runtime identity. It must
be performed only after the separate read-only host qualification reports
`preparation_required`.

The bundle executable accepts exactly:

```text
atlas-manager-runtime-identity-installer inspect
atlas-manager-runtime-identity-installer prepare-disabled confirm_atlas_manager_runtime_identity_preparation
atlas-manager-runtime-identity-installer verify-managed
```

Preparation requires root on Linux amd64 and creates only:

```text
atlas-manager user
atlas-manager primary group
atlas-manager-power helper group
```

The account uses `/var/lib/atlas-manager` as its home field and
`/usr/sbin/nologin` as its shell. No home directory or mail spool is created.
The helper group remains textually empty; a later reviewed systemd unit may
provide it as a supplementary group.

Before running preparation, inspect the bundle and run the host qualifier.
Preparation is allowed only when all three identities are absent, deployment
and configuration are absent, the helper is absent, the service is absent and
inactive, and no deployment or identity-preparation operation is active.

Before acquiring the preparation lock or creating either group, the installer
probes the fixed `/usr/sbin/useradd` with `--help` and `-D`. The probe is
shell-free, bounded, timed, and uses the fixed `LANG=C`, `LC_ALL=C`, `TZ=UTC`
environment. Required account options must be present. `--no-log-init` is
optional because supported `useradd` versions differ; it is included only
when the probe confirms it. If it is unavailable, fixed legacy login-log
paths must be absent or preparation blocks. The effective defaults must
contain exactly one canonical `CREATE_MAIL_SPOOL=no`; the installer never
edits `/etc/default/useradd` or `/etc/login.defs`.

The runtime-password check is state-aware. While the complete passwd/group
identity is absent, zero `atlas-manager` entries in the shadow database is the
valid pre-preparation state and is reported as `runtime_password_absent` with
status `not_applicable`. Any shadow entry in that state is residual account
data and blocks preparation with `runtime_password_residual`. Once the runtime
identity exists, exactly one shadow entry is required and its password field
must begin with `!` or `*`; missing, duplicate, or unlocked entries block.
The installer never repairs or removes unexpected passwd, group, shadow, or
gshadow entries.

The installer writes private managed state and a transaction journal. If a
command fails, same-process rollback removes only resources created by that
attempt and reports the original bounded failing stage together with the
rollback outcome. A complete `preparation_failed_rolled_back` result is
emitted only after the user, groups, shadow entry, home, mail spool, managed
state, candidate files, journal, and operation lock are verified absent. If
any artifact remains, the result is
`preparation_failed_recovery_required` and the journal remains for analysis.
The operation does not report its own held lock as an external conflict. Do
not retry or delete identities manually under this procedure. There is no
public removal action.

This tool does not install Atlas Manager or the power helper, create the real
environment file, enroll the account textually in `atlas-manager-power`, call
systemd, start the service, access RTC or D-Bus, or perform a power operation.
No physical Atlas host or VM is part of development validation.

After identity preparation, the separate mock-only runtime configuration and
service lifecycle tools may be used. They preserve these committed identities
through service deactivation and configuration removal; neither tool enrolls
the account textually in the helper group or enables Linux power effects.
