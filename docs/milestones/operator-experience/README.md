# Atlas Operator Experience — plan and implementation context

Status: implementation reconciled through the mock power-control slice

Inventory snapshot: 2026-08-09

Implementation baseline: `ebd998d` plus the reviewed commits on the current
branch

Branch: `agent/fix-administrative-profile-contract`

This directory preserves the original implementation plan and records its
current source reconciliation. The source inventory and capability matrix are
authoritative when an older planning statement conflicts with implemented
code.

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
- The catalog and published contract both contain 45 route descriptors.
- CLI/dashboard remain presentation adapters.
- Power browser tests cover disabled, loading, unauthorized, busy, malformed
  response, confirmation and accepted-occurrence flows.
- Physical power effects and the machine scheduler remain disabled.
