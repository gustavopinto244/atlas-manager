# Slice 1: reliability and service registration

## Status (rc.13)

Items 1-6 (reliability/isolation) were delivered in rc.12-adjacent work: typed
`AdministrativeApiClient`, per-section state, isolated refresh coordination,
and malformed-response handling are in place
(`src/dashboard/api-client.ts`, `section-state.ts`, `refresh-coordinator.ts`).

This session additionally closed the acceptance gap where control buttons
ignored `supportedOperations`: `renderServices()` in `src/dashboard/main.ts`
now derives its start/stop/restart buttons and Logs button from
`src/dashboard/service-operations.ts`, matching what the backend actually
enforces (`control-registered-service.ts`, `get-registered-service-logs.ts`).

**Item 7-8 (registering the real Task Manager PM2 entry) remain an operator
action, not source work.** The PM2 dispatch pipeline
(`create-service-management.ts`) is already fully generic — any
`managementAdapter: "pm2"` catalog entry works without adapter-specific code.
What is missing is the _fact_ of Task Manager's real PM2 process name on
Atlas, which this repository cannot observe. Registration itself is: confirm
the process name with `pm2 jlist` on Atlas, add the catalog entry to the
administrative input, then run the existing transactional
`replace-disabled` flow
(`docs/operations/atlas-manager-administrative-configuration-replacement.md`)
— no new tooling is required for this step.

## Objective

Replace the current all-or-nothing loading behavior with explicit per-section
state and make the running Task Manager a real registered service.

## Current defects

- `refresh()` waits for overview, services and event history in one rejecting
  `Promise.all`. A failure in any required read prevents every render call.
- Optional reads silently become misleading empty values.
- The global status can be overwritten by `app.js`, `backup.js` and
  `event-history.js`, hiding the actual failing endpoint.
- Loading placeholders do not transition to a section-specific failed state.
- Atlas currently has zero registered services, so Task Manager cannot be
  listed, controlled, scheduled or audited through the service domain.

## Implementation plan

1. Introduce a typed `AdministrativeApiClient` with normalized outcomes:
   `success`, `unauthorized`, `forbidden`, `busy`, `unavailable`,
   `invalid_response` and `network_error`.
2. Give Overview, Services, Schedules, Backups, Events and Infrastructure
   independent async state: loading, ready, empty, failed and stale.
3. Replace the global rejecting refresh with isolated reads and one refresh
   coordinator. A failed backup read must not block Services.
4. Add request generation or cancellation so an older refresh cannot overwrite
   a newer result.
5. Consolidate the three dashboard scripts behind one status/event mechanism,
   or give each page a dedicated live region.
6. Validate API response shapes before rendering. Malformed data is
   `invalid_response`, never an empty authoritative state.
7. Add Task Manager to the administrative input service catalog using the PM2
   adapter and its actual process name. Keep the environment-owned identity and
   persist editable availability policy only through the existing policy store.
8. Rehearse configuration replacement transactionally; do not edit the
   generated environment directly.

## Task Manager target registration

The final input must be derived from the current PM2 deployment and validated
against the registered-service schema. Conceptually:

```json
{
  "id": "task-manager",
  "displayName": "Task Manager",
  "managementAdapter": "pm2",
  "externalResourceId": "task-manager",
  "supportedOperations": ["readStatus", "readLogs", "start", "stop", "restart"],
  "availabilityPolicy": { "mode": "always" }
}
```

The implementation must not copy this example blindly; PM2 identity, readiness
and dependency behavior must be confirmed on Atlas first.

## Tests

- one core endpoint fails while other sections render;
- unauthorized and forbidden are visible and distinct;
- malformed JSON and malformed DTO do not become empty states;
- two overlapping refreshes retain only the newest result;
- registered and empty service lists render correctly;
- Task Manager PM2 status/control/log composition uses fakes in tests;
- dashboard asset generation includes the new client and state components.

## Acceptance

- No section remains indefinitely at `Loading...`.
- A failing section identifies the failing capability and offers Retry.
- Task Manager appears with authoritative PM2 status.
- Start/stop/restart buttons reflect `supportedOperations` rather than a
  hardcoded list.
- No host service is mutated during unit or integration tests.
