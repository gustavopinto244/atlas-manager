# ADR-011 — Select the Linux power helper only through explicit fail-closed application composition

Status: Accepted

Date: 2026-08-01

## Context

The repository now contains reviewed Linux helper adapters, a fixed transport,
installation inspection, host qualification, and a controlled installation
bundle. Those capabilities are separate from selecting infrastructure inside
the Node.js application. The application must remain safe when the helper is
absent, uninstalled, inaccessible, malformed, or not intended for this host.

The authoritative merged PR #257 baseline for this delivery is
`eb6440c98314ed52ba6ff0b53061c39b291fd7cd`.

## Decision

Add one immutable, explicit composition boundary controlled by:

```text
POWER_MANAGEMENT_BACKEND=mock
POWER_MANAGEMENT_BACKEND=linux_helper
```

The default is exactly `mock`. The only alternate value is exactly
`linux_helper`; aliases, case variants, whitespace, empty values, and unknown
values reject startup configuration. The parsed value is stored in the
immutable `EnvironmentConfig`.

`mock` preserves the existing mock readers and controllers. `linux_helper`
creates exactly one frozen bundle through `createLinuxPowerHelperAdapters`.
That bundle includes the fixed transport, the existing installation
inspector, and all four Linux adapters. The same transport is shared by RTC
information, wake-alarm read, wake-alarm mutation, and machine-shutdown
operations. The selection is atomic: partial real/mock combinations are not
possible.

Composition never executes the helper, probes RTC state, inspects an
installation through an operation request, or performs a power effect. If the
selected Linux adapter factory fails or returns an invalid bundle, startup
fails closed and does not fall back to mock. After composition there is no
runtime backend setter, HTTP override, or environment reload.

Administrative HTTP flags remain independent from backend selection. Selecting
`linux_helper` does not enable routes, and enabling a route does not select
the helper. The machine-power scheduler is also independent and receives no
new timer, loop, or startup activation.

## Gate separation

This delivery completes only:

```text
composition selection
```

The following remain independent gates:

```text
helper source availability
bundle availability
host qualification
disabled installation
application-user enrollment
composition selection
administrative HTTP activation
automatic scheduler activation
real-effect certification
```

This ADR does not install the helper, create a group, enroll a user, repair
permissions, download a bundle, execute a shell, activate HTTP effects, or
certify a host. No Atlas host or VM drill is part of this delivery.

## Shutdown semantics

The mock controller returns `simulated`. The Linux adapter maps the helper's
typed `{ accepted: true }` response to `accepted`. `accepted` means only that
systemd-logind returned a successful noninteractive `PowerOff(false)` reply;
it does not mean that the machine has powered off or that shutdown completed.
The application and HTTP response preserve this distinction. No `completed`
claim is introduced.

## Rejected alternatives

The composition must not automatically switch when a helper file exists,
select environment-controlled paths or arguments, combine real and mock
adapters, fall back from helper failure to simulated success, install or
repair the helper at startup, create or enroll groups, download artifacts,
invoke npm lifecycle installation, execute a shell or `sudo`, switch backends
at runtime, enable administrative routes, or start the power scheduler.

## Consequences

Tests inject a narrow adapter-factory dependency at the composition boundary,
so deterministic tests do not touch `/usr/local/libexec`, `/sys`, `/run/dbus`,
`/etc/group`, or `/var/lib`. Production defaults still construct the reviewed
fixed implementations. The application remains mock-first until separate
deployment, enrollment, activation, recovery, and real-effect reviews are
complete.
