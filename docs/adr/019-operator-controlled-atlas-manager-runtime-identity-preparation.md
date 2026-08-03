# ADR-019 — Prepare the Atlas Manager runtime identity through a guarded operator-controlled transaction

Status: Accepted

## Context

The deployment qualifier can identify a safe host whose Atlas Manager account
and groups are completely absent. The application installer intentionally does
not create them. A separate, explicit mutation boundary is therefore needed
before disabled application installation.

## Decision

Add `atlas-manager-runtime-identity-installer` to the deployment bundle. It
accepts only `inspect`, `prepare-disabled`, and `verify-managed`. Preparation
requires effective root, Linux amd64, the exact confirmation
`confirm_atlas_manager_runtime_identity_preparation`, a valid bundle, and the
qualification-equivalent `preparation_required` state.

The installer creates only the fixed identities:

```text
atlas-manager user, primary group atlas-manager,
helper group atlas-manager-power
home /var/lib/atlas-manager, shell /usr/sbin/nologin
```

Numeric IDs are allocated by the host. The helper group remains textually
empty; later systemd configuration supplies supplementary membership. No home
directory, mail spool, service unit, configuration, helper, or power state is
created.

Runtime-password inspection is conditioned on the classified identity state.
Zero `atlas-manager` shadow entries is valid only while the complete
passwd/group identity is absent and is reported as `not_applicable` with code
`runtime_password_absent`. A shadow entry without the corresponding identity
is residual state and blocks preparation with `runtime_password_residual`.
After account creation, exactly one shadow entry beginning with `!` or `*` is
mandatory. Missing, duplicate, unlocked, unreadable, or unsafe shadow state
remains blocked. The installer does not repair or remove unexpected account
database entries.

Before mutation, fixed account-management binaries, account files, deployment
absence, and the nonblocking preparation lock are validated. The fixed
`useradd` capability set is probed without mutation and the effective
`useradd -D` defaults are strictly parsed; exactly one
`CREATE_MAIL_SPOOL=no` is required. Required account options must be
available. `--no-log-init` is optional and is passed only when supported; when
it is unavailable, fixed legacy login-log paths must be absent. The installer
never changes `/etc/default/useradd` or `/etc/login.defs`.

A private,
synchronized transaction journal is written before the first command and
updated after each verified transition. A successfully failed transaction may
remove only resources created by that invocation, in reverse order. A changed
or ambiguous resource stops rollback and preserves the journal for manual
review. The report retains the original failing stage and never treats the
operation's own held lock as a conflict. Complete rollback is reported only
after all account, shadow, home, mail-spool, managed-state, candidate, journal,
and lock postconditions are verified; otherwise recovery is required.
Restart recovery and public identity deletion are deliberately not provided.

Managed preparation state records only the fixed names, private numeric IDs,
source commit, and bundle version. Reports and logs never expose IDs, account
data, command output, confirmation values, or password data.

## Boundaries

Host qualification remains read-only and does not invoke preparation.
Preparation does not install the application or helper, enroll a user,
configure systemd, enable or start the service, create production
configuration, activate Linux effects, or certify real hardware. The
deployment installer remains a separate disabled file-installation gate.

## Consequences

Identity creation is explicit, reviewable, and limited to an absent state.
Partial or exact unmanaged identities are never adopted or repaired. An
interrupted journal requires operator inspection. The physical host, helper,
service activation, and real-effect certification remain deferred.
