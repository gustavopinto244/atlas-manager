# ADR-002 — Isolate Linux power operations behind a fixed privileged helper

## Status

Accepted

## Date

2026-07-31

## Context

Atlas Manager is an unprivileged Node.js application. Future RTC, wake-alarm,
and machine-shutdown effects may require operating-system privileges, but
granting those privileges to the complete application would also grant them to
HTTP delivery code, unrelated features, and every dependency loaded by the
process.

The application therefore needs a reviewed boundary before any real power
effect is enabled. The boundary must identify one approved helper, support only
fixed operations, validate timestamps and responses, bound process behavior,
and fail safely without exposing paths, commands, output, or operating-system
details to application callers.

This decision defines the application-side protocol, installation inspection,
and no-shell transport. It does not implement or install the privileged helper.

## Considered options

### Run the Node.js application as root

Rejected. This violates `SEC-001`, grants unrelated application code excessive
privilege, increases the impact of HTTP or dependency vulnerabilities, and
makes least-privilege review impractical.

### Invoke unrestricted `sudo` or shell commands

Rejected. This violates the fixed-operation requirement, risks argument and
shell injection, expands the supported command surface, and makes auditing
and validation unclear. The application never accepts an executable, command,
argument list, or shell expression from a caller.

### Use direct privileged operating-system access inside adapters

Rejected for the initial production design. Direct unrestricted access to RTC
device files, kernel wake-alarm files, service managers, or D-Bus would couple
the application to privileged operating-system details. A future direct
adapter requires a separate reviewed design and ADR amendment.

### Use a dedicated fixed power helper

Accepted. The unprivileged Atlas Manager process communicates with one narrowly
scoped helper that is installed at a fixed absolute path, is root-owned, is
not writable by the application user or group, accepts only versioned
project-owned requests, implements only allowlisted power operations, and
returns bounded structured responses. The helper itself exposes no shell and
accepts no arbitrary executable, command, or filesystem target.

## Decision

The accepted production direction is:

```text
unprivileged Atlas Manager process
        ↓
strict project-owned helper request
        ↓
fixed absolute helper executable
        ↓
allowlisted privileged operation
        ↓
strict project-owned helper response
```

The fixed executable path is:

```text
/usr/local/libexec/atlas-manager-power-helper
```

Protocol version `1` supports only `read_rtc_information`, `read_wake_alarm`,
`schedule_wake_alarm`, `cancel_wake_alarm`, and `request_shutdown`. Requests
are canonical newline-terminated JSON objects. Responses are strictly
validated and reconstructed through existing project-owned domain factories.

Before every execution, the application verifies Linux, the fixed helper
installation, root ownership, regular-file and executable status, and safe
file and parent-directory permissions. The process transport uses no shell,
empty arguments, `/` as its working directory, `LANG=C` and `LC_ALL=C` only,
a five-second timeout, and bounded stdout/stderr. Operations on one transport
instance run sequentially.

The path is not configurable through HTTP input, application requests,
generic public environment variables, or command-line arguments. Tests may
replace the low-level launcher through a narrow dependency seam without
changing the production path contract.

The default power-management composition remains mock-first. The helper-backed
adapters are not production-wired by this ADR and no real helper is included.

## Consequences

Positive consequences:

- the Node.js process remains unprivileged;
- supported operations and data shapes are explicit and reviewable;
- process startup, timeout, output, and installation failures become safe
  project-owned errors;
- adapters can be tested with deterministic transports and harmless fixtures;
- existing mock RTC, wake-alarm, shutdown, readiness, preparation, claim, and
  scheduler behavior remains unchanged.

Costs and limits:

- the external helper must be implemented and deployed separately;
- this foundation does not provide real RTC, wake-alarm, or shutdown effects;
- process-local serialization does not coordinate multiple application
  processes;
- bounded transport errors intentionally discard diagnostic process output;
- production activation requires additional identity, authorization, auditing,
  deployment, and recovery work.

## Review conditions

Production power effects remain disabled until all of the following are
implemented and reviewed:

- authenticated administrative access;
- authorization for power operations;
- explicit destructive-operation confirmation;
- persistent administrative audit events;
- deployment ownership and permission verification;
- documented helper installation;
- documented rollback and recovery procedures;
- supported Linux distribution verification;
- operator-visible failure reporting;
- security review of the helper implementation.

The next privileged-power Issue must keep the helper outside the Node.js
process and must define its executable ownership, fixed arguments, timeout,
bounded output, platform support, privilege separation, deployment
configuration, confirmation and authorization prerequisites, audit needs, and
recovery limitations before enabling any real effect.
