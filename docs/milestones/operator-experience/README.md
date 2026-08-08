# Atlas Operator Experience — planning index

Status: planning only

Inventory snapshot: 2026-08-08

Source HEAD: `79235a215f8416eee179c0beb905fa5f3a6c7f9c`

Branch: `fix/administrative-lifecycle-state-contract`

This directory is the implementation context for the Atlas Operator Experience
milestone. It deliberately contains no claim that a planned capability exists.
The source inventory is authoritative over assumptions in the original
milestone prompt.

## Scope of this planning pass

- Inventory the current source and contracts.
- Record divergences and architectural gates.
- Split implementation into reviewable capability tracks.
- Define expected tests, commits, release qualification and deployment gates.
- Do not modify application code, runtime configuration, bundles or Atlas.

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

## Mandatory sequencing

1. Reconcile the current authentication exception with the milestone security
   contract and prove Cloudflare Access assertion delivery end to end.
2. Accept ADR-027 and a separate local CLI authentication ADR before adding
   mutating CLI commands.
3. Introduce shared application/query contracts before CLI and dashboard UI
   work.
4. Deliver CLI and dashboard in vertical slices, updating the capability matrix
   with each slice.
5. Add service scheduling persistence and preview before building the weekly
   editor.
6. Add machine-plan read/preview APIs before any schedule mutation UI.
7. Run full qualification, independent Candidate A/B builds and read-only host
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

## Definition of ready for implementation

- The security divergence in the current HEAD has an accepted resolution.
- CLI implementation language and local/remote authentication boundaries are
  accepted in ADRs.
- Proposed API additions have route IDs, operations, permissions, audit,
  confirmation and gate policies.
- Schedule persistence ownership is decided for services and machine policy.
- Each vertical slice has a test plan and capability-matrix update.
