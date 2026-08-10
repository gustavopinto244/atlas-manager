# Slice 4: scheduling UX and adapter boundaries

## Status

Delivered (branch `agent/operator-dashboard-v2-slice-4`):

- **Draft preview without persisting**: `PreviewRegisteredServiceAvailabilityPolicy`
  (new use case) + `GET /admin/services/:id/schedule/preview?policy=&startsAt=&endsAt=`
  reuse the existing domain validation and evaluator with a candidate policy
  instead of the persisted one, satisfying "the browser does not calculate
  authoritative transitions independently." Also fixed a real pre-existing
  gap found while wiring this: an invalid policy `mode` was not mapped to a
  400 response on the _existing_ save route either.
- **Editor**: explicit per-day enable checkbox (previously implicit via
  empty inputs), copy-one-day-to-selected-days, clear day, clear week,
  dirty-state tracking with a `beforeunload` warning, and Save/Preview/Remove
  as three distinct actions (Remove wires up the schedule-delete route that
  already existed but had no UI trigger).
- **Timeline**: shows the current effective state (`effectiveAvailability`,
  already computed server-side, now also fetched on the success path rather
  than only as an error fallback) and the current local time formatted in
  the policy's own timezone.
- **Control-plane boundary**: verified, not implemented -- there is no HTTP
  path to register a new service at all (`REGISTERED_SERVICES_JSON` is
  operator-controlled deployment config, applied only through the
  transactional `replace-disabled` flow), and `managementAdapter` is a
  closed enum (`mock`/`pm2`/`docker`/`docker-compose`) with no `systemd`
  option. Nginx, cloudflared and Atlas Manager cannot become schedulable
  services through any code path that exists today; this document's own
  prohibition on a generic systemd adapter without a dedicated ADR (see
  "Nginx boundary" below) remains un-triggered because no such adapter was
  added.

**Not delivered, explicitly deferred:**

- True multi-window-per-day editing. The domain already supports multiple
  windows sharing a weekday (verified in
  `weekly-availability-schedule.ts`'s overlap check), and `copyWindowToDays`/
  `clearDayWindow` operate generically on arbitrary window lists, but the
  editor's day rows are still fixed at one window per weekday. Extending to
  dynamic add/remove rows per day is a larger UI change left for a follow-up.
- Active override and expiry display on the timeline. No current endpoint
  returns the override's `kind`/`expiresAt` on the success path used by the
  schedule view (`GetRegisteredServiceAvailability` returns policy +
  effective availability, not the override object) -- this needs a small new
  read-only use case, not just frontend work, and was deferred to keep this
  pass's backend surface area to the one addition (preview) that was
  strictly necessary.
- Scheduler cursor/health surfaced per service (no authoritative API exposes
  it at that granularity; the plan itself gates this on "when exposed").
- The physical deployment acceptance steps (register Task Manager, run a
  live schedule window, verify Nginx/cloudflared/Atlas stayed up) require
  Atlas host access this session does not have.

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
