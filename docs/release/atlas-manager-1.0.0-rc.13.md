# Atlas Manager 1.0.0-rc.13

## Scope

This release candidate closes the remaining verifiable gap in Operator
Dashboard v2 Slice 1 and reconciles release-identity drift discovered while
auditing the repository ahead of formalizing this version.

## Dashboard: controls driven by supportedOperations

`renderServices()` previously rendered start/stop/restart buttons and a Logs
button unconditionally, regardless of what a registered service actually
supports. The backend already enforces `supportedOperations` on control and
log operations (`control-registered-service.ts`,
`get-registered-service-logs.ts`); the dashboard now matches, deriving its
buttons from the same field via a new testable module,
`src/dashboard/service-operations.ts`.

Task Manager's actual registration in `REGISTERED_SERVICES_JSON` remains an
operator action: it requires confirming the real PM2 process name on Atlas
(`pm2 jlist`), which this repository cannot observe. The PM2 dispatch
pipeline (`create-service-management.ts`) is already fully adapter-generic —
no further source work is required to register it once the process name is
confirmed, via the existing transactional `replace-disabled` configuration
flow.

## Release identity audit

`docs/reviews/rc13-release-identity-audit.md` inventories every place the
application version appears. It found `package-lock.json`'s root version
still at `1.0.0-rc.11` (missed during the rc.12 bump) and a hardcoded
`"1.0.0-rc.11"` fallback in `scripts/generate-requirements-traceability.mjs`
that had required a manual bump on three prior releases. The fallback now
derives from `package.json`, matching the pattern already used by
`generate-release-contract.mjs` and `build-operator-package.mjs`.

## Verification

- Cloudflare Access, Host/Origin validation, RBAC, audit, and mutation gates
  are unchanged.
- The backend remains the sole authority on which operations a service
  supports; the dashboard only reflects that authority, it does not decide it.
- Power remains mock-only:
  - `POWER_MANAGEMENT_BACKEND=mock`
  - `MACHINE_POWER_EFFECTS_ACTIVATION=disabled`
  - `MACHINE_POWER_SCHEDULER_ENABLED=false`
- No Atlas host deployment is included in this source release candidate.

## Deferred

Operator Dashboard v2 Slices 2-4 (visual shell, resource observability,
scheduling UX) are not started. Per the plan's own rule, deployment occurs
only after all four slices pass full qualification.
