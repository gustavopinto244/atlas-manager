# Execution roadmap

## Delivery model

Use vertical slices with one architectural purpose per commit. Every slice must
leave directly related tests green and update `docs/capabilities.md`.

## Phase A — security and contracts

1. Restore authenticated reads and prove Cloudflare assertion propagation.
2. Accept ADR-027.
3. Write and accept a local/remote CLI identity ADR.
4. Define shared command result, error and pagination contracts.
5. Inventory proposed route additions and establish the new explicit route
   count before implementation.

Exit gate: no authentication bypass, existing security regressions green.

## Phase B — CLI foundation and read-only operations

1. Add the packaged `atlas` executable, parser, help and output abstraction.
2. Add `status`, `health` and `doctor` using read-only application ports.
3. Add `infra status`, `infra listeners`, `nginx status/test` and `tunnel
status` only where adapters can report partial failures safely.
4. Add JSON schemas and stable exit/error codes.

Exit gate: no mutating CLI command and no direct shell-output parsing inside
command handlers.

## Phase C — service operations

1. Expose missing service logs transport through a protected capability.
2. Add CLI list/status/logs.
3. Add authenticated start/stop/restart after the CLI auth ADR is implemented.
4. Build dashboard navigation and Services page using the same API DTOs.

Exit gate: PM2, Docker and Compose remain hidden behind registered-service
ports; all mutations are audited and gated.

## Phase D — service scheduling

1. Add a persistent registered-service policy store and policy mutation use
   cases distinct from temporary availability overrides.
2. Add schedule show/update/remove and preview APIs.
3. Add CLI schedule commands.
4. Add reusable weekly editor and timeline components.
5. Add next-transition data to service detail and overview.

Exit gate: one domain parser/evaluator is used by configuration, API, CLI and
dashboard; reconciliation regression suites remain unchanged and green.

## Phase E — backups and events

1. Add CLI read/mutation commands mapped to existing capabilities.
2. Replace raw dashboard backup forms with typed controls.
3. Add Events page, tail/pagination UX and audit visibility.
4. Ensure every newly introduced mutation emits administrative history.

## Phase F — machine plan

1. Add read-only machine plan, readiness and scheduler-state APIs.
2. Add CLI `machine status`, `machine plan`, `machine schedule show`.
3. Add dashboard Machine page, timeline and dry-run preview.
4. Add logical schedule persistence/editing only after a dedicated mutation
   contract is accepted.

Exit gate: mock transport only; physical effects remain gated and disabled in
qualification/deployment rehearsals.

## Phase G — documentation and acceptance

1. Complete CLI reference, dashboard guide, scheduling guide and runbook v3.
2. Expand README with architecture and operator flows.
3. Run full Node and both Go module qualifications.
4. Build independent Candidate A/B and require byte equality.
5. Perform read-only Atlas qualification, controlled deployment and operator
   acceptance.

## Suggested commit sequence

1. `docs: inventory operator experience`
2. `fix: restore authenticated administrative reads`
3. `docs: define operator presentation boundaries`
4. `feat: add atlas cli foundation`
5. `feat: add operator status and doctor`
6. `feat: add service query commands`
7. `feat: add protected service mutations and logs`
8. `feat: add service schedule persistence and preview`
9. `feat: add scheduling cli`
10. `feat: add dashboard navigation and service pages`
11. `feat: add weekly schedule editor and timeline`
12. `feat: add backup and event operator experiences`
13. `feat: add machine plan visualization and simulation`
14. `docs: complete operator guides and runbook`
15. `test: complete operator experience regressions`

Commit names are provisional and must follow the actual diff.
