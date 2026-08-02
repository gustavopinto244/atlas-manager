# ADR-013 — Confirm scheduler shutdown occurrences only when derived from the immutable machine policy

Status: Accepted

Date: 2026-08-01

## Context

The configured machine operating policy is immutable and already drives power
planning and scheduler occurrence generation. The scheduler still used the
same confirmation boundary as direct execution, whose safe default is
`not_confirmed`. This prevented an explicitly invoked scheduler tick from
authorizing an occurrence even when the occurrence came from the configured
policy.

The authoritative merged PR #261 baseline for this delivery is
`8f521432b38483ee7f09048f4cf1bf3a1ea8df28`.

## Decision

Add one `ScheduledPolicyMachineShutdownConfirmationReader` during power
composition. It receives the same frozen canonical policy used by planning
and scheduler ticks. It confirms only scheduled-policy occurrences that are
exactly reproduced by `createMachineShutdownOccurrencesForInterval` over the
one-minute interval ending at `scheduledFor`.

`always_on` and `manual` never confirm scheduler shutdowns. Timestamp or wake
timestamp differences return `not_confirmed`; policy-evaluation failures
raise a bounded project-owned error that the readiness boundary maps to
`confirmation_unavailable`.

The scheduler passes this reader explicitly to `executeAt`, together with
`SCHEDULER_POWER_AUDIT_SOURCE` and `automaticallyPrepare: true`. A scheduler
executor without `executeAt` is invalid; there is no fallback to `execute`.

## Gate separation

This delivery completes only:

```text
scheduler confirmation authority
```

It remains separate from configured policy, occurrence generation, shutdown
readiness, shutdown preparation, explicit tick execution, automatic scheduler
lifecycle, power backend selection, helper installation, enrollment, and
real-effect certification.

Policy confirmation does not replace due, stale, service, task, backup,
filesystem, event-recording, or preparation checks. Direct and administrative
execution continue using their own explicit confirmation contracts.

## Rejected alternatives

The scheduler does not use the default direct confirmation reader, trust an
occurrence because it is near a transition, implement a second transition
algorithm, accept HTTP-selected scheduler authority, read environment or
files, add tolerances, retry rejected occurrences, or start an automatic
scheduler loop.

No helper, RTC, D-Bus, wake-alarm, reboot, shutdown, host, or VM effect is
introduced by this decision.
