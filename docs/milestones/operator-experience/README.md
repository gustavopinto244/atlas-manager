# Atlas Operator Experience — plan and implementation context

Status: implementation reconciled through Operator Dashboard v2 Slice 4

This directory preserves the original implementation plan and records its
current source reconciliation. The source inventory and capability matrix are
authoritative when an older planning statement conflicts with implemented
code.

## Current implementation baseline (2026-08-10)

See [`docs/reviews/operator-experience-current-state.md`](../../reviews/operator-experience-current-state.md)
for the full, source-derived inventory. Summary:

- Source HEAD at reconciliation start: `298ffa95f53fa18b48221f6c81df26279d9ea9e9`
  (merge of Operator Dashboard v2 Slice 3, #313); this reconciliation and
  Slice 4 continue on `feat/operator-experience-slice4`.
- Release: `1.0.0-rc.13`.
- Administrative route catalog: **47 descriptors**, verified against source
  by `tests/http/administrative-api-contract.test.ts` (not a static count —
  see that test before trusting any other number in this directory).
- Completed capability tracks: security/contracts repair, CLI foundation
  and 16 of 23 read-only command nodes, dashboard shell/navigation
  (Operator Dashboard v2 Slice 2), service resource observability
  (Slice 3), and registered-service scheduling — persistent policy store,
  candidate-draft preview, weekly editor overhaul, timeline current-state
  display (Slice 4).
- Remaining implementation: mutating CLI commands (blocked on ADR-028),
  infrastructure diagnostics (CLI/dashboard), machine schedule mutation
  (blocked on a dedicated policy-store ADR), Compose resource aggregation
  semantics, active-override display on the schedule timeline.
- Remaining operational acceptance: Task Manager registration and any live
  scheduling acceptance require Atlas host access this reconciliation does
  not have; see the Slice 4 final reconciliation document for the current
  blocker.

### Original inventory snapshot (historical, do not treat as current)

Inventory snapshot: 2026-08-09

Implementation baseline: `ebd998d` plus the reviewed commits on the current
branch

Branch: `agent/fix-administrative-profile-contract`

## Current use

- Inventory the current source and contracts.
- Record divergences and architectural gates.
- Split implementation into reviewable capability tracks.
- Define expected tests, commits, release qualification and deployment gates.
- Distinguish completed capabilities from deferred work.
- Keep runtime, release and Atlas deployment claims outside planning status.

## Documents

- [Current state and divergences](00-current-state-and-divergences.md)
- [Execution roadmap](01-execution-roadmap.md)
- [CLI plan](02-cli.md)
- [Dashboard plan](03-dashboard.md)
- [Service management and scheduling plan](04-service-management-and-scheduling.md)
- [Machine plan and power-safety plan](05-machine-plan-and-power-safety.md)
- [Infrastructure diagnostics plan](06-infrastructure-diagnostics.md)
- [Backups and event-history plan](07-backups-and-event-history.md)
- [Security, API and authorization plan](08-security-api-and-authorization.md)
- [Testing, documentation, release and deployment plan](09-testing-release-and-deployment.md)
- [Milestone phase traceability](10-phase-traceability.md)
- [Source capability inventory](../operator-experience-inventory.md)
- [Current capability matrix](../../capabilities.md)
- [Proposed presentation-adapter ADR](../../adr/027-operator-cli-and-dashboard.md)

## Remaining sequencing

1. Accept a separate local CLI authentication ADR before adding
   mutating CLI commands.
2. Keep new presentation work mapped to shared application/domain contracts.
3. Run full qualification, independent Candidate A/B builds and read-only host
   qualification before deployment.

## Invariants

- CLI and dashboard remain presentation adapters.
- Cloudflare Access, application authentication, RBAC, Host/origin validation,
  audit and mutation gates remain effective.
- No anonymous administrative API is acceptable.
- No real shutdown, reboot, wake-alarm or RTC mutation is used in automated
  tests or milestone rehearsals.
- PM2, Docker and Compose scheduling use the registered-service domain; they do
  not gain technology-specific scheduling models.
- Route-count changes are explicit contract changes, never silent gate edits.
- Human output is never parsed internally; machine consumers use typed/JSON
  output.

## Implementation reconciliation gate

- Administrative shell, assets and APIs fail closed without a valid Access
  assertion and authorized principal.
- The catalog and published contract stay reconciled by
  `tests/http/administrative-api-contract.test.ts` (47 descriptors as of
  2026-08-10; do not hardcode this number elsewhere).
- CLI/dashboard remain presentation adapters.
- Power browser tests cover disabled, loading, unauthorized, busy, malformed
  response, confirmation and accepted-occurrence flows.
- Physical power effects and the machine scheduler remain disabled.
