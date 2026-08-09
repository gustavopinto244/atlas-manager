# PR #301 — function audit

## Scope and method

The PR-range functions and directly reachable private helpers were traced from
input through validation, protected use case, persistence/audit and output.
`FIXED` identifies the follow-up review commits; all other entries retain their
contract.  Dashboard functions use DOM nodes and `textContent`; no changed path
uses `innerHTML`, dynamic scripts or request-derived URL schemes.

## Go administrative profile and lifecycle

### `ExampleInputBytes`, `ValidateInput`, `validPublicOrigin`, `PublicOriginAuthority`, `Environment`, `environmentWithoutPublicOrigin`, `applyPowerSurfaceFlags`, `addPublicOrigin`

File: `deployment/internal/administrativeconfiguration/input.go` · Go · exported/private.

Strict, bounded input creates a canonical environment or fails. It emits mock
backend, disabled effects and disabled scheduler regardless of HTTP flags;
shutdown state paths appear only with the shutdown surface. Public origin is
HTTPS/authority validated. No direct persistence occurs. Tests: input Go suite
and TS profile suite. Verdict: **PASS**.

### `New`, `administrativeHost`, `validateConfiguration`, `isAdministrativeProfile`, `parseAdministrativeProfile`, `parseEnvironment`, `validEnvironmentKey`, `parseBoolean`

File: `deployment/internal/servicelifecycle/lifecycle.go` · Go · exported/private.

Reads only the persisted environment and state hash, rejects duplicates/CRLF/
partial profiles, derives Host and surface flags, then calls the verifier.
Lifecycle lock still owns concurrent activation; configuration persistence is
owned by the administrative configuration transaction. Tests include malformed,
duplicate, prefixed and missing fields. Verdict: **FIXED** (`0d02937`).

### `Verify`, `VerifyAdministrative`, `verifyHealth`, `isRetryableHealthFailure`, `verifyHealthOnce`, `verifyAbsent`, `verifyAbsentWithHost`, `verifyAdministrativeRoute`, `verifyProtected`, `verifyIdentity`

File: `deployment/internal/runtimeverification/verification.go` · Go · exported/private.

Physical requests stay on loopback; only administrative requests set the
validated public Host. Enabled surfaces must return the expected auth envelope;
disabled surfaces must be absent. Retry accepts connection failures only, not
HTTP, malformed body or timeout; cancellation stops waits. No persistence or
power effect. Tests: verifier and lifecycle suites. Verdict: **FIXED**
(`0d02937`).

## TypeScript profile, HTTP and CLI

### `parseMockAdministrativeInput`, `createMockAdministrativeEnvironment`, `isRecord`, `hasOnlyKeys`

File: `src/config/administrative-runtime-profile.ts` · TypeScript · exported/private.

Strict JSON accepts legacy 9-field and either/both optional power flags, rejects
unknown fields, freezes values and produces only mock-safe environment values.
No persistence. Tests: profile suite. Verdict: **FIXED** (`0d02937`).

### `createAdministrativeRuntime`

File: `src/http/create-administrative-runtime.ts` · TypeScript · exported.

Derives activation from parsed runtime config, reconciles catalog registration,
constructs protected façades and independent admission gates. Use cases own
state and audit. Tests: control-plane/catalog/power suites. Verdict: **PASS**.

### `registerAdministrativeOverviewRoute`, `createHandler`, `process`, `send`, `mapError`

File: `src/http/administrative-overview-route.ts` · TypeScript · exported/private.

Applies security headers and admission, validates path/method/target/body, then
executes authenticated/RBAC-protected overview. Capability booleans originate
from composition, never browser input. Tests: control-plane/dashboard auth.
Verdict: **PASS**.

### `getAdministrativeDashboardAssetSnapshot`, `readDashboardSource`, `registerAdministrativeDashboardRoutes`, `createShellHandler`, `createAssetHandler`, `createAdmissionHandler`, `mapError`

File: `src/http/administrative-dashboard-route.ts` · TypeScript · exported/private.

Shell/assets share the catalog, assertion reader, CSP/security headers,
admission and named-asset allowlist; no asset is anonymous. The snapshot is the
same source used by asset generation. Tests: authenticated dashboard and asset
generation. Verdict: **PASS**.

### `registerAdministrativeWakeAlarmRoute`, `createAdministrativeWakeAlarmHandler`, `processRequest`, `readScheduleBody`, `sendBoundedResponse`, `mapWakeAlarmError`

File: `src/http/administrative-wake-alarm-route.ts` · TypeScript · exported/private.

GET is read-only; PUT/DELETE enforce target/content/body/strict JSON/domain,
shared power gate, protected use case, audit and bounded response. No mutation
is inferred by UI. Tests: wake route/integration. Verdict: **FIXED**
(`934b2c3`).

### `registerAdministrativeShutdownRoutes`, `createAdministrativeShutdownHandler`, `processShutdownRequest`, `readShutdownBody`, `parseShutdownRequest`, `createRequestConfirmationReader`, `sendBoundedResponse`, `mapShutdownError`

File: `src/http/administrative-shutdown-route.ts` · TypeScript · exported/private.

Both stages enforce strict JSON, canonical occurrence, exact stage confirmation
and shared power gate before the protected/audited use case. Execution uses the
provided prepared occurrence and domain claims protect duplication. Tests:
shutdown route/integration/power. Verdict: **FIXED** (`934b2c3`).

### `createMachineShutdownConfirmation`

File: `src/power-management/domain/machine-shutdown-confirmation.ts` · TypeScript · exported.

Maps exact canonical confirmation text to a frozen stage or fails; no side
effect. Callers are dashboard and shutdown route. Tests: domain/route suite.
Verdict: **PASS**.

### `readCliVersion`, `runAtlasCli`, `writeResult`

File: `src/cli/main.ts` · TypeScript · private/exported.

Reads packaged version, dispatches transport-backed CLI commands and preserves
human/JSON/exit-code contracts. It has no Cloudflare-header bypass. Tests: CLI
main/parser/transport/doctor. Verdict: **PASS**.

## Dashboard functions

### `PowerControlsController.render`, `settle`, `#renderWakeAlarmControls`, `#renderShutdownPreparationControl`, `#renderShutdownExecutionControl`, `#runMutation`

File: `src/dashboard/power-controls.ts` · TypeScript · public/private.

Reads authoritative overview flags, clears stale DOM, fetches state, disables
the active button, refreshes only after success, and never turns an error into
success. Preparation stores only backend-accepted occurrence; execution sends
that exact occurrence. Backend gate/claims remain authoritative. Tests:
power-controls suite. Verdict: **PASS**.

### `formatWakeAlarm`, `wakeAlarmFailureText`, `mutationFailureText`, `failureKind`, `readShutdownOccurrence`, `formatLocalDateTime`, `readRecord`, `displayValue`

File: `src/dashboard/power-controls.ts` · TypeScript · private.

Validates response shape/timestamp order, maps safe status text and correctly
formats a local HTML datetime input before one canonical UTC conversion.
Tests: power-controls suite. Verdict: **FIXED** (`bfd13dc`).

### `renderMachinePlan`, `renderMachineSchedule`, `renderMachinePreview`, `appendTransition`, `findNextTransition`, `readPlan`, `readRecord`, `readTransition`, `readString`, `unavailablePlan`, `readSchedule`

File: `src/dashboard/machine-plan-view.ts` · TypeScript · exported/private.

Presentation only: validates unknown data and renders schedule/safety through
text nodes. “Next” is earliest timestamp after `evaluatedAt`; invalid evaluation
is unavailable and valid empty plan is not planned. Tests: machine-plan suite.
Verdict: **FIXED** (`bfd13dc`).

### `readJson`, `addText`, `renderOverview`, `appendOverviewCard`, `readRecord`, `displayValue`, `renderInfrastructure`, `renderServices`, `renderAudit`, `renderMachinePlan`, `renderAvailability`, `renderBackups`, `appendBackupPolicyForm`, `appendBackupActionForm`, `powerControlsHttpError`, `mutatePowerState`, `refresh`, `createPreviewWindow`

File: `src/dashboard/main.ts` · TypeScript · private.

Uses same-origin fetch with redirect failure, encoded target IDs, DOM APIs and
backend confirmations. Concurrent UI activity cannot bypass backend admission,
RBAC, audit or claim controls. Tests: dashboard/control-plane/service/backup
suites. Verdict: **PASS**.
