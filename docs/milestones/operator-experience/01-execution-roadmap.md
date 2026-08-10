# Execution roadmap

## Delivery model

Use vertical slices with one architectural purpose per commit. Every slice must
leave directly related tests green and update `docs/capabilities.md`.

## Phase A — security and contracts

1. Restore authenticated reads and prove Cloudflare assertion propagation. —
   done.
2. Accept ADR-027. — done 2026-08-10, on the strength of
   `docs/reviews/adr-027-implementation-conformance.md`.
3. Write and accept a local/remote CLI identity ADR. — done: ADR-028 fixes the
   identity and privilege constraints, ADR-031 chooses the concrete
   authenticated mutation transport.
4. Define shared command result, error and pagination contracts.
5. Inventory proposed route additions and establish the new explicit route
   count before implementation.

Exit gate: no authentication bypass, existing security regressions green.

## Phase B — CLI foundation and read-only operations

1. Add the packaged `atlas` executable, parser, help and output abstraction.
2. Add `status`, `health` and `doctor` using read-only application ports.
3. Add `infra status`, `infra listeners`, `nginx status/test` and `tunnel
status` only where adapters can report partial failures safely. — done
   2026-08-10 under ADR-032 (Operator Infrastructure Diagnostics, PR #319),
   which also extended `status`/`doctor` and added the dashboard
   Infrastructure diagnostics section.
4. Add JSON schemas and stable exit/error codes.

Exit gate: no mutating CLI command and no direct shell-output parsing inside
command handlers.

## Phase C — service operations

1. Expose missing service logs transport through a protected capability.
2. Add CLI list/status/logs.
3. Add authenticated start/stop/restart after the CLI auth ADR is implemented. —
   done 2026-08-10 over the ADR-031 transport, with zero new administrative
   routes.
4. Build dashboard navigation and Services page using the same API DTOs.

Exit gate: PM2, Docker and Compose remain hidden behind registered-service
ports; all mutations are audited and gated. **Met** — additionally guarded by
`tests/cli/no-direct-host-mutation.test.ts`, which forbids process execution
anywhere in `src/cli`, and by
`tests/http/authenticated-cli-mutation-integration.test.ts`, which proves a CLI
mutation is audited with the same principal as a dashboard mutation.

## Phase D — service scheduling

1. Add a persistent registered-service policy store and policy mutation use
   cases distinct from temporary availability overrides.
2. Add schedule show/update/remove and preview APIs. — done.
3. Add CLI schedule commands. — done. `schedule show` and both previews
   (persisted and candidate) shipped earlier; the mutation commands
   (`set`/`always`/`manual`/`disable`/`remove`) now reuse the ADR-031 transport
   unchanged, with no new administrative route. `remove` deletes the stored
   override and falls back to the configured default policy — it is not the
   same operation as writing mode `disabled`.
4. Add reusable weekly editor and timeline components.
5. Add next-transition data to service detail and overview.

Exit gate: one domain parser/evaluator is used by configuration, API, CLI and
dashboard; reconciliation regression suites remain unchanged and green.

## Phase E — backups and events

1. Add CLI read/mutation commands mapped to existing capabilities. — CLI side
   done: `backups run`, `backups run-status`, `backups schedule show/set/remove`
   and `backups retention show/set/prune`, all on existing routes.
   `backups scheduler tick` stays unexposed by design (claim-protected,
   cron-triggered maintenance).
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

## Operator Experience closeout (2026-08-10)

This section is the authoritative "what's left" statement for the Operator
Experience milestone series as of source HEAD `b7b18d1` (post-#319). It
supersedes the phase-by-phase status above where the two disagree. Full
detail and file-level evidence: `docs/reviews/operator-experience-final-gap-audit.md`.

**Source complete** (delivered, tested, in `main`):

- Administrative route catalog (48 descriptors, contract-tested).
- CLI: 36/36 command nodes implemented, 0 stubs.
- Authenticated mutating CLI over ADR-031 (`services
  start/stop/restart`).
- Scheduling and backup CLI mutations (`services schedule
  set/always/manual/disable/remove`, `backups run/run-status/schedule
  set|remove/retention set|prune`).
- Infrastructure diagnostics: CLI (`infra`, `nginx`, `tunnel`, extended
  `status`/`doctor`) and dashboard Infrastructure page (ADR-032).
- Dashboard shell/navigation, service resource observability, persisted
  service scheduling with candidate-draft preview and weekly editor.
- Next-transition presentation for service schedules (single next value).

**Deferred** (consciously, by design — see gap audit items 7-9):

- Compose per-member resource aggregation semantics (needs its own
  aggregation design).
- Separate multi-section service detail page (reassessed, not currently
  justified by real backing data).
- Machine schedule mutation/persistence (explicitly gated behind a
  dedicated ADR; physical power management stays out of scope for 1.0
  entirely, not just this release).

**Real gaps** (not by design, just not built — see gap audit items 2-6):

- Active schedule override + expiry presentation.
- Following-transitions list (beyond the single next value).
- Scheduler health/cursor visibility.
- Dashboard manual backup "run now" control (CLI-only today).
- Events pagination/tail UX in the dashboard.

None of these were implemented in this closeout milestone: each requires
extending a route response contract or adding UX comparable in size to an
existing mutation flow, which is outside this milestone's small-fixes bar.

**Operational** (depend on real Atlas host availability, not on source):

- Task Manager registration on the real host.
- Live Atlas scheduling/power acceptance (source is mock-backed only;
  `POWER_MANAGEMENT_BACKEND=mock` and effects stay disabled).
- Read-only Atlas host qualification (ADR-018).

**Release** (required to promote the next RC):

- Full source qualification (format/lint/typecheck/tests/build/audit/Go
  qualification) — see `docs/reviews/operator-experience-final-gap-audit.md`
  and this reconciliation's Phase 5 qualification run for current status.
- Independent Candidate A/B build reproducibility.
- Formalizing the next release-candidate identity (version stays
  `1.0.0-rc.13` until that is explicitly done).

### Expected sequence going forward

"source closeout" → "next RC formalization" → "full qualification" →
"Candidate A/B reproducibility" → "read-only Atlas host qualification" →
"Task Manager registration/verification" → "deployment" → "operator
acceptance".

This reconciliation completes "source closeout" (documentation reconciled,
gaps classified, qualification run — see Phase 5). It does **not** perform
RC formalization (no version bump), Candidate A/B builds, or anything
requiring the real Atlas host — those remain the next steps in the sequence,
in the stated order. Physical power management is not part of this release
closeout scope; it stays out of scope for 1.0 entirely.
