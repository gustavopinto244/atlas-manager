# Atlas Manager 1.0.0-rc.6

`1.0.0-rc.6` is the software release candidate for the complete runtime
identity safety chain. It carries the corrections for clean-absent password
state, real account-tool compatibility, login-log backend safety, and trusted
login-log path layouts.

The preparation flow now treats a completely absent runtime identity as a
valid starting state while retaining fail-closed rejection of residual or
unsafe password state. It probes the fixed `useradd` executable with bounded,
shell-free, controlled-environment readiness checks before the preparation
lock or either group is created. Its defaults parser accepts canonical fields
such as `GROUPS=`, `USRSKEL`, `LOG_INIT`, and future unrelated canonical keys,
while requiring exactly one `CREATE_MAIL_SPOOL=no`.

Login-log suppression is selected explicitly as one of:

- `login_logs_suppressed_by_no_log_init`;
- `login_logs_suppressed_by_log_init_no`;
- `login_logs_backend_proven_safe`.

Preexisting external artifacts and their trusted path layout receive bounded
immutable baselines containing type, device/inode, mode, owner, group, link
count, size, timestamps, and content digest where applicable. A changed,
replaced, or unsuitable artifact after mutation begins produces
`preparation_failed_recovery_required` and preserves the recovery journal.
Rollback removes only resources positively created by the current transaction;
it never deletes, truncates, restores, chmods, chowns, or normalizes a
preexisting login-log artifact.

The proven Ubuntu 26.04 layout is accepted when all trust conditions hold:

```text
/var/log
  directory
  root:syslog
  mode 0775
  not world writable
  not a symlink

/var/log/lastlog
  regular file
  root:utmp
  mode 0664
  not world writable
  not a symlink

/var/log/faillog
  absent

/var/log/tallylog
  absent

/sbin
  root-owned canonical symlink to /usr/sbin

/sbin/pam_tally2
  absent
```

This is not blanket permission for arbitrary group-writable paths. The
`syslog` group is accepted for `/var/log` only with root ownership, directory
type, no world write, and no symlink; the `utmp` group is accepted for the
proven `lastlog` regular file only with root ownership, no world write, and no
symlink. Unexpected owners, groups, ACLs where applicable, permissions, file
types, oversized content, changed metadata, and symlink replacement remain
unsafe. Merged-usr `/sbin` accepts only the exact canonical `usr/sbin` or
`/usr/sbin` target with safe resolved `/usr` and `/usr/sbin` directories; it
does not accept traversal, arbitrary targets, chained links, or writable
resolved components. Operators must not change login-log ownership,
permissions, ACLs, merged-usr links, or global `useradd` defaults to work
around validation.

The deterministic source tests cover the Ubuntu 26.04 fixture, absent optional
`faillog`, `tallylog`, and `pam_tally2`, canonical merged-usr targets, unsafe
path layouts, immutable baseline changes, rollback boundaries, defaults
compatibility, and the complete readiness strategy matrix. Preparation creates
no runtime home or mail spool, keeps the password locked, does not add the
runtime user to the helper group, does not install the application, does not
enable or start a service, does not modify global useradd defaults, and has no
committed identity-removal operation.

The rc.5 history remains unchanged: its reproducible commit-bound bundle,
archive A/B equality, Vega and Atlas bundle inspection, physical read-only
qualification, physical read-only identity inspection, account-tool readiness,
and `login_logs_backend_proven_safe` classification passed. One explicitly
authorized physical `prepare-disabled` attempt then blocked before creating
the user, groups, state, transaction, lock, home, or mail spool with
`login_log_path_unsafe`. Protected databases, logs, defaults, and systemd
state remained unchanged; no rollback or manual cleanup was required. Forensic
analysis identified false-positive rejection of the trusted `/var/log`,
`lastlog`, and merged-usr layouts. Rc.5 must never be retried physically; the
correction is in commit `1aaf0893d0f6ece4f90293f5ba10d311135993e9`.

The required rc.6 requalification sequence is:

1. inspect the commit-bound bundle;
2. run read-only host qualification;
3. run read-only runtime identity inspection;
4. review account-tool and trusted-layout readiness;
5. perform explicitly authorized `prepare-disabled`;
6. run `inspect`, `verify-managed`, and host `verify-prepared`;
7. perform separately authorized `install-disabled`;
8. run `verify-disabled-installation`;
9. run the remaining mock-only and physical qualification gates.

`1.0.0-rc.6` is not physically qualified yet. This candidate does not claim
physical account creation, disabled installation, service lifecycle, RTC,
D-Bus, helper execution, or power behavior.
