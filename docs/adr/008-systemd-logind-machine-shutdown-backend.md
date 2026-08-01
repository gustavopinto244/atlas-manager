# ADR-008 — Request orderly Linux power-off through the fixed systemd-logind D-Bus interface

## Status

Accepted

## Date

2026-08-01

## Context

The standalone helper already performs fixed RTC observation and wake-alarm
mutation without a shell or child process. The remaining version-one operation
is machine shutdown. A shutdown backend must preserve the helper's fixed
resource model, fail closed, avoid bypassing systemd inhibitors, and distinguish
an accepted D-Bus request from completed machine power-off.

Atlas Manager remains unprivileged, the helper remains uninstalled, and the
application remains mock-first. This ADR selects only the helper-side source
implementation; it does not authorize installation or production activation.

## Considered options

### Execute system commands

Reject `systemctl`, `loginctl`, `poweroff`, `shutdown`, `halt`, `reboot`, shell
commands, and `sudo`. They introduce child processes, shell or command
selection risk, and a broader privileged boundary.

### Start systemd's final power-off service

Reject. `systemd-poweroff.service` is an internal final-shutdown component and
is not the orderly application boundary.

### Call the systemd PID 1 manager directly

Reject. The low-level manager operation bypasses logind's session, policy, and
inhibitor boundary.

### Use the Linux reboot syscall or SysRq

Reject. These are forced or emergency paths and do not provide the reviewed
logind authorization and inhibitor lifecycle.

### Call systemd-logind `PowerOff(false)`

Accept. logind is the fixed orderly boundary and participates in authorization,
sessions, and inhibitors. The helper sends exactly one noninteractive call and
does not bypass inhibitors.

## Decision

Use one private D-Bus connection to the fixed system bus socket:

```text
unix:path=/run/dbus/system_bus_socket
org.freedesktop.login1
/org/freedesktop/login1
org.freedesktop.login1.Manager.PowerOff
false
```

The socket and its parent are inspected before connection. The connection uses
EXTERNAL authentication as effective UID zero, performs D-Bus `Hello`, calls
`PowerOff(false)` exactly once, and closes after the result. A fixed three-second
context covers connection, authentication, `Hello`, call, and reply receipt.

The helper acquires the existing exclusive operation lock before socket
inspection and holds it through response construction. Socket absence and
definite unsupported D-Bus errors map to `operation_unsupported`; controlled
authorization or inhibitor rejection maps to `operation_rejected`; other
failures, including uncertain acceptance after transmission, map to
`operation_failed`. No retry, reconnect, fallback, signal subscription,
introspection, or RTC access is allowed.

The only new Go dependency is `github.com/godbus/dbus/v5` at `v5.2.2`,
BSD-2-Clause licensed. It is wrapped by project-owned narrow interfaces so the
application and backend do not depend on concrete D-Bus objects. Its transitive
module `golang.org/x/sys v0.27.0` is recorded by the module graph.

Implementing the D-Bus wire protocol locally is rejected because it would
duplicate authentication, message framing, signatures, context cancellation,
and Unix transport behavior. Environment-selected system-bus helpers are not
used because `DBUS_SYSTEM_BUS_ADDRESS` and session-bus defaults must not alter
the fixed security boundary.

## Consequences

Successful helper execution means only that logind returned a successful reply;
it does not prove that the machine has already powered off. A connection loss or
deadline after the method may have been transmitted is treated as uncertain
internally, exposed only as the existing `operation_failed` protocol result,
and never retried.

The helper source now contains a real shutdown effect, but it is not installed,
setuid-enabled, production-wired, or reachable through Atlas Manager HTTP.
CI uses injected deterministic connections and never contacts the host system
bus or requests shutdown.

## Review conditions

Before activation, review the supported distribution, package ownership,
`04750` installation and group membership, PolicyKit/logind deployment policy,
recovery after uncertain acceptance, operator diagnostics, and the application
production wiring. Any change to the bus address, destination, method,
interactive argument, inhibitor behavior, retry policy, or shutdown mechanism
requires an ADR amendment.
