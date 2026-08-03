# Atlas Manager 1.0.0-rc.4

`1.0.0-rc.4` resets the software release candidate after the runtime-identity
fixes committed after the historically blocked `rc.2` and `rc.3` candidates.

It includes correct handling of a completely absent runtime identity,
read-only account-tool capability probing, strict validation of required
`useradd` options, optional use of `--no-log-init` only when supported,
fail-closed handling when login-log suppression is unavailable, and strict
read-only validation of effective `CREATE_MAIL_SPOOL=no`. The invalid
`--key CREATE_MAIL_SPOOL=no` argument is removed. Rollback now verifies
account, shadow, group, home, mail-spool, managed-state, candidate, journal,
and lock residue, while preserving the original failing stage in bounded
report codes and avoiding self-lock conflict reporting.

The source-controlled release evidence remains `not_qualified`; no `rc.4`
commit-bound bundle exists yet and no physical `rc.4` qualification has
occurred. Qualification requires a clean commit, a reproducible bundle bound
to that commit, transfer verification, read-only host qualification, identity
inspection, and a separately authorized physical preparation attempt. Earlier
physical evidence is historical and is not relabeled as `rc.4` evidence.

The candidate remains software-only. It does not claim installation, identity
preparation, service activation, helper installation, RTC or D-Bus access, or
any power effect.
