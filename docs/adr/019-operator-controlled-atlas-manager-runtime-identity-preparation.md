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
`useradd` capability set and effective `useradd -D` defaults are collected as
one structured, read-only readiness result before the lock or either group is
created. Defaults are bounded UTF-8 stdout with separate bounded stderr, and
accept every canonical uppercase setting while rejecting malformed or
duplicate keys. Exactly one `CREATE_MAIL_SPOOL=no` is required; `GROUPS=`,
`USRSKEL=`, `LOG_INIT=` and future unrelated settings are valid. Required
account options must be available. The installer never changes
`/etc/default/useradd` or `/etc/login.defs`.

Login-log handling selects one explicit strategy. Supported `--no-log-init` is
passed to `useradd`; otherwise effective `LOG_INIT=no` supplies suppression.
When neither suppression mechanism applies, the implementation evaluates the
exact shadow 4.17.4 build and execution contract. The `--no-log-init` help
entry and `lastlog_reset` implementation are compiled under the same
`ENABLE_LASTLOG` guard. Absence of that advertised option therefore proves,
for this exact supported source contract, that the `lastlog` backend was not
built. It does not prove that every login-log backend is disabled:
UID-indexed `faillog` handling remains independent, and an executable fixed
`/sbin/pam_tally2` remains unsupported.

Existing artifacts are accepted only when their type, ownership, permissions
and bounded size are safe and the relevant active backend cannot address
their content. A preexisting `lastlog` is baselined and preserved when its
backend is proven absent, including when the file contains existing records.
Present non-empty `faillog`, executable `pam_tally2`, ambiguous build state,
or unsafe path state blocks before mutation. `btmp` and `wtmp` are not treated
as useradd-owned. This classification relies on the upstream shadow 4.17.4
source contract and must not be generalized from a missing option alone.

The fallback `login_logs_backend_proven_safe` classification is additionally
bound to the proven Ubuntu amd64 package identity: binary package `passwd`,
binary and source version `1:4.17.4-2ubuntu3`, source package `shadow`, and
architecture `amd64`. The fixed `/usr/bin/dpkg-query` probe is shell-free and
read-only and requires the exact five-line result. A different, missing, or
malformed package result fails closed. Explicit suppression through
`--no-log-init` or `LOG_INIT=no` remains portable and does not require this
Debian package probe. No experimental account creation is used for detection,
and readiness never touches real login logs.

The path proof distinguishes a trusted system layout from the external files
being baselined. On the supported Ubuntu merged-usr layout, `/var` and `/usr`
and `/usr/sbin` must be root-owned, non-symlink directories without untrusted
write permission. `/var/log` may be the expected root-owned `syslog` group,
mode `0775` directory (never world-writable); its group write permission is
accepted only for that trusted group. A proven `lastlog` may be a root-owned
`utmp` group, mode `0664` regular file (never world-writable and never a
symlink). `faillog`, `tallylog`, and `pam_tally2` may be absent when the
selected backend proof permits absence. Existing present artifacts retain
their strict type, owner, group, permission, size, and baseline requirements.

For merged-usr, `/sbin` may be a root-owned symlink whose target is exactly
`usr/sbin` or `/usr/sbin`, with safe resolved `/usr` and `/usr/sbin`
directories. Symlink mode bits are not treated as directory permissions, but
arbitrary targets, traversal, extra hops, writable resolved components, and
unexpected replacements remain unsafe. Operators must not change login-log
permissions or merged-usr links to work around validation; an unexpected or
ambiguous layout remains fail-closed as `login_log_path_unsafe`.

Every preexisting login-log artifact and relevant tally executable receives a
bounded immutable baseline containing identity, metadata and a SHA-256 digest.
The baseline must match after creation and during rollback. Preexisting logs
are never deleted, truncated, restored or otherwise treated as transaction
resources.

A private,
synchronized transaction journal is written before the first command and
updated after each verified transition. A successfully failed transaction may
remove only resources created by that invocation, in reverse order. A changed
or ambiguous resource stops rollback and preserves the journal for manual
review. The report retains the original failing stage and never treats the
operation's own held lock as a conflict. Complete rollback is reported only
after all account, shadow, home, mail-spool, managed-state, candidate, journal,
lock, and external login-log baseline postconditions are verified; otherwise
recovery is required.
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
