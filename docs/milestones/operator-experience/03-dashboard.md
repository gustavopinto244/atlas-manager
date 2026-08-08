# Dashboard plan

## Current baseline

The dashboard is a generated, CSP-constrained vanilla TypeScript application.
It renders one HTML document containing overview, services, availability,
backups, audit and power-safety sections. It already calls protected APIs and
offers primitive service/backup mutations, but it has no page navigation,
component model or typed client layer.

## Decision

Keep vanilla TypeScript for the first milestone. Split it into modules before
adding functionality. A frontend framework needs a separate ADR supported by a
measured maintenance problem; the current size does not yet justify the bundle,
tooling and CSP cost.

## Target shell

```text
App shell
├── Overview
├── Services
├── Schedules
├── Machine
├── Backups
├── Events
├── Infrastructure
└── Settings
```

Navigation may use same-origin path/history routing or hash routing, but the
choice must preserve the strict administrative route catalog and CSP. Server
fallback behavior must be explicit; do not accidentally turn unknown admin
paths into dashboard HTML.

## Component boundaries

- `AdministrativeApiClient`: typed responses and normalized errors.
- `AppRouter` and `Navigation`: page lifecycle and keyboard focus.
- `AsyncState`: loading, success, empty, unauthorized, busy and failure.
- `StatusCard`: summary plus navigation target.
- `ServiceCard`/`ServiceDetail`: domain-oriented service information.
- `WeeklyScheduleEditor`: input only; backend remains authoritative.
- `ScheduleTimeline`: reusable service/container/machine visualization.
- `ConfirmationDialog`: operation summary and affected target.
- `EventList`: paginated/tail-capable event presentation.

No domain rule belongs only in these components.

## Page delivery order

1. Shell/navigation and typed API client.
2. Overview using existing overview/services/backups/events endpoints.
3. Services read model and operations.
4. Schedules editor/timeline after schedule APIs exist.
5. Backups and Events.
6. Infrastructure after diagnostic APIs exist.
7. Machine read/preview before mutation controls.
8. Settings limited to capabilities that have explicit backend contracts.

## UX requirements

- Read-only actions do not ask for confirmation.
- Destructive actions show target, effect and confirmation requirement.
- Backend RBAC remains authoritative; hidden controls are not authorization.
- Every page has explicit loading, empty, stale, denied, busy and retry states.
- Save success is based on authoritative reread, not optimistic assumption.
- Schedule states use labels and patterns in addition to color.
- Focus moves to page headings, dialogs trap focus, and status changes use
  appropriate live regions.
- Layout supports keyboard, mobile, tablet and desktop.

## Dashboard tests

Use DOM-level unit/component tests without real services:

- navigation and focus;
- card links and service actions;
- editor weekday/time/timezone behavior;
- timeline current-time and transition markers;
- save/remove/preview flows;
- loading, denied, busy, conflict and validation errors;
- API response shape failures;
- refresh after mutation;
- generated asset equivalence and CSP/security headers.
