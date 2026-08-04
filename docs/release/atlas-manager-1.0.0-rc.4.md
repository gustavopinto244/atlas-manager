# Atlas Manager 1.0.0-rc.4

`1.0.0-rc.4` is historical and blocked for physical runtime-identity
preparation. Its login-log policy rejected a normal preexisting `lastlog`, its
strict defaults parser rejected the legitimate `GROUPS=` field, and rollback
incorrectly modeled preexisting login logs as installer-owned absence
requirements. A new release candidate is required.

Bundle construction for rc.4 was reproducible; bundle inspection passed;
physical host qualification passed read-only; and physical identity
inspection passed read-only. No `rc.4 prepare-disabled` mutation was
attempted. Those physical findings remain evidence for rc.4 history and are
not rewritten or deleted.

The later source corrections now provide structured account-tool readiness,
compatible defaults parsing, explicit suppression strategies, immutable
login-log baselines, and rollback verification that preserves preexisting
external logs. Those corrections are not retroactively attributed to rc.4.

The source-controlled release evidence remains `not_qualified`; no new
commit-bound bundle exists from this dirty working tree. Qualification of the
replacement candidate requires a clean commit, a reproducible bundle bound to
that commit, transfer verification, read-only host qualification, identity
inspection, and a separately authorized physical preparation attempt. Earlier
physical evidence is historical and is not relabeled as replacement-candidate
evidence.

The candidate remains software-only. It does not claim installation, identity
preparation, service activation, helper installation, RTC or D-Bus access, or
any power effect.
