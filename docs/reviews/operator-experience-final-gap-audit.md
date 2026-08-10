# Operator Experience — final gap audit

Date: 2026-08-10
Source HEAD: `b7b18d1` (merge of #319, Operator Infrastructure Diagnostics),
following #317 (authenticated mutating CLI) and #318 (scheduling/backup CLI
mutations).

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

## 2. Active schedule override + expiry presentation — REAL_GAP

`src/service-scheduling/domain/service-availability-override.ts` defines an
override DTO with `kind`/`expiresAt`, and
`get-registered-service-effective-availability.ts` and
`get-registered-service-availability-for-interval.ts` consume it internally.
No route returns the override object distinctly — `services.availability.read`
(`administrative-service-availability-route.ts`) via
`mapAdministrativeAvailability` only returns `serviceId`, `policy`,
`effectiveAvailability`, `observedAt` — the override is folded into a single
expectation string, not surfaced as its own field. No dashboard file
(`src/dashboard/*.ts`) references override/expiry. Exposing it would require
extending the read-route response shape and the effective-availability port,
which is backend work, not pure presentation — this is why it was not
attempted in Phase 3 of this milestone (see Phase 3 note below).

## 3. Following transitions (beyond just "next") — REAL_GAP

`calculateServiceAvailabilityPolicyTransitions`
(`src/service-scheduling/domain/service-availability-policy-transition-calculator.ts`)
computes a full list of transitions in an interval, but its only production
consumer is
`src/service-management/application/generate-registered-service-availability-reconciliation-occurrences.ts`
— internal scheduler logic. No route, CLI command or dashboard view surfaces
more than the single `firstRequiredAt` value. Presentation of a rolling list
would be additive to an existing preview route response, but is not attempted
here (see Phase 3 note).

## 4. Scheduler health/cursor visibility — REAL_GAP

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

## 5. Backups dashboard UX — REAL_GAP (partial parity)

The dashboard has real backups UX: target list, per-target schedule form,
retention form, retention-prune button, and a runs feed
(`src/dashboard/main.ts`, `GET /admin/backups/runs?limit=20`). It has no
manual "run now" control and no run-status polling, while the CLI has both
(`backups run`, `backups run-status` in `src/cli/command-tree.ts`). Dashboard
backups UX is read/schedule/retention-only; manual run initiation is
CLI-only. Not attempted in Phase 3 — a dashboard "run now" button needs a
confirmation-dialog pattern matching the existing service-mutation UX, which
is more than a one-line change and was judged too large for this milestone's
small-fixes bar.

## 6. Events pagination/tail/audit visibility — REAL_GAP

The backend supports pagination (`afterSequence`/`limit` query parameters in
the event-history query parser used by
`src/http/administrative-event-history-route.ts`). The dashboard fetches a
single fixed page (`main.ts`: `GET /admin/event-history?limit=20`) with no
cursor UI to request the next page. The CLI `events` command exists
(`src/cli/command-tree.ts`) but is a single read with no visible
pagination/tail flag wiring in the command tree entry. There is no true
multi-page or tail UX end-to-end today.

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

## Phase 3 note

Given the above, no candidate gap was both (a) genuinely small, and (b) pure
presentation over data already returned by an existing route. Items 2, 3, 5
and 6 all require extending a route's response shape (or adding dashboard
pagination/confirmation UX comparable in size to existing mutation flows)
before a presentation change is possible — none of them are a one-file,
low-risk fix. See Phase 3 of this reconciliation for the resulting decision.

## Summary table

| # | Item | Classification |
| - | ---- | -------------- |
| 1 | Next-transition presentation | DONE |
| 2 | Active override + expiry presentation | REAL_GAP |
| 3 | Following transitions (list) | REAL_GAP |
| 4 | Scheduler health/cursor visibility | REAL_GAP |
| 5 | Backups dashboard UX (manual run) | REAL_GAP |
| 6 | Events pagination/tail | REAL_GAP |
| 7 | Compose resource aggregation | DEFERRED_BY_DESIGN |
| 8 | Separate service detail page | REAL_GAP |
| 9 | Machine schedule mutation | OUT_OF_SCOPE_FOR_1_0 |
| 10 | Task Manager registration | BLOCKED_EXTERNAL |
| 11 | Atlas live acceptance | BLOCKED_EXTERNAL |
