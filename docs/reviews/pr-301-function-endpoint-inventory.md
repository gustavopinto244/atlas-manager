# PR #301 — function and endpoint inventory

## Source binding

- Review base: `c538212159e39ce1f979da14af067ded55f4fc7c`
- Reviewed merge: `9cad7dd78ccd93d09a27c2e3c6cf64028b6ae766`
- Review follow-up base: `ad9629794ff1bbde72d61e30200b125deed8b75a`
- Corrective implementation HEAD: `7c8eae6` (documentation commit follows)
- Review branch: `agent/review-pr-301-administrative-power-dashboard`

`origin/main` has advanced after the specified merge. This review preserves the
requested PR range for change attribution and uses the effective HEAD for all
runtime, security-catalog, and qualification conclusions.

## Changed-file inventory

The requested PR range contains 37 changed files (2,051 additions and 155
deletions). The reviewed production files are grouped below; test and
documentation changes are reviewed as evidence, not as proof of a contract.

| Area                         | Files                                                                                                                                  | Changed executable surface                                                                   |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Administrative configuration | `deployment/internal/administrativeconfiguration/input.go`, `src/config/administrative-runtime-profile.ts`                             | persisted input, environment generation, public-origin authority, power HTTP flags           |
| Runtime verification         | `deployment/internal/runtimeverification/verification.go`                                                                              | loopback health, protected/absent route probes, startup retry                                |
| Lifecycle                    | `deployment/internal/servicelifecycle/lifecycle.go`                                                                                    | profile classification, configuration-state validation, administrative authority propagation |
| Dashboard HTTP               | `src/http/administrative-dashboard-route.ts`, `src/http/administrative-overview-route.ts`, `src/http/create-administrative-runtime.ts` | dashboard asset exposure, overview capability contract, protected-runtime composition        |
| Dashboard presentation       | `src/dashboard/power-controls.ts`, `src/dashboard/machine-plan-view.ts`, `src/dashboard/main.ts`, `src/dashboard/styles.css`           | wake alarm, shutdown preparation/execution, machine preview, error propagation               |
| Power domain                 | `src/power-management/domain/machine-shutdown-confirmation.ts`                                                                         | canonical confirmation constants                                                             |
| CLI and packaging            | `src/cli/main.ts`, `scripts/generate-dashboard-assets.mjs`, `package.json`, `package-lock.json`                                        | installed CLI version and dashboard asset inclusion                                          |
| Deployment isolation         | `deployment/internal/systemdunit/unit.go` (transitive dependency inspected)                                                            | writable state-directory contract for new power persistence                                  |

The full changed-file set, including tests and docs, was obtained with
`git diff --name-status c538212..9cad7dd`; the resulting list is retained in
the Git history and is checked again by the review-completeness gate.

## Function and type inventory

The function-level audit covers every changed executable hunk and each directly
reachable helper. The authoritative per-function entries, including callers,
callees, persistence, and verdict, are in
[`pr-301-function-audit.md`](./pr-301-function-audit.md).

### Go

| File                                                       | Functions/types added or changed in the PR range                                                                                                                                                                                                                                 |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deployment/internal/administrativeconfiguration/input.go` | `Input`, `ExampleInputBytes`, `ValidateInput`, `validPublicOrigin`, `PublicOriginAuthority`, `Environment`, `environmentWithoutPublicOrigin`, `applyPowerSurfaceFlags`, `addPublicOrigin`                                                                                        |
| `deployment/internal/runtimeverification/verification.go`  | `Dependencies`, `Verify`, `VerifyAdministrative`, `verifyAdministrativeRoute`, `administrativeProbeBody`, `verifyHealth`, `isRetryableHealthFailure`, `verifyHealthOnce`, `verifyAbsent`, `verifyAbsentWithHost`, `verifyProtected`, `verifyProtectedWithBody`, `verifyIdentity` |
| `deployment/internal/servicelifecycle/lifecycle.go`        | `New`, `administrativeHost`, `validateConfiguration`, `isAdministrativeProfile`, `parseAdministrativeProfile`, `parseEnvironment`, `validEnvironmentKey`, `parseBoolean`, `hasEnvironmentKey`, `looksAdministrativeProfile`                                                      |

### TypeScript

| File                                                           | Functions/types added or changed in the PR range                                                                                      |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `src/config/administrative-runtime-profile.ts`                 | `MockAdministrativeInput`, `parseMockAdministrativeInput`, `createMockAdministrativeEnvironment`                                      |
| `src/http/administrative-dashboard-route.ts`                   | `SERVED_ASSETS`, `registerAdministrativeDashboardRoutes`                                                                              |
| `src/http/administrative-overview-route.ts`                    | `AdministrativeOverviewRouteDependencies`, `registerAdministrativeOverviewRoute`, overview `process` handler                          |
| `src/http/create-administrative-runtime.ts`                    | protected runtime composition and overview capability projection                                                                      |
| `src/dashboard/power-controls.ts`                              | `PowerControlsRequestError`, `PowerControlsController`, all private rendering, mutation, validation, and error-classification helpers |
| `src/dashboard/machine-plan-view.ts`                           | `renderMachinePlan`, `renderMachineSchedule`, `renderMachinePreview`, `appendTransition`, `findNextTransition`, parsing helpers       |
| `src/dashboard/main.ts`                                        | `readJson`, `renderOverview`, `renderMachinePlan`, `powerControlsHttpError`, `mutatePowerState`, `refresh`                            |
| `src/power-management/domain/machine-shutdown-confirmation.ts` | confirmation constants and `createMachineShutdownConfirmation`                                                                        |
| `src/cli/main.ts`                                              | installed-version exposure and command rendering path                                                                                 |
| `scripts/generate-dashboard-assets.mjs`                        | dashboard source-to-asset inclusion path                                                                                              |

## Endpoint inventory boundary

The effective runtime has two health endpoints plus the administrative security
catalog. At the review HEAD, the administrative catalog contains 45
descriptors; every descriptor and both health endpoints receive one explicit
entry in [`pr-301-endpoint-audit.md`](./pr-301-endpoint-audit.md).

Classification is based on route registration and runtime activation rather
than the diff alone:

- `GET /health/live` and `GET /health/server`: unchanged public health routes,
  transitively affected by lifecycle retry verification.
- `GET /` and `GET /assets/:asset`: directly changed administrative dashboard
  routes.
- `GET /admin/overview`: directly changed administrative capability response.
- Wake-alarm and shutdown routes: directly changed through profile activation,
  runtime composition, and dashboard clients.
- All remaining catalog descriptors: transitively changed and audited for
  preservation of the common administrative security envelope.

## Configuration and persistence inventory

New or modified configuration keys:

- `ADMINISTRATIVE_WAKE_ALARM_HTTP_ENABLED`
- `ADMINISTRATIVE_SHUTDOWN_HTTP_ENABLED`
- `MACHINE_SHUTDOWN_OCCURRENCE_CLAIM_FILE` (only when shutdown HTTP is enabled)
- `MACHINE_POWER_SCHEDULER_CURSOR_FILE` (only when shutdown HTTP is enabled)

The profile invariant remains mandatory in every reviewed administrative
environment:

```text
POWER_MANAGEMENT_BACKEND=mock
MACHINE_POWER_EFFECTS_ACTIVATION=disabled
MACHINE_POWER_SCHEDULER_ENABLED=false
```

New persistence paths require explicit review of the unit sandbox and ownership
contract:

- `/var/lib/atlas-manager-machine-power/occurrence-claims.jsonl`
- `/var/lib/atlas-manager-machine-power/scheduler-cursor.json`

## Review method

The audit follows executable request paths: route registration, common
administrative middleware, authentication, RBAC, strict request parsing,
admission gate, use case, persistence, event history, and response. It does
not treat names, comments, tests, or documentation as authoritative.
