# Slice 4: scheduling UX and adapter boundaries

## Objective

Provide a usable weekly schedule editor and timeline for registered PM2,
Docker and Docker Compose services while protecting control-plane dependencies.

## Supported scheduling target

The existing scheduling domain applies to a `registered service`, not directly
to a technology. These adapters can share the same policy:

```text
registered service
  -> availability policy
  -> transition calculation
  -> occurrence/claim/cursor
  -> reconciliation
  -> service controller (PM2 | Docker | Docker Compose)
```

Task Manager is the first acceptance target. A controlled disposable Docker
fixture is the second. The old stopped container currently on Atlas must not be
adopted automatically.

## Weekly editor

- modes: Always, Scheduled, Manual and Disabled;
- IANA timezone selector with `America/Sao_Paulo` as the deployment default;
- seven day rows with explicit enable switch;
- start/end time controls;
- copy one day's window to selected days;
- clear day and clear week;
- support multiple windows per day only if the backend domain supports them;
- inline basic validation plus authoritative backend validation;
- unsaved-change warning;
- Save, Preview and Remove policy actions with distinct semantics.

## Timeline and preview

Render a reusable 24-hour weekly grid showing:

- online and offline windows;
- current local time and timezone;
- current effective state;
- active override and expiry;
- next and following transitions;
- preview source and evaluation timestamp;
- scheduler health/cursor state when exposed by an authoritative API.

The browser sends candidate policy input to the preview use case. It must not
calculate authoritative transitions independently.

## Mutation contract

- update/remove uses the existing protected schedule routes and canonical
  confirmations;
- one backend mutation gate remains authoritative;
- audit records principal, service ID, normalized policy summary and outcome;
- save success requires an authoritative reread;
- conflict/busy/validation errors retain the draft and never appear as saved;
- scheduler claim, cursor, duplicate prevention and recovery invariants remain
  unchanged.

## Nginx boundary

Nginx is infrastructure and part of the only administrative ingress path:

```text
Cloudflare Access -> Tunnel -> Nginx -> Atlas Manager
```

Therefore this slice provides Nginx status, configuration-test state, listener
and upstream diagnostics only. It does **not** expose a weekly stop schedule for
Nginx. The same default prohibition applies to Atlas Manager and cloudflared.

If generic systemd scheduling is later required, first create an ADR covering:

- a dedicated systemd adapter with strict unit allowlist;
- immutable denylist for Atlas, Nginx, cloudflared, SSH/network and power units;
- least-privilege helper or DBus/polkit boundary;
- dependency-aware stop semantics;
- out-of-band recovery and rollback;
- audit and concurrency;
- tests that never stop real host services.

## Tests

- editor modes, weekdays, times, timezone, copying, clearing and dirty state;
- preview loading/success/empty/invalid/conflict;
- timeline current marker and DST transitions;
- PM2 and Docker scheduling through common fake controller contracts;
- duplicate reconciliation and restart recovery regressions;
- control-plane service IDs/adapters rejected by scheduling policy;
- authenticated/RBAC/route-catalog/audit tests;
- no real process, container, Nginx or power mutation in automated tests.

## Deployment acceptance

1. Register Task Manager with `always` policy and verify no behavior change.
2. Change Task Manager to a short controlled schedule window with an explicit
   rollback window and local SSH access retained.
3. Observe preview, transition, PM2 state, readiness and audit event.
4. Restore `always` and verify reconciliation.
5. Repeat with a disposable Docker fixture, never an unknown existing
   container.
6. Verify Nginx/cloudflared/Atlas remained active throughout.

## Acceptance

The operator can open Services -> Task Manager -> Schedule, select days and
times, preview the next transitions, save, see the authoritative reread and
observe the audited reconciliation. Docker uses the same visual and policy
language. Nginx remains visible as critical infrastructure and cannot be
scheduled off from the dashboard.
