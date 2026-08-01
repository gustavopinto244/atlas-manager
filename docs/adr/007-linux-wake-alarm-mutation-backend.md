# ADR-007 — Mutate the fixed Linux RTC wake alarm through bounded sysfs transactions

## Status

Accepted

## Date

2026-08-01

## Context

Issue #248 added fixed, read-only `rtc0` observation to the standalone Go
helper. The next capability is real wake-alarm scheduling and cancellation,
while machine shutdown must remain unsupported. A mutation can race with
another helper process and replacement is not atomic, so the operation needs a
fixed cross-process lock, read-before-write state capture, bounded writes, and
read-after-write verification.

## Considered options

### Execute `rtcwake`, `hwclock`, or another command

Rejected. The helper must not invoke a shell, child process, systemd, D-Bus,
`sudo`, or external utility.

### Caller-provided sysfs paths

Rejected. No request, environment, argument, configuration, or working
directory may select a privileged path.

### Relative wake-alarm writes

Rejected. Relative `+seconds` and `+=seconds` values have time-of-write
semantics that are less explicit and less portable for this protocol.

### `/dev/rtc0` ioctl

Deferred. Ioctl structures, device validation, and architecture-specific
behavior require a separate review.

### Fixed sysfs mutation

Accepted. The helper writes only the fixed `rtc0/wakealarm` attribute. Schedule
writes contain one absolute canonical epoch followed by LF; cancellation writes
exactly `0\n`.

## Decision

Read operations acquire a shared nonblocking advisory lock. Schedule and
cancel acquire an exclusive nonblocking advisory lock at
`/run/atlas-manager-power-helper.lock`. The lock is opened with Linux-safe
`O_NOFOLLOW` and close-on-exec behavior, created only when the helper runs, and
accepted only as a root-owned regular file with one link and exact mode `0600`.
Unsafe or busy locks fail safely without repair or waiting.

Scheduling verifies sysfs and aligned RTC time, confirms the target remains
strictly future relative to the validated RTC, captures the current wake state,
and performs one of the reviewed scheduled, unchanged, or replacement flows.
Replacement writes `0\n`, verifies absence, writes the new absolute epoch, and
verifies the exact target while holding the same exclusive lock. Cancellation
similarly captures state, writes `0\n` only when scheduled, and verifies
absence. Every write is bounded to 32 bytes and must be accepted in full by
one write call.

The operation never retries, restores an old alarm, compensates, or hides an
uncertain result. A partial replacement remains authoritative and returns a
safe operation failure. `request_shutdown` remains deny-all and does not acquire
the lock.

## Consequences

The helper source can perform real wake-alarm mutation against one reviewed
Linux resource with explicit race and partial-effect boundaries. The fixed
lock prevents overlapping helper processes from interleaving replacement
steps, but sysfs replacement is still not atomic and hardware state may need a
later authoritative read after failure.

The helper remains uninstalled and unwired into Atlas Manager. CI injects
deterministic filesystem and lock implementations and never writes host RTC
state. The design remains Linux-specific and does not provide machine
shutdown.

## Review conditions

Before production activation, separately review helper installation, root and
group ownership, supported distributions, RTC hardware behavior, recovery
after uncertain writes, operator diagnostics, and the future shutdown backend.
Any move to ioctl or another wake mechanism requires an ADR amendment.
