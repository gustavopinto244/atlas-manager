# ADR-014 — Run the machine-power scheduler only through an explicit fail-closed application lifecycle

Status: Accepted

## Decision

Atlas Manager provides an automatic machine-power scheduler lifecycle only
when `MACHINE_POWER_SCHEDULER_ENABLED=true` is configured exactly. The default
is `false`. The scheduler uses the existing explicit
`runMachinePowerSchedulerTick` capability and does not implement a second
policy, occurrence, readiness, preparation, claim, wake, or shutdown
algorithm.

The lifecycle uses one one-shot Node timer with a fixed 60-second delay after
each completed continuing tick. The first tick runs immediately after the HTTP
server emits `listening`. Ticks never overlap, start and stop are idempotent,
and a pending timer is cancelled during graceful shutdown.

The enabled lifecycle requires persistent cursor, permanent occurrence-claim,
and administrative event-history files. The scheduler shares one production
power capability bundle and one event-history capability bundle with enabled
administrative power surfaces. It remains independent from HTTP route flags,
`POWER_MANAGEMENT_BACKEND`, and the machine operating policy. `always_on` and
`manual` are valid safe policies that produce no automatic shutdown
occurrences.

`initialized`, `idle`, and `advanced` continue the loop. `blocked`,
`incomplete`, `conflict`, tick failures, and timer failures terminate the
application lifecycle fail-closed, set the failure exit code once, and request
coordinated application shutdown once. There is no retry, loop restart,
rollback, or compensation.

## Gates and scope

The following are independent gates:

```text
machine operating policy configuration
policy-bound scheduler confirmation
explicit scheduler tick
automatic scheduler loop and process lifecycle
power backend selection
administrative HTTP activation
helper installation
application-user enrollment
Atlas host qualification
real-effect certification
```

This delivery completes only the automatic scheduler loop and its process
lifecycle. It does not install or execute the helper, enroll a user, qualify
Atlas, certify RTC wake behavior, request a real shutdown, or enable an
unattended production power effect.

## Alternatives rejected

Fixed-rate intervals, `setInterval`, configurable cadence, retry timers,
background workers, child processes, cron, systemd timers, startup ticks, and
HTTP-triggered scheduler control were rejected. They could overlap ticks,
hide persistent cursor conflicts, make failure recovery ambiguous, or create
an activation path outside the reviewed startup configuration boundary.

The scheduler is not started during environment parsing or composition. The
default application remains mock-first, and selecting `linux_helper` does not
enable this lifecycle. A scheduled policy alone is effect-free.

## Safety boundary

The scheduler runtime logs only bounded lifecycle categories and error types.
Abnormal completion uses distinct internal shutdown reasons for blocked,
incomplete, conflict, and failed outcomes. Graceful shutdown attempts to stop
both the service-availability scheduler and the machine-power scheduler even
when one stop fails.

Development and CI for this delivery use deterministic timers, fakes, and
temporary project-owned test resources. No Atlas host or VM drill occurred;
the helper was not installed or executed; no group or user membership or
setuid state changed; no RTC, wake-alarm, D-Bus, reboot, or shutdown effect
occurred.
