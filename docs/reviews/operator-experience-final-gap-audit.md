# Operator Experience — final gap audit

Date: 2026-08-10 (original audit), updated 2026-08-10 with Phase 0-1
dispositions.
Source HEAD: `b7b18d1` (merge of #319, Operator Infrastructure Diagnostics),
following #317 (authenticated mutating CLI) and #318 (scheduling/backup CLI
mutations). This audit's classifications (items 1-11, `DONE` through
`BLOCKED_EXTERNAL`) predate #320 and this Phase 0-1 tranche; see the "Phase
0-1 disposition" note on each affected item and the summary table's second
column for what changed after `bc83380` (#320's merge commit).

This audit is derived from reading actual source (routes, domain code, CLI
command tree, dashboard views), not from re-stating older plan documents.
Each item below cites the file(s) that back the classification. Classes:
`DONE`, `REAL_GAP`, `DEFERRED_BY_DESIGN`, `BLOCKED_EXTERNAL`,
`OUT_OF_SCOPE_FOR_1_0`.

## 1. Service next-transition presentation (overview/detail) — DONE

`src/dashboard/schedule-view.ts` renders `firstRequiredAt` from the schedule
preview response ("First required at: ..."). Backed by
`services.schedule.preview` (`src/http/administrative-service-schedule-route.ts`)
and `services.availability.preview`
(`src/http/administrative-service-availability-route.ts`). This is a single
next-transition value, not a rolling list — see item 3.

## 2. Active schedule override + expiry presentation — CLOSED (Phase 0-1)

**Phase 0-1 disposition: DONE.** `GetRegisteredServiceEffectiveAvailability`
gained an additive `executeWithOverride()` method (`execute()` is unchanged,
still string-returning, so its existing caller in
`orchestrate-registered-service-control.ts` was not touched) that also
returns the active, non-expired `ServiceAvailabilityOverride | null`. The
`services.availability.read` handler in `create-protected-administration.ts`
now calls it and `mapAdministrativeAvailability`
(`src/http/administrative-service-response.ts`) maps an `override:
{kind, expiresAt} | null` field into the response. `src/dashboard/schedule-view.ts`
renders it as "Active override: \<kind\> · Expires at: \<expiresAt\>" next to
the current-state line. Tests:
`tests/service-management/application/get-registered-service-effective-availability.test.ts`,
`tests/http/administrative-control-plane-route.test.ts`,
`tests/dashboard/schedule-view.test.ts`.

Prior text (pre-Phase-0-1), for record: no route returned the override object
distinctly — it was folded into a single expectation string, not surfaced as
its own field, and no dashboard file referenced override/expiry.

## 3. Following transitions (beyond just "next") — CLOSED (Phase 0-1)

**Phase 0-1 disposition: DONE.** `evaluateRegisteredServiceAvailabilityForInterval`
(`src/service-management/domain/registered-service-availability-interval.ts`)
now also calls `calculateServiceAvailabilityPolicyTransitions` and attaches a
bounded (5) `transitions` array to `RegisteredServiceAvailabilityInterval`
whenever the policy is `scheduled` (any calculator rejection, e.g. from
sub-minute alignment after rounding, degrades to an empty list rather than
failing the read — the field is supplementary, `outcome`/`firstRequiredAt`
stay authoritative). Both the persisted-policy preview
(`GetRegisteredServiceAvailabilityForInterval`) and the candidate-policy
preview (`PreviewRegisteredServiceAvailabilityPolicy`) share this domain
function, so both preview routes now carry `transitions` with no separate
route change. `src/dashboard/schedule-view.ts` renders it as a list under
"First required at". Tests:
`tests/service-management/application/preview-registered-service-availability-policy.test.ts`,
`tests/service-management/application/get-registered-service-availability-for-interval.test.ts`,
`tests/dashboard/schedule-view.test.ts`.

Prior text (pre-Phase-0-1), for record: no route, CLI command or dashboard
view surfaced more than the single `firstRequiredAt` value.

## 4. Scheduler health/cursor visibility — REAL_GAP

**Phase 0-1 disposition: explicitly deferred, stays `REAL_GAP`.** Closing
this needs a new route, a new `CHECK_ID`, a new config field in
`create-administrative-runtime.ts`, and a fix to `readLastTick()` (it does
not currently recognize the cursor's `completedThrough` key) — judged not
"genuinely small" and excluded from this tranche by explicit size decision.
It remains the leading candidate for the next tranche.

`src/service-management/domain/service-availability-reconciliation-scheduler-cursor.ts`
and its store implementations
(`file-service-availability-reconciliation-scheduler-cursor-store.ts`,
`in-memory-service-availability-reconciliation-scheduler-cursor-store.ts`)
are wired only through `create-service-management.ts` and
`run-service-availability-reconciliation-scheduler-cycle.ts`. No `src/http/`
route and no `src/dashboard/`/`src/cli/` view reads the cursor. Earlier
planning documents label this "deferred," but no ADR gates it — it is an
unimplemented observability surface, not a design decision, so it is
classified `REAL_GAP` rather than `DEFERRED_BY_DESIGN`.

**Phase 4 disposition: CLOSED.** Re-verified against source at `e665bfe`
(Phase 3's merge commit): `schedulerBackup`/`schedulerPower` `CHECK_ID`s and
their `schedulerCheck()` wiring already existed (added between this audit's
original writing and Phase 3, evidently as part of ADR-032's diagnostics
work), but no check read the _service availability reconciliation_
scheduler's cursor — only the backup and machine-power schedulers were wired.
Added `CHECK_ID.schedulerServiceAvailability` (`scheduler.service_availability`),
appended to `CHECK_ORDER`, and wired a
`serviceAvailabilityReconciliationSchedulerCursorReader` source through
`build-infrastructure-diagnostic-report.ts` →
`create-infrastructure-diagnostics-runtime.ts` →
`create-administrative-runtime.ts`, backed by the existing
`FileServiceAvailabilityReconciliationSchedulerCursorStore` and the
already-present (Phase 3) `config.serviceAvailabilityReconciliationSchedulerCursorFilePath`
field, which diagnostics never read before this change.

While implementing this, found and fixed a genuine pre-existing bug:
`readLastTick()` only recognized `lastTickAt`/`observedAt`/`occurredAt`/
`value` keys, but the machine-power scheduler cursor store
(`FileMachinePowerSchedulerCursorStore`) — already wired into
`schedulerPower` before this phase — persists its cursor under a
`completedThrough` key, identical in shape to the service-availability
reconciliation cursor. This meant `scheduler.power` was already silently
reporting "no tick recorded yet" in production even when the cursor had
advanced. Added `completedThrough` to `readLastTick()`'s recognized key set,
fixing both the pre-existing `scheduler.power` check and the new
`scheduler.service_availability` check. No route, RBAC, or CLI/dashboard
presentation change was needed — the existing `infra status`/`doctor`
surfaces and the Infrastructure dashboard page render whatever checks the
report returns generically, with no per-check-id hardcoding on the
presentation side. Tests:
`tests/infrastructure-diagnostics/application/build-infrastructure-diagnostic-report.test.ts`.

## 5. Backups dashboard UX — CLOSED (Phase 0-1, run-now only)

**Phase 0-1 disposition: DONE for manual "run now"; run-status polling stays
out of this tranche.** `POST /admin/backups/targets/:targetId/runs` already
existed, RBAC-protected and confirmation-gated
(`src/http/administrative-route-security-catalog.ts`, confirmation
`confirm_registered_backup_run`), and the CLI already exposed it. The gap was
purely presentational: `renderBackups()` in `src/dashboard/main.ts` now calls
`appendBackupActionForm(article, "Run now", target.id, "/runs",
"confirm_registered_backup_run")`, reusing the exact confirmation-form
pattern already in place for "Prune retention." No route change. Run-status
polling (a distinct, larger UX addition) was not attempted here.

Prior text (pre-Phase-0-1), for record: the dashboard had target list,
schedule form, retention form, retention-prune button and a runs feed, but no
manual "run now" control and no run-status polling.

## 6. Events pagination/tail/audit visibility — CLOSED (Phase 0-1, dashboard pagination only)

**Phase 0-1 disposition: DONE for dashboard "load more" pagination.** The
backend already returned `hasMore`/`nextAfterSequence`
(`src/http/administrative-event-history-response.ts`); the dashboard fetched
one fixed page with no cursor UI. `src/dashboard/main.ts` now tracks the
accumulated event list and pagination cursor client-side and renders a "Load
more" button that re-reads `/admin/event-history` with `afterSequence` and
appends rather than replaces. No route or schema change. The CLI `events
--tail` gap (still a single larger page, no `afterSequence` wiring) was not
attempted here — it is CLI-surface work, not dashboard presentation, and
stays open.

Prior text (pre-Phase-0-1), for record: the dashboard fetched a single fixed
page with no cursor UI, and the CLI `events` command had no visible
pagination/tail flag wiring beyond `--tail` doubling the page size to 100.

**Phase 4 disposition: CLOSED for the CLI's remaining half.** Re-verified
`src/cli/http-transport.ts`: the `events` case only ever built
`?limit=${limit}`, so no CLI invocation could ever advance past the first
page even though the route (`administrative-event-history-query-parser.ts`)
already accepted `afterSequence` and the dashboard already used it. Added a
`readEventHistoryQueryOptions()` parser recognizing `--after <sequence>`
(a non-negative integer, validated the same way the server-side parser
validates it) alongside the pre-existing `--tail`; both compose (`--tail
--after N` widens the page and advances the cursor together). No route,
RBAC or schema change — purely a CLI argument-to-querystring mapping over an
already-existing, already-accepting parameter. A live tail/follow mode is a
distinct, larger feature and was not attempted. Tests:
`tests/cli/http-transport.test.ts`.

## 7. Compose resource aggregation — DEFERRED_BY_DESIGN

`src/service-management/infrastructure/compose-service-resource-reader.ts`
returns `"unsupported"` with an explicit code comment: per-member container
aggregation needs its own design (a Compose project has an arbitrary number
of member containers, each with its own CPU-percentage denominator), and a
naive sum would misrepresent it. This is documented as a deliberate
placeholder, cross-referenced from
`docs/plans/operator-dashboard-v2/03-resource-observability.md` and
`docs/capabilities.md`'s "Known deferred items." Classified
`DEFERRED_BY_DESIGN` (not `REAL_GAP`) because the rationale is recorded in
source and plan documents even though no formal ADR exists for it — the
scope (a new aggregation formula) is explicitly out of this milestone's
small-fixes bar per the task's own exclusions.

## 8. Separate service detail page — REAL_GAP (deliberately not built)

`src/dashboard/navigation.ts` defines 8 top-level pages (Overview, Services,
Schedules, Machine, Backups, Events, Infrastructure, Settings); there is no
per-service detail route. This was explicitly reassessed after Slices 3-4 and
rejected as not yet justified (the service card plus the Schedules section
already surface every field with real backing data — a second page would
either duplicate that or show empty fields), recorded in
`docs/capabilities.md`'s "Known deferred items." No formal ADR backs the
decision, so classified `REAL_GAP` with recorded rationale rather than a
clean `DEFERRED_BY_DESIGN`.

## 9. Machine schedule mutation (persistence) — OUT_OF_SCOPE_FOR_1_0

`src/cli/command-tree.ts` has only `machine schedule show` (read-only). No
`src/http/` route mutates machine schedule (grep for machine routes returns
only power/shutdown/wake-alarm routes). This is explicitly gated behind "a
dedicated ADR" per `01-execution-roadmap.md` Phase F item 4 and
`10-phase-traceability.md`'s unresolved-decisions table ("Machine policy
persistence and precedence — machine schedule mutation — dedicated ADR").
The task instructions for this milestone explicitly excluded implementing
this without an ADR, so it stays out of scope for 1.0.

## 10. Task Manager registration — BLOCKED_EXTERNAL

`docs/plans/operator-dashboard-v2/01-reliability-and-registration.md`
describes registering the real Task Manager PM2 process, which needs the
actual running Task Manager process on a real host. No SSH/host session is
available in this environment, matching prior reconciliation notes
(`docs/reviews/operator-experience-slice4-gap-analysis.md`). Nothing in
source claims this is done.

## 11. Atlas live acceptance (real host, not mocks) — BLOCKED_EXTERNAL

`.env.example` defaults `POWER_MANAGEMENT_BACKEND=mock` and registered
services use `"managementAdapter":"mock"`. No `tests/**live**` or
`tests/**acceptance**` directory exists against a real Atlas host. This
milestone (like prior ones) has no SSH/host access, so live acceptance
remains blocked on operational availability of the real Atlas host, not on
source work.

## Phase 3 note (superseded by Phase 0-1 — see below)

At the time this milestone (#320) closed, no candidate gap was judged both
(a) genuinely small, and (b) pure presentation over data already returned by
an existing route, so items 2, 3, 5 and 6 were all left as `REAL_GAP` with
zero code fixes. The Phase 0-1 tranche that followed re-examined that
judgment file-by-file and found four of the five were in fact additive or
narrowly contained over already-existing backend/domain — see the "Phase 0-1
disposition" notes on items 2, 3, 5 and 6 above. Item 4 (scheduler cursor)
was re-confirmed as genuinely not small and stays deferred.

## Phase 0-1 disposition summary

Re-verified against source after #320 (this tranche started from
`origin/main` at `bc83380`, "docs: close out Operator Experience source
milestone (#320)"). Four items closed with code changes, one item explicitly
re-deferred by size:

- Item 2 (active override + expiry) — **closed**, additive method +
  response-shape extension.
- Item 3 (following transitions) — **closed**, additive domain field, shared
  by both preview routes.
- Item 5 (backups dashboard "run now") — **closed**, reused an existing
  route and an existing dashboard confirmation-form pattern.
- Item 6 (events pagination) — **closed** for the dashboard; the CLI
  `events --tail` half of the original gap description stays open (CLI-only,
  not attempted in this tranche).
- Item 4 (scheduler cursor visibility) — **stays `REAL_GAP`**, explicitly
  out of this tranche: needs a new route, a new `CHECK_ID`, a new
  `create-administrative-runtime.ts` config field, and a `readLastTick()`
  fix — not a small, presentation-only change. Natural candidate for the
  next tranche.

No security boundary, RBAC rule, audit behavior or mutation gate was touched
by any of the four closed items — each extends the response shape of an
already-existing read route, or reuses an already-existing mutation route's
confirmation contract unchanged.

## Summary table

| #   | Item                                  | Classification (post-#320) | Phase 0-1 disposition                              |
| --- | ------------------------------------- | -------------------------- | -------------------------------------------------- |
| 1   | Next-transition presentation          | DONE                       | unchanged                                          |
| 2   | Active override + expiry presentation | REAL_GAP                   | **CLOSED**                                         |
| 3   | Following transitions (list)          | REAL_GAP                   | **CLOSED**                                         |
| 4   | Scheduler health/cursor visibility    | REAL_GAP                   | stays REAL_GAP (deferred by size)                  |
| 5   | Backups dashboard UX (manual run)     | REAL_GAP                   | **CLOSED** (run-now only; run-status still open)   |
| 6   | Events pagination/tail                | REAL_GAP                   | **CLOSED** for dashboard (CLI `--tail` still open) |
| 7   | Compose resource aggregation          | DEFERRED_BY_DESIGN         | unchanged, out of scope                            |
| 8   | Separate service detail page          | REAL_GAP                   | unchanged, out of scope (decision recorded)        |
| 9   | Machine schedule mutation             | OUT_OF_SCOPE_FOR_1_0       | unchanged, out of scope                            |
| 10  | Task Manager registration             | BLOCKED_EXTERNAL           | unchanged, blocked                                 |
| 11  | Atlas live acceptance                 | BLOCKED_EXTERNAL           | unchanged, blocked                                 |
