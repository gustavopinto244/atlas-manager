# Atlas Manager 1.0.0-rc.5

`1.0.0-rc.5` is the active software-only release candidate after the runtime
identity corrections from commits `555cecf`, `c593d80`, and `939ba56`:

- cleanly absent runtime identities no longer fail the password-state
  precondition, while residual shadow state remains blocked;
- the fixed account tool is probed read-only with bounded, shell-free,
  controlled-environment commands before the preparation lock or either group
  is created;
- `useradd` capabilities are adapted to the actual host, and unsupported
  hardcoded `--no-log-init` usage is removed;
- `useradd -D` accepts canonical unrelated settings such as `GROUPS=`,
  `USRSKEL`, `LOG_INIT`, and future unknown canonical keys while requiring
  exactly one `CREATE_MAIL_SPOOL=no`;
- login-log behavior is classified as one of:
  `login_logs_suppressed_by_no_log_init`,
  `login_logs_suppressed_by_log_init_no`, or
  `login_logs_backend_proven_safe`;
- preexisting login-log artifacts receive bounded immutable baselines, and any
  external change produces recovery-required reporting;
- rollback removes only resources positively created by the current
  transaction. Preexisting login logs are never deleted, truncated, restored,
  or treated as installer-owned artifacts.

The deterministic tests include the Ubuntu 26.04 source-level fixture with no
`--no-log-init`, `GROUPS=`, `CREATE_MAIL_SPOOL=no`, an existing `lastlog`, and
no `faillog`. They also cover defaults compatibility, backend classification,
baseline preservation, changed-artifact recovery, and rollback ownership.

The required physical requalification sequence is:

1. inspect the commit-bound rc.5 bundle;
2. run read-only host qualification;
3. run read-only identity inspection;
4. review account-tool readiness;
5. perform the explicitly authorized `prepare-disabled` operation;
6. run `inspect` and `verify-managed`;
7. run host `verify-prepared`;
8. perform separately authorized `install-disabled` and
   `verify-disabled-installation`;
9. run the remaining mock-only and physical qualification gates.

The prequalification snapshot remains unbound: source commit and bundle
digests are null, and configuration, dashboard, and administrative rehearsal
gates are not executed. `1.0.0-rc.5` is not physically qualified yet.

This candidate does not claim physical identity preparation, disabled
installation, configuration or service lifecycle validation, RTC or D-Bus
validation, helper execution, or any power behavior. Identity preparation
still requires a completely absent identity, root on Linux amd64, exact
operator confirmation, and fail-closed checks. It does not start or enable a
service, install the application, modify global useradd defaults, or provide a
committed identity-removal operation.
