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
probes the fixed `/usr/sbin/useradd` with `--help` and `-D`. The readiness
probe is shell-free, bounded, timed, UTF-8 checked, and uses the fixed
`LANG=C`, `LC_ALL=C`, `TZ=UTC` environment. Required account options must be
present. Defaults are parsed from stdout only: each nonempty line has one
canonical uppercase key, duplicate keys and surrounding whitespace are
rejected, and unrelated keys (including `GROUPS=` and `USRSKEL=`) are
accepted. Exactly one `CREATE_MAIL_SPOOL=no` is required. `LOG_INIT`, when
reported, must be exactly `yes` or `no`. The installer never edits
`/etc/default/useradd` or `/etc/login.defs`.

The selected suppression strategy is reported without exposing command output:
supported `--no-log-init` is included in account creation; when that option is
unavailable, effective `LOG_INIT=no` is used. When neither suppression
mechanism applies, the installer uses the supported shadow 4.17.4 source
contract to classify the remaining backends. The `--no-log-init` help entry
and `lastlog_reset` are controlled by the same `ENABLE_LASTLOG` build guard,
so absence of the advertised option proves that this version cannot reset
`lastlog`.

That proof applies only to `lastlog`. UID-indexed `faillog` handling remains
active independently, and an executable fixed `/sbin/pam_tally2` remains
unsupported. A trusted preexisting `lastlog`, including one containing
records, is baselined and must remain unchanged. Present non-empty `faillog`,
executable `pam_tally2`, ambiguous classification, or unsafe path state blocks
before group creation. `btmp` and `wtmp` are not part of this useradd-owned
set.

The `login_logs_backend_proven_safe` fallback is fail-closed to the proven
Ubuntu amd64 package only: binary `passwd`, source `shadow`, binary and source
version `1:4.17.4-2ubuntu3`, architecture `amd64`. Readiness obtains these
five exact fields through fixed `/usr/bin/dpkg-query` arguments without a
shell. Other builds, missing metadata, non-empty stderr, invalid UTF-8, or
unexpected output block the fallback. Hosts with explicit `--no-log-init` or
`LOG_INIT=no` remain portable and skip the package probe. The probe is read-only
and does not create an account or touch real logs.

The trusted Ubuntu path layout is checked separately from the immutable log
baseline. `/var` must be a safe root-owned directory. `/var/log` may be the
normal root-owned `syslog` group directory with mode `0775`, provided it is not
world-writable, a symlink, or controlled by an unexpected group. A proven
`/var/log/lastlog` may be a root-owned `utmp` group regular file with mode
`0664`; it must not be world-writable or a symlink. Absent `faillog`,
`tallylog`, and `pam_tally2` remain valid when the selected backend proof
permits absence.

On merged-usr systems `/sbin` is accepted only as a root-owned symlink to
exactly `usr/sbin` or `/usr/sbin`, with root-owned, non-writable `/usr` and
`/usr/sbin` directories. Arbitrary targets, traversal, chained links, writable
resolved components, changed metadata, and unexpected file types still block
with `login_log_path_unsafe`. Do not modify system login-log permissions or
merged-usr links to work around this check.

The runtime-password check is state-aware. While the complete passwd/group
identity is absent, zero `atlas-manager` entries in the shadow database is the
valid pre-preparation state and is reported as `runtime_password_absent` with
status `not_applicable`. Any shadow entry in that state is residual account
data and blocks preparation with `runtime_password_residual`. Once the runtime
identity exists, exactly one shadow entry is required and its password field
must begin with `!` or `*`; missing, duplicate, or unlocked entries block.
The installer never repairs or removes unexpected passwd, group, shadow, or
gshadow entries.

Before the first account mutation, each relevant preexisting login-log file
and tally executable is captured as an immutable baseline of absence/presence,
type, device/inode, mode, owner, group, link count, size, timestamps and a
bounded SHA-256 digest. The baseline must match after user creation and during
rollback. Preexisting logs are never removed, truncated or rewritten.

The installer writes private managed state and a transaction journal. If a
command fails, same-process rollback removes only resources created by that
attempt and reports the original bounded failing stage together with the
rollback outcome. A complete `preparation_failed_rolled_back` result is
emitted only after the user, groups, shadow entry, home, mail spool, managed
state, candidate files, journal, operation lock and every preexisting login-log
baseline are verified. If any artifact remains or an external log changed, the result is
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

## rc.7 operator sequence

For the active `1.0.0-rc.7` candidate, inspect the commit-bound bundle, run
read-only host qualification, run read-only runtime identity inspection, and
review account-tool and trusted-layout readiness before the explicitly
authorized `prepare-disabled` operation. Then run `inspect`, `verify-managed`,
and host `verify-prepared`. Only after those results are reviewed may the
separately authorized `install-disabled` and `verify-disabled-installation`
steps run. Complete the remaining mock-only and physical qualification gates
afterward. Rc.5 and earlier bundles are historical and must never be used for
physical identity preparation.
