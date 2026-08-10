# Operator Experience — current state inventory

Snapshot: 2026-08-10

Source HEAD at the start of this reconciliation:
`298ffa95f53fa18b48221f6c81df26279d9ea9e9` (merge of Operator Dashboard v2
Slice 3, #313)

This document is derived directly from source, tests and generated contracts
— not from planning text. Where a claim could be verified programmatically
(route count, CLI command tree, dashboard page list), the verification method
is named so the claim can be re-run rather than trusted on faith.

## Identity

| Field             | Value                                                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `SOURCE_HEAD`     | `298ffa95f53fa18b48221f6c81df26279d9ea9e9` (start); this reconciliation continues on `feat/operator-experience-slice4` |
| `PACKAGE_VERSION` | `1.0.0-rc.13`                                                                                                          |

## Administrative route catalog

| Field                        | Value                                                                                                                                                                                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ADMINISTRATIVE_ROUTE_COUNT` | 47 (verified: `ADMINISTRATIVE_ROUTE_SECURITY_CATALOG.length` in `src/http/administrative-route-security-catalog.ts`, cross-checked against `docs/contracts/atlas-manager-administrative-api.json` by `tests/http/administrative-api-contract.test.ts`) |
| `ADMINISTRATIVE_ROUTE_IDS`   | See `docs/contracts/atlas-manager-administrative-api.json` — kept in exact source order and reconciled automatically going forward                                                                                                                     |

History: 40 (pre-2026-08-08 baseline) → 45 (2026-08-09 operator-experience
slices) → 46 (Slice 3, `services.resources.read`) → 47 (Slice 4,
`services.schedule.preview`).

## CLI

Source: `src/cli/command-tree.ts`.

| Field                      | Value                                                                                                                                                                                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLI_COMMAND_NODES`        | 23                                                                                                                                                                                                                                                                  |
| `CLI_IMPLEMENTED_COMMANDS` | 16: `status`, `health`, `doctor`, `services list`, `services status`, `services logs`, `services schedule show`, `services schedule preview`, `backups list`, `backups status`, `backups runs`, `events`, `machine status`, `machine plan`, `machine schedule show` |
| `CLI_STUB_COMMANDS`        | 7: `services start`/`stop`/`restart` (blocked on the CLI identity ADR, ADR-028 — see "Unresolved decisions" below), `infra status`/`listeners`, `nginx status`/`test`, `tunnel status` (infrastructure-diagnostics track not started)                               |

`services schedule preview` here is the **persisted-policy** preview
(`GET /admin/services/:id/availability/preview`), which existed before this
reconciliation. The Slice 4 addition — previewing a **candidate/draft**
policy without saving it (`GET /admin/services/:id/schedule/preview`) — has
no CLI command yet; see the Slice 4 gap analysis for why this was deferred
rather than added in the same pass.

## Dashboard

Source: `src/dashboard/navigation.ts` (`DASHBOARD_PAGES`),
`scripts/generate-dashboard-assets.mjs` (asset inventory check).

| Field              | Value                                                                                                                                          |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `DASHBOARD_PAGES`  | 8: Overview, Services, Schedules, Machine, Backups, Events, Infrastructure, Settings                                                           |
| `DASHBOARD_ASSETS` | 3 served files: `app.js`, `styles.css`, `index.html` (down from 5 before Slice 2 removed the duplicate `backup.js`/`event-history.js` scripts) |

## Registered-service adapters

Source: `SERVICE_MANAGEMENT_ADAPTERS` in
`src/service-management/domain/registered-service.ts`.

| Field                         | Value                                                                                   |
| ----------------------------- | --------------------------------------------------------------------------------------- |
| `REGISTERED_SERVICE_ADAPTERS` | `mock`, `pm2`, `docker`, `docker-compose` — closed enum, no `systemd` or generic option |

## Service capabilities

| Field                                      | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `SERVICE_STATUS_CAPABILITY`                | Available. `GetRegisteredServiceStatus` + `DispatchingServiceStatusReader` (mock/pm2/docker/compose)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `SERVICE_CONTROL_CAPABILITY`               | Available (start/stop/restart) via `ControlRegisteredService` + `DispatchingServiceController`; protected mutation routes with per-operation confirmation                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `SERVICE_LOGS_CAPABILITY`                  | Available via `GetRegisteredServiceLogs` + `DispatchingServiceLogReader` (Docker container / Compose project readers)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `SERVICE_RESOURCE_CAPABILITY`              | Available for `pm2`/`docker` via `GetRegisteredServiceResources` + `DispatchingServiceResourceReader` (Slice 3); `mock`/`docker-compose` report `unsupported` deliberately                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `SERVICE_AVAILABILITY_OVERRIDE_CAPABILITY` | Available. `ServiceAvailabilityOverrideStore`, `SetRegisteredServiceAvailabilityOverride`/`CancelRegisteredServiceAvailabilityOverride`, protected `/admin/services/:id/availability` PUT/DELETE                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `SERVICE_SCHEDULE_READ_CAPABILITY`         | Available. `GetRegisteredServiceSchedule`, protected `GET /admin/services/:id/schedule`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `SERVICE_SCHEDULE_MUTATION_CAPABILITY`     | Available. `UpdateRegisteredServiceAvailabilityPolicy`/`RemoveRegisteredServiceAvailabilityPolicy`, protected PUT/DELETE, dashboard Save/Remove actions (Slice 4)                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `SERVICE_SCHEDULE_PREVIEW_CAPABILITY`      | Two distinct capabilities: (1) persisted-policy interval preview, pre-existing; (2) candidate-policy preview added in Slice 4 (`PreviewRegisteredServiceAvailabilityPolicy`, `GET /admin/services/:id/schedule/preview`), tagged `source: candidate_preview`, dashboard-only                                                                                                                                                                                                                                                                                                                                                         |
| `SERVICE_POLICY_PERSISTENCE`               | `ServiceAvailabilityPolicyStore` port; `InMemoryServiceAvailabilityPolicyStore` and file-backed implementation exist. Precedence (verified from `PolicyAwareRegisteredServiceCatalog`, now covered by tests added in this reconciliation): the environment-owned base policy from `REGISTERED_SERVICES_JSON` is used as-is until a persisted-store entry exists for that service ID, at which point it **fully replaces** (not merges with) the base policy, identically through both `findById()` and `list()`. Temporary availability overrides are a separate, later-applied evaluation layer, not part of this precedence chain. |

## Backups / event history

| Field                        | Value                                                                                                                                                            |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BACKUP_CAPABILITIES`        | Target/run queries, manual run, schedule read/update/remove, retention read/update/prune, scheduler tick — all present with protected routes, file-backed stores |
| `EVENT_HISTORY_CAPABILITIES` | Segmented store: query, integrity, rotation, retention, prune, exports (create/read/download/prune)                                                              |

Unchanged by this reconciliation; see `docs/milestones/operator-experience/07-backups-and-event-history.md` for the still-pending CLI/dashboard delivery items (out of scope for Slice 4).

## Machine plan / power

| Field                       | Value                                                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `MACHINE_PLAN_CAPABILITIES` | Read-only plan/next-transition/simulation preview; mock-first                                                                        |
| `POWER_CAPABILITIES`        | Wake-alarm read/schedule/cancel and shutdown prepare/execute exist behind feature flags, mock backend, exact confirmations and gates |

Machine policy (`MACHINE_OPERATING_POLICY`) has no runtime store or mutation
use case — this remains correctly blocked pending a dedicated ADR, unchanged
by Slice 4 (registered-service scheduling and machine scheduling are
separate domains and were not merged).

## Infrastructure diagnostics

| Field                                     | Value                                                                                                                                                                 |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `INFRASTRUCTURE_DIAGNOSTICS_CAPABILITIES` | Partial: `/admin/security/status` exposes route catalog/activation-flag posture; no `atlas infra`/`nginx`/`tunnel` adapters exist yet (CLI nodes present but stubbed) |

## Release tooling / operator package

| Field              | Value                                                                                                                                                                                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RELEASE_TOOLING`  | `release:generate-contract`, `release:generate-dependencies`, `release:generate-evidence`, `release:generate-traceability`, `release:generate-digests`, `release:validate`, `release:validate-snapshots`, `release:rehearse` (all in `package.json`, backed by `scripts/*.mjs`) |
| `OPERATOR_PACKAGE` | `npm run package:operator` builds a reinstallable `.tgz` client; `deployment/` Go tooling builds the reproducible server bundle                                                                                                                                                 |

## Administrative API contract digest

`docs/contracts/atlas-manager-administrative-api.json` carries a
`catalogSha256` field. An earlier pass of this reconciliation concluded it
was orphaned, based on a grep across `scripts/`, `deployment/` and `tests/`
that missed its real consumer: `.github/workflows/ci.yml`'s "Release
candidate security and contract gate" step imports
`createAdministrativeApiContract()` from
`src/http/administrative-api-contract.ts` directly (not through any script
in `scripts/`) and fails the build if its computed `.sha256` does not equal
`catalogSha256`. Removing the field broke CI on PR #316. It has been
restored with the digest that function actually produces —
`912e575b5415b25b2d51c6bdcdb1a1acb1c1878734349091cd4678bbdfe32396` over the
current 47-route catalog — and
`tests/http/administrative-api-contract.test.ts` now asserts the published
value matches that function's live output on every run, alongside the
pre-existing whole-file release-contract/evidence digest mechanism computed
by `scripts/generate-release-contract.mjs` and
`scripts/generate-release-evidence.mjs`, which remains a separate, unrelated
check.

## ADR-027 status

`docs/adr/027-operator-cli-and-dashboard.md` remains `Status: Proposed`.
Source has been built in extensive, verified compliance with its decision
(presentation-adapter layering, no forged Cloudflare assertions, mutating
CLI blocked pending a separate identity ADR, route-count changes treated as
explicit contract changes) across the CLI foundation, all four Operator
Dashboard v2 slices, and this reconciliation pass. This is a governance gap,
not a source gap: recommend the maintainer formally accept ADR-027 given the
implementation already conforms to it; this reconciliation does not change
the ADR's status itself.

## Unresolved decisions (re-derived from `10-phase-traceability.md`)

| Decision                                                | Status                                | Evidence                                                                                                                                                                                                                                                  |
| ------------------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cloudflare assertion flow / unauthenticated read bypass | **Resolved**                          | `docs/milestones/operator-experience/08-security-api-and-authorization.md`'s own header note confirms removal; extensive auth regression suite passes (`tests/http/administrative-dashboard-authentication-integration.test.ts`, `tests/access-control/`) |
| Local/remote CLI identity model                         | **Still open**                        | No ADR-028 exists; `services start/stop/restart` CLI nodes remain `implemented: false` by design                                                                                                                                                          |
| Service policy persistence and precedence               | **Resolved**                          | `ServiceAvailabilityPolicyStore` + `PolicyAwareRegisteredServiceCatalog` exist; precedence now explicitly tested (see above)                                                                                                                              |
| Machine policy persistence and precedence               | **Still open**                        | No policy store or mutation use case for `MACHINE_OPERATING_POLICY`; correctly out of Slice 4 scope                                                                                                                                                       |
| Runtime diagnostic implementation boundary              | **Still open**                        | Infrastructure-diagnostics track not started                                                                                                                                                                                                              |
| Final route additions and explicit route count          | **Resolved as an ongoing discipline** | Exercised three times (45→46→47) with contract updates each time; now backed by an automated reconciliation test rather than manual count-matching                                                                                                        |
