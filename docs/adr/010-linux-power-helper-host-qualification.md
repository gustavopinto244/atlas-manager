# ADR-010 — Qualify Linux helper hosts through fixed read-only capability inspection

Status: Accepted

The authoritative merged PR #255 baseline used for this delivery is
`e6d36bf84969d177303c5a64f68ecb544c9dba8b`.

The qualification executable is built for the fixed target
`GOOS=linux`, `GOARCH=amd64`, `GOAMD64=v1`, and `CGO_ENABLED=0`. The CPU model
may be recorded as evidence, but host qualification does not implement a
processor allowlist.

## Decision

Add a separate root-run, read-only `atlas-manager-power-helper-host-qualification`
utility. It supports exactly `qualify`, `verify-disabled-installation`, and
`verify-removed`, uses fixed host resources, and emits one bounded canonical JSON
report. It never installs, repairs, executes, or activates the helper.

Qualification is capability-based: a passing report describes the inspected host
at one point in time and approves only a disabled installation with an empty
`atlas-manager-power` group. It is not a distribution, kernel, firmware, RTC,
systemd, application-enrollment, or production-effect certification.

## Separate gates

The project treats these as separate gates:

1. source-code validation;
2. bundle and checksum validation;
3. host qualification;
4. disabled installation;
5. application-user enrollment;
6. production application wiring;
7. real wake and shutdown certification.

Passing an earlier gate never implies that a later gate is approved.

## Fixed inspection boundary

The utility reads only the reviewed OS-release, local group, boot-id, Linux
kernel, sysfs, fixed `rtc0` attributes, runtime lock metadata, installation
parents/state, and root-owned system-bus socket metadata. It hashes the boot ID
with a project-owned domain separator and never reports the raw value or other
host identifiers. RTC observation reuses the 128-byte parser and 300-second
RTC-to-system-clock alignment rule. Wake support is observed without opening it
for writing.

The system bus is checked at `/run/dbus/system_bus_socket`. A private
EXTERNAL-authenticated connection with a fixed two-second deadline performs only
`NameHasOwner`, `Introspect`, and `CanPowerOff`. `PowerOff` is never called and
the introspection contract is checked for the fixed logind `PowerOff(bool)` and
`CanPowerOff() -> string` methods.

## Safety and limitations

All actions require effective UID zero so the observations use the same identity
that the future helper installation expects, but the process remains read-only.
No group is created, no user is enrolled, no lock is created, no helper is
executed, and no child process is started. Firmware wake behavior and real
shutdown remain explicitly untested. Reports belong in protected operational
records and must not contain live host evidence in source control.
