# Infrastructure diagnostics plan

## Goal

Replace common read-only shell blocks with typed diagnostics while preserving
partial failures. `status` summarizes; `doctor` explains.

## Proposed feature area

Create an `operator-diagnostics` feature with application checks and ports for:

- systemd unit state;
- HTTP health;
- PM2 process state and configured cwd/environment metadata;
- Nginx active state and configuration test;
- cloudflared active state and ingress validation;
- TCP listeners and loopback/public binding classification;
- deployment/runtime/lifecycle state consistency;
- service, backup and machine scheduler state;
- event-history readiness;
- power backend/effect-gate state.

Adapters may reuse proven parsers from deployment qualification where practical,
but deployment Go packages must not be copied into TypeScript line by line.
Shared JSON contracts or a small diagnostic executable are acceptable after an
explicit boundary decision.

## `atlas status`

Return a compact component list with `ok`, `degraded`, `down`, `disabled` or
`unavailable`. Include expected endpoints and scheduler modes. A failed
component does not suppress healthy components.

## `atlas doctor`

Each check returns:

- stable check ID;
- status;
- observed and expected summary;
- stable error code;
- safe operator hint;
- whether the check requires elevated privileges.

The first milestone is read-only. Do not implement `--fix`.

## CLI/API split

Host-local CLI diagnostics can use read-only host adapters where permissions
allow. Dashboard diagnostics require protected HTTP APIs served by Atlas. Both
consume the same diagnostic DTO; they must not independently redefine expected
ports or component names.

## Tests

- fixture parsers for systemd, PM2, Nginx, cloudflared and listeners;
- partial failure aggregation;
- public binding detection for 3000/3001;
- missing/invalid state files;
- timeout and permission-denied behavior;
- JSON schema and stable check ordering;
- no mutating process invocation.
