# Milestone phase traceability

This table maps every phase of the original milestone prompt to the planning
document that owns it. It is a coverage index, not evidence of implementation.

| Prompt phase | Subject                             | Planning owner                                              |
| ------------ | ----------------------------------- | ----------------------------------------------------------- |
| 0            | Architectural inventory             | `operator-experience-inventory.md`, current-state context   |
| 1            | ADR and experience contract         | ADR-027, security/API plan                                  |
| 2–4          | CLI executable, command tree and UX | CLI plan                                                    |
| 5–6          | Status and doctor                   | CLI plan, infrastructure diagnostics plan                   |
| 7            | Service-management CLI              | CLI plan, service-management plan                           |
| 8–9          | Schedule CLI and preview            | service-management plan, CLI plan                           |
| 10           | Dashboard shell                     | dashboard plan, ADR-027                                     |
| 11           | Overview                            | dashboard plan, infrastructure diagnostics plan             |
| 12           | Services page                       | dashboard plan, service-management plan                     |
| 13–14        | Weekly editor and schedule timeline | dashboard plan, service-management plan                     |
| 15           | PM2/Docker/Compose scheduling       | service-management plan                                     |
| 16–17        | Machine schedule model and preview  | machine plan and power-safety plan                          |
| 18           | Destructive-action UX               | dashboard plan, security/API plan                           |
| 19           | Capability matrix                   | `docs/capabilities.md`                                      |
| 20           | README                              | testing/documentation/release plan                          |
| 21           | Runbook v3                          | testing/documentation/release plan                          |
| 22           | CLI reference                       | CLI plan, testing/documentation/release plan                |
| 23           | Scheduling documentation            | service-management plan, testing/documentation/release plan |
| 24           | Dashboard documentation             | dashboard plan, testing/documentation/release plan          |
| 25           | Event-history coverage              | backups and event-history plan                              |
| 26           | Authorization UX and CLI boundary   | security/API plan, ADR-027, required follow-up ADR          |
| 27           | Dashboard API                       | security/API plan and per-feature plans                     |
| 28           | Accessibility                       | dashboard plan                                              |
| 29           | CLI tests                           | CLI plan                                                    |
| 30           | Dashboard tests                     | dashboard plan                                              |
| 31           | Scheduler regression                | service-management plan                                     |
| 32           | Power regression                    | machine plan and power-safety plan                          |
| 33           | Security regression                 | security/API plan                                           |
| 34–35        | Commits and documentation per slice | execution roadmap                                           |
| 36           | Full qualification                  | testing/documentation/release plan                          |
| 37           | Candidate A/B reproducibility       | testing/documentation/release plan                          |
| 38           | Host rehearsal                      | testing/documentation/release plan                          |
| 39           | Dashboard deployment validation     | dashboard plan, testing/documentation/release plan          |
| 40           | Operator acceptance                 | execution roadmap, testing/documentation/release plan       |
| 41           | Definition of Done                  | testing/documentation/release plan and final evidence       |

## Unresolved decisions that block implementation slices

Reconciled 2026-08-10 against source HEAD `298ffa9` plus this session's
Slice 4 completion; see
[`docs/reviews/operator-experience-current-state.md`](../../reviews/operator-experience-current-state.md)
for full evidence. Only decisions with no accepted resolution in source
remain in this table.

Re-reconciled 2026-08-10 by the authenticated mutating CLI milestone. The
"Local/remote CLI identity model" row was removed from this table: it was
resolved by ADR-028 (constraints, Accepted) plus ADR-031 (concrete
authenticated mutation transport, Accepted), and `services start/stop/restart`
are implemented against that transport. The row's previous wording —
"ADR-028; authenticated transport implementation and security tests remain" —
also misread ADR-028's status; see correction C1 in
[`docs/reviews/operator-experience-current-state.md`](../../reviews/operator-experience-current-state.md).

| Decision                                                                       | Blocks | Required artifact |
| ------------------------------------------------------------------------------ | ------ | ----------------- |
| Re-reconciled 2026-08-10 by the scheduling and backup CLI mutations milestone. |
| It required **no new ADR**: ADR-031 pre-authorised reusing its transport for   |
| schedule and backup mutations as a mechanical follow-up slice, and the slice   |
| held every invariant that authorisation depended on — zero new administrative  |
| routes (the catalog stays at 47 descriptors), confirmations bound to the       |
| canonical catalog by contract test, RBAC and audit entirely server-owned, no   |
| automatic retry, and ambiguous outcomes mapped to an indeterminate class       |
| distinct from both success and failure.                                        |

`backups scheduler tick` was classified and deliberately left unexposed rather
than silently omitted: its `claim_protected` replay policy and
reentrancy-guarded compare-and-set cursor make it internal, cron-triggered
maintenance, not an interactive operator command.

| Machine policy persistence and precedence | machine schedule mutation | dedicated ADR |

## Resolved decisions

| Decision                                                                           | Resolution                                                                                                                                                                                                                                                                                                                                                                                                                                                | Evidence                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Correct end-to-end Cloudflare assertion flow and remove current read bypass        | The unauthenticated dashboard read exception was removed; every administrative route requires a valid Access assertion and authorized principal.                                                                                                                                                                                                                                                                                                          | `08-security-api-and-authorization.md`'s own header note; `tests/http/administrative-dashboard-authentication-integration.test.ts`, `tests/access-control/`                                                                      |
| Service policy persistence and precedence                                          | `ServiceAvailabilityPolicyStore` (in-memory and file-backed) exists; `PolicyAwareRegisteredServiceCatalog` fully replaces the environment-owned base policy with a persisted one when present, identically through `findById()` and `list()`; temporary overrides remain a separate evaluation layer.                                                                                                                                                     | `src/service-management/infrastructure/policy-aware-registered-service-catalog.ts`; precedence explicitly tested in `tests/service-management/infrastructure/policy-aware-registered-service-catalog.test.ts` (added 2026-08-10) |
| Final route additions and explicit route count                                     | Exercised three times without incident (45→46→47 across Slices 3 and 4); an automated test now reconciles the published contract against the live catalog on every run instead of relying on manual count-matching.                                                                                                                                                                                                                                       | `tests/http/administrative-api-contract.test.ts` (added 2026-08-10)                                                                                                                                                              |
| Local/remote CLI identity model                                                    | ADR-028 (Accepted) fixes the identity and privilege constraints; ADR-031 (Accepted) chooses the concrete transport — operator-authenticated HTTP through the existing administrative boundary, forwarding an externally issued Access assertion. No new route, no second authorization system.                                                                                                                                                            | `docs/adr/028-cli-identity-and-privilege-boundary.md`, `docs/adr/031-authenticated-mutating-cli-transport.md`, `docs/reviews/mutating-cli-threat-model.md`, `tests/cli/mutating-transport-security.test.ts`                      |
| ADR-027 formal status                                                              | Accepted 2026-08-10 after a decision-by-decision conformance review: twelve of thirteen normative decisions implemented and regression-covered, the thirteenth an unbuilt capability rather than a divergence.                                                                                                                                                                                                                                            | `docs/reviews/adr-027-implementation-conformance.md`                                                                                                                                                                             |
| Runtime diagnostic implementation boundary (Node adapters versus shared Go report) | ADR-032 (Accepted) chooses TypeScript adapters running in-process with the live server, following the `pm2-process-list-executor.ts` bounded-exec template (fixed argv from constants, `shell:false`, explicit timeout and `maxBuffer`). The root-run, deployment-time Go tooling stays isolated per ADR-018/030; no Go code was touched. Diagnostics are read-only forever, reach the CLI only through one protected route, and never elevate privilege. | `docs/adr/032-operator-infrastructure-diagnostics-runtime-boundary.md`, `src/infrastructure-diagnostics/`, `tests/http/infrastructure-diagnostics-route.test.ts`, `tests/cli/infrastructure-diagnostics.test.ts`                 |
