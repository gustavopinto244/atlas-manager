# Atlas Operator Experience — plan and implementation context

Status: implementation reconciled through the Operator Infrastructure
Diagnostics milestone (ADR-032, PR #319)

This directory preserves the original implementation plan and records its
current source reconciliation. The source inventory and capability matrix are
authoritative when an older planning statement conflicts with implemented
code.

## Current implementation baseline (2026-08-10)

See [`docs/reviews/operator-experience-current-state.md`](../../reviews/operator-experience-current-state.md)
and [`docs/reviews/operator-experience-final-gap-audit.md`](../../reviews/operator-experience-final-gap-audit.md)
for the full, source-derived inventory. Summary:

- Source HEAD at this reconciliation: `b7b18d1` (merge of Operator
  Infrastructure Diagnostics, #319), following the merged authenticated
  mutating CLI (#317) and scheduling/backup CLI mutations (#318).
- Release: `1.0.0-rc.13`.
- Administrative route catalog: **48 descriptors**, verified against source
  by `tests/http/administrative-api-contract.test.ts` (not a static count —
  see that test before trusting any other number in this directory).
- CLI command tree: **36 of 36 command nodes implemented, 0 stubs** —
  `tests/cli/` asserts no declared-but-unimplemented command remains. ADR-032
  closed the last five (`infra status`, `infra listeners`, `nginx status`,
  `nginx test`, `tunnel status`).
- Completed capability tracks: security/contracts repair, full CLI command
  tree, dashboard shell/navigation (Operator Dashboard v2 Slice 2), service
  resource observability (Slice 3), registered-service scheduling —
  persistent policy store, candidate-draft preview, weekly editor overhaul,
  timeline current-state display (Slice 4), authenticated mutating CLI
  (`services start/stop/restart` over ADR-031), scheduling and backup CLI
  mutations (`services schedule set/always/manual/disable/remove`, `backups
run`, `backups run-status`, `backups schedule set/remove`, `backups
retention set/prune`), and infrastructure diagnostics (CLI `infra`/`nginx`/
  `tunnel` commands plus the dashboard Infrastructure page, ADR-032).
- Remaining implementation gaps: see the final gap audit for the
  authoritative, classified list. At a minimum: machine schedule mutation
  (blocked on a dedicated policy-store ADR — deliberately out of scope for
  this milestone), Compose resource aggregation semantics, active-override/
  expiry presentation on the schedule timeline, a separate multi-section
  service detail page, and Events pagination/tail UX.
- Remaining operational acceptance: Task Manager registration and any live
  Atlas scheduling acceptance require real Atlas host access this
  reconciliation does not have.

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
  `tests/http/administrative-api-contract.test.ts` (48 descriptors as of
  2026-08-10, after ADR-032's infrastructure diagnostics route; do not
  hardcode this number elsewhere).
- CLI/dashboard remain presentation adapters.
- Power browser tests cover disabled, loading, unauthorized, busy, malformed
  response, confirmation and accepted-occurrence flows.
- Physical power effects and the machine scheduler remain disabled.
