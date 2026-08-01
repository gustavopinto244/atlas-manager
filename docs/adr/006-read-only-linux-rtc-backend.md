# ADR-006 — Read the fixed Linux RTC sysfs interface through the power helper

## Status

Accepted

## Date

2026-08-01

## Context

Issue #246 introduced a standalone, setuid-sensitive Go helper with a strict
version-one protocol, but its production backend rejected every operation.
The first operating-system capability must be read-only and must not make the
helper a general filesystem or command executor. Linux exposes RTC state
through sysfs, but its values use the RTC-configured timezone; a value must
therefore be checked against the system clock before being represented as UTC.

## Considered options

### Execute `hwclock`, `rtcwake`, `date`, `cat`, or another command

Rejected. The helper must not create child processes or invoke a shell,
systemd, D-Bus, or an external utility.

### Read `/dev/rtc0` through ioctl

Deferred. Low-level ioctl structures and device validation add a separate
platform-specific risk surface and are not needed for this read-only slice.

### Automatically discover an RTC

Rejected. Enumerating `/sys/class/rtc` or selecting the first device could
silently select different hardware on different hosts.

### Configurable RTC paths

Rejected. Request fields, environment variables, command-line arguments, and
configuration must not choose a privileged resource.

### Fixed `rtc0` sysfs observation

Accepted. The helper reads only `/sys/class/rtc/rtc0/since_epoch` and
`/sys/class/rtc/rtc0/wakealarm`, after verifying that `/sys` is sysfs.

## Decision

`read_rtc_information` and `read_wake_alarm` use a fixed, read-only Linux
filesystem port. Attribute reads are bounded to 128 bytes and accept only
canonical unsigned epoch seconds. RTC time is captured between one system
clock reading before and one after the `since_epoch` read, and is accepted
only within a fixed 300-second skew window. Missing RTC support is reported as
`operation_unsupported`; malformed, unreadable, or misaligned state is
reported as `state_unavailable`. A missing `wakealarm` attribute is a
successful `unsupported` observation when RTC time is valid; an empty value is
`not_scheduled`.

The three mutation operations remain deny-all. Production composition always
constructs this fixed backend; no runtime backend selection is available.
Deterministic compatibility fixtures inject a narrow reader only in a
separately named test executable and never depend on host RTC hardware.

## Consequences

The helper can safely observe a reviewed Linux RTC resource without writing
under sysfs, using a command, or exposing arbitrary paths. The implementation
is intentionally conservative: local-time RTC configuration, missing support,
and uncertain state fail closed rather than being normalized or guessed.

The fixed `rtc0` choice and sysfs interface are Linux-specific. The fixture
executable is a testing ABI, not a production backend. The helper remains
uninstalled and unwired into Atlas Manager, and no wake or shutdown effect is
available.

## Review conditions

Before implementing writes, wake scheduling, cancellation, or shutdown, review
fixed resource semantics, read-before-write state capture, race handling,
partial effects, supported distributions, and hardware fixtures separately.
No production wiring or installation may be added without a later deployment
and helper security review.
