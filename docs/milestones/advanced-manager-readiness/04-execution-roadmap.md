# Execution and qualification roadmap

## Delivery strategy

Implement in small commits. Each slice updates `docs/capabilities.md` only when
the feature becomes usable and tested. Do not combine exposure changes,
dashboard feature work and packaging infrastructure in one patch.

## Phase 0 — deployed-state audit

Read-only checks only:

1. bind deployed service, bundle and assets to source commit and version;
2. inspect effective administrative flags and non-secret persistence paths;
3. verify Atlas, Nginx and cloudflared state and loopback listeners;
4. verify route catalog reconciliation and identity readiness;
5. record which dashboard/API capabilities are Enabled and Authorized;
6. prove power backend/effects/scheduler and wake/shutdown HTTP remain safe;
7. classify every difference as source gap, configuration gap, RBAC gap,
   ingress gap or documentation gap.

Deliverable: runtime capability evidence. No configuration changes occur in
this phase.

## Phase 1 — administrative profile and access acceptance

1. Add a versioned, validated non-secret administrative profile contract.
2. Require persistent schedule/event/backup paths when corresponding mutations
   are enabled.
3. Add configuration matrix tests for every supported flag combination.
4. Add Access assertion forwarding and mapped/unmapped principal rehearsals.
5. Add route-group acceptance tests and event-history assertions.
6. Deploy with backup and rollback, then validate production path behavior.

Commit boundaries should separate configuration schema, security tests and
deployment documentation.

## Phase 2 — dashboard completion

Recommended order:

1. capability-aware navigation and explicit unavailable states;
2. Overview links and partial-health reporting;
3. Services operations and logs acceptance;
4. persistent scheduling editor, preview and next-transition UX;
5. Backups operational forms and errors;
6. Events integrity/retention/export UX;
7. read-only infrastructure diagnostics API and page;
8. Settings API design or removal of the placeholder from the acceptance set.

Each mutation must retain backend authorization, exact confirmation, mutation
admission and started/terminal audit records.

## Phase 3 — operator client package

1. Define a dedicated public package manifest containing only CLI runtime
   files and documentation.
2. Generate a deterministic `npm pack` artifact.
3. Test temporary-prefix install, same-version reinstall, upgrade and uninstall.
4. Add `atlas --version`, help, JSON output and remote authenticated-read smoke
   tests.
5. Publish the artifact through release evidence; do not publish to a public
   registry until package visibility and support policy are explicitly chosen.

Mutating CLI commands remain unavailable until the authenticated transport ADR
is implemented and accepted.

## Phase 4 — server installation experience

1. Inventory the existing five deployment/lifecycle tools and remove duplicated
   operator input from the proposed wrapper design.
2. Create an ADR for orchestration boundaries, elevation, confirmations,
   recovery and logs.
3. Implement an inspect/plan mode before any mutation mode.
4. Reuse existing tools and reports; do not duplicate installer logic in shell.
5. Exercise absent install, same-version verify, upgrade, rollback, uninstall,
   interrupted operation and unknown-state fail-closed behavior in sandboxes.
6. Preserve explicit service activation as a separate operator step.

## Phase 5 — full qualification and deployment

Required gates:

- pinned Node 24.18.0, npm 11.16.0 and Go 1.23.0;
- format, lint, typecheck, production build and all Node tests;
- both Go modules: format, module verification, vet and tests;
- production audit zero and reviewed full-audit classifier;
- 45-route catalog or its deliberate successor bound to the versioned contract;
- dashboard source/generated/bundle equivalence;
- mock-only power regression and no physical effects;
- independent Candidate A/B byte reproducibility for each artifact;
- archive safety, manifest, checksums and required-file inventory;
- clean-machine install/reinstall/upgrade/rollback/uninstall rehearsals;
- read-only host qualification before deployment;
- dashboard acceptance behind Cloudflare Access after deployment.

## Suggested commits

1. `docs: audit administrative exposure and packaging boundaries`
2. `test: add deployed administrative profile matrix`
3. `feat: add capability-aware dashboard availability`
4. `feat: complete service scheduling dashboard acceptance`
5. `feat: expose read-only infrastructure diagnostics`
6. `feat: complete backup and event-history dashboard workflows`
7. `adr: define operator client distribution`
8. `feat: package atlas operator client`
9. `test: qualify client reinstall and upgrade lifecycle`
10. `adr: define server installer orchestration`
11. `feat: add safe server installation planner`
12. `test: qualify server installation lifecycle`
13. `docs: update runbook capability and package references`

The sequence may change based on source findings, but each commit must remain
coherent and independently testable.

## Definition of done

Do not claim completion until evidence supports all applicable gates:

```text
DEPLOYED_SOURCE_BINDING=PASS
CLOUDFLARE_ACCESS_BOUNDARY=PASS
ADMINISTRATIVE_RBAC=PASS
DASHBOARD_AUTHENTICATED_ACCESS=PASS
NON_POWER_ADMINISTRATIVE_SURFACES=PASS
SERVICE_OPERATIONS_DASHBOARD=PASS
SERVICE_SCHEDULING_DASHBOARD=PASS
BACKUPS_DASHBOARD=PASS
EVENT_HISTORY_DASHBOARD=PASS
MACHINE_PLAN_READ_ONLY=PASS
INFRASTRUCTURE_DIAGNOSTICS=PASS
POWER_EFFECTS_REMAIN_DISABLED=PASS
OPERATOR_CLIENT_PACKAGE=PASS
CLIENT_REINSTALLATION=PASS
SERVER_BUNDLE_REINSTALLATION=PASS
PACKAGE_REPRODUCIBILITY=PASS
ROLLBACK_AND_UNINSTALL=PASS
FULL_SOURCE_QUALIFICATION=PASS
DEPLOYMENT_ACCEPTANCE=PASS
```

Settings, physical power actions and mutating CLI commands are excluded from
PASS until their separate contracts are implemented. If they are requested as
part of “all features,” the plan must be expanded explicitly instead of
silently weakening their safety boundaries.
