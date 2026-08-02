# ADR-015 — Admit Linux power effects only through explicit hash-bound startup activation

Status: Accepted

## Decision

Atlas Manager keeps Linux power effects disabled by default through the exact
`MACHINE_POWER_EFFECTS_ACTIVATION=disabled` value. Real Linux effects require
all of the following independent gates to agree:

```text
POWER_MANAGEMENT_BACKEND=linux_helper
at least one effect-capable surface enabled
MACHINE_POWER_EFFECTS_ACTIVATION=linux_helper
MACHINE_POWER_EFFECTS_CONFIRMATION=confirm_linux_helper_power_effects
LINUX_POWER_HELPER_EXPECTED_SHA256=<64 lowercase hexadecimal characters>
read-only installed-helper preflight passes
```

The activation object is parsed once into immutable `EnvironmentConfig` state.
The confirmation is an anti-accident operator acknowledgment, not a secret or
replacement for authentication, authorization, request confirmation, or
readiness. The installed helper identity is bound to one exact SHA-256 digest;
paths, arguments, alternate digests, and remote checksum sources are not
configurable.

When Linux activation is admitted, startup performs one read-only preflight
through the existing fixed-path installation inspector and a bounded
streaming SHA-256 calculation. It validates the regular root-owned `04750`
helper, its non-root group, single hard link, safe parents, application group
membership, and exact installed-file digest. It does not execute the helper,
repair the installation, modify groups, access RTC state, connect to D-Bus for
a power request, or mutate any power resource.

Preflight completes before HTTP server creation and before scheduler startup.
Failure stops startup fail-closed. There is no fallback to the mock backend,
no retry, and no automatic disabling or repair.

## Independent gates

The following remain separate decisions:

```text
Linux helper backend selection
effect-capable HTTP or scheduler surface activation
startup power-effects admission
helper installation preflight
administrative request confirmation
scheduler policy confirmation
shutdown readiness and preparation
host qualification
application-user enrollment
real-effect certification
```

Backend selection alone is inert when no effect-capable surface is enabled.
Effect-capable surfaces cannot activate Linux effects while admission is
disabled. A scheduled policy, scheduler activation, or administrative route
does not supply the activation confirmation or helper digest. HTTP input cannot
change activation after startup.

The default remains `POWER_MANAGEMENT_BACKEND=mock`,
`MACHINE_POWER_EFFECTS_ACTIVATION=disabled`,
`MACHINE_POWER_SCHEDULER_ENABLED=false`, and an always-on machine policy.
Administrative authentication, authorization, request confirmation, policy
confirmation, readiness, preparation, occurrence claims, and wake-before-
shutdown ordering remain authoritative after admission.

## Alternatives rejected

Automatic activation when the helper exists, helper discovery, environment
selected paths, multiple accepted hashes, bundle-archive hashing, startup
helper probes, installation repair, group enrollment, remote downloads,
fallback to mock, and HTTP activation were rejected. Each would weaken the
operator-controlled boundary or make a deployment state implicit.

## Scope and safety

This ADR completes only startup power-effects admission and hash-bound
installation preflight. It does not install the helper, create its group,
enroll an application user, qualify the physical Atlas host, certify firmware
wake behavior, or certify real shutdown behavior. Development and CI use
deterministic fakes and temporary project-owned resources; no Atlas host or VM
drill, helper execution, RTC access, D-Bus power request, wake mutation,
reboot, or shutdown occurred.
