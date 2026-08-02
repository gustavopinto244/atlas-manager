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

The installer writes private managed state and a transaction journal. If a
command fails, same-process rollback removes only resources created by that
attempt. If rollback cannot safely finish, the journal remains and the next
invocation reports `interrupted`; do not retry or delete identities manually
under this procedure. There is no public removal action.

This tool does not install Atlas Manager or the power helper, create the real
environment file, enroll the account textually in `atlas-manager-power`, call
systemd, start the service, access RTC or D-Bus, or perform a power operation.
No physical Atlas host or VM is part of development validation.

After identity preparation, the separate mock-only runtime configuration and
service lifecycle tools may be used. They preserve these committed identities
through service deactivation and configuration removal; neither tool enrolls
the account textually in the helper group or enables Linux power effects.
