# Operator Experience — Settings contract audit

Date: 2026-08-10.
Source HEAD: `d0cb71f` (#321, "fix: close remaining Operator Experience
source gaps"), the tip of `origin/main` at the start of this tranche.

This audit is derived from reading actual source (routes, RBAC catalog,
domain code, dashboard) for what the Settings page currently shows/claims
and what backend contracts genuinely exist behind every candidate setting —
not from re-stating plan documents. It follows the format of
`docs/reviews/operator-experience-final-gap-audit.md`.

## What the Settings page currently claimed

Before this tranche, `src/dashboard/navigation.ts` rendered Settings as a
static placeholder ("Settings remain server-owned and protected by the
administrative API.") with no data, no form and no backing read. Nothing in
`src/dashboard/main.ts` referenced a `/admin/settings`-shaped route because
no such route exists anywhere in `src/http/`. The placeholder made no false
claim about specific settings (it named none), so there was nothing to
retract — only a gap to fill or an honest decision to leave it a status
page.

## Method

Every mutation and configuration-shaped read in
`src/http/administrative-route-security-catalog.ts` (the single source of
truth for every `/admin/*` route, per its own comment: "The only production
boundary allowed to register an `/admin` route") was walked and classified.
Candidates already fully covered by another dashboard page were checked
against that page's current dashboard code, not assumed.

## Classification

### 1. Event-history retention policy — `SUPPORTED_MUTATION` (implemented)

- Route: `GET`/`PUT /admin/event-history/retention`
  (`src/http/administrative-route-security-catalog.ts:495-510`, route ids
  `event_history.retention.read` / `event_history.retention.update`).
- Typed contract: `EventHistoryRetentionPolicy`
  (`src/event-history/domain/event-history-record.ts:56-69`) —
  `automaticPruneEnabled: boolean`, `segments: {minSealedSegments,
  maxSealedSegments, maxSealedSegmentAgeDays}`, `exports: {minExports,
  maxExports, maxExportAgeDays}`. Parsed by `createRetentionPolicy`
  (`event-history-record.ts:248-295`), which enforces bounded integers per
  field and `max >= min` invariants and rejects unknown/missing keys via
  `assertExactKeys`.
- RBAC: `permissionForAdministrativeOperation` maps
  `update_event_history_retention` to permission scope
  `event_history.retention.write` and `read_event_history_retention` to
  `event_history.retention.read`
  (`src/access-control/domain/administrative-operation.ts:212-213`) — both
  pre-existing catalog entries, no new permission scope added.
- Validation: server-side, in `createRetentionPolicy` (see above); the route
  handler (`src/http/administrative-event-history-operations-route.ts:196-223`)
  parses the body with `exactPolicy()`, which requires exactly the two keys
  `confirmation` and `policy`.
- Confirmation: `confirm_administrative_event_history_retention_update`,
  checked by `exactPolicy()` and declared in the catalog
  (`administrative-route-security-catalog.ts:508`) — the pre-existing
  confirmation-token pattern, not a new one.
- Audit: `runEventHistoryMutation("update_administrative_event_history_retention", …)`
  in `src/access-control/composition/create-protected-administration.ts:726-786`
  wraps the call in `operationAudit.begin`/`complete`, the same
  begin/succeeded/failed audit shape used by every other administrative
  mutation (e.g. `runBackupSchedulerTick` immediately above it).
- Gate: `event_history_maintenance` gate policy
  (`administrative-route-security-catalog.ts:509`), enforced via
  `dependencies.mutationGate.tryAdmit()` in the route
  (`administrative-event-history-operations-route.ts:326-337`), returning
  409 `event_history_retention_busy` under contention — the same
  busy-rejection shape used by backup and event-history maintenance routes.
- Reread: implemented in this tranche — `src/dashboard/main.ts`'s
  `loadSettings()` re-fetches `GET /admin/event-history/retention` after a
  successful `PUT`, via the shared `refresh()` coordinator (the same pattern
  `renderServices`'s start/stop/restart forms and the backup policy forms
  use: `await refresh()` inside the fetch `.then()`, never trusting the
  submitted values as authoritative).

Everything the mutation needs was already present in `src/http/` and
`src/access-control/` before this tranche; the only gap was presentational —
the PUT route had no dashboard form and the GET route's payload was dumped
as raw, unstructured JSON on the Events page
(`src/dashboard/main.ts`, `loadEvents()`/`renderAudit()`, pre-existing) with
no way to act on it. **Disposition: implemented as the Settings page's
primary content**, in `src/dashboard/settings-view.ts` (new file) wired
into `src/dashboard/main.ts`'s `loadSettings()`/`createSection("Settings", …)`.
This is a genuinely global, system-wide configuration knob (how long the
audit trail retains data), which is what distinguishes it from the
per-resource operational settings below — it doesn't belong to any single
service or backup target, so it doesn't belong on those pages.

The existing raw JSON dump on the Events page is untouched — it still shows
`integrity`, `retention` (the read-only summary) and `exports` together as
Events-page diagnostic context, which is a different concern (operators
reading the state of the audit trail while on the Events page) from
Settings (operators changing the policy that governs it). No route or
response shape changed for the Events page.

### 2. Backup schedule / retention policy — already `SUPPORTED_MUTATION`, out of scope for Settings

- Routes: `PUT/DELETE /admin/backups/targets/:targetId/schedule`,
  `PUT /admin/backups/targets/:targetId/retention`
  (`administrative-route-security-catalog.ts:356-373, 425-458`).
- Already fully implemented with forms on the Backups page
  (`src/dashboard/main.ts`, `renderBackups()` → `appendBackupPolicyForm()`,
  lines 447-573), confirmation-gated, audited, RBAC-scoped. This audit found
  no gap here.
- **Disposition: not duplicated onto Settings.** It is per-backup-target
  configuration, not a global setting — it belongs next to the target it
  governs, which is exactly where it already lives (see final-gap-audit.md
  item 5, closed in the prior tranche).

### 3. Service schedule / availability policy — already `SUPPORTED_MUTATION`, out of scope for Settings

- Routes: `PUT/DELETE /admin/services/:serviceId/schedule`,
  `PUT/DELETE /admin/services/:serviceId/availability`
  (`administrative-route-security-catalog.ts:338-373`).
- Already implemented with a full editor on the Schedules page
  (`src/dashboard/weekly-schedule-editor.ts`, wired from
  `src/dashboard/main.ts`).
- **Disposition: not duplicated onto Settings**, same reasoning as backups —
  per-service configuration belongs on the Schedules page.

### 4. Machine schedule mutation — `OUT_OF_SCOPE_FOR_1_0` (unchanged)

- `src/cli/command-tree.ts` has only `machine schedule show` (read-only). No
  `src/http/` route mutates machine schedule.
- Reconfirmed unchanged from `operator-experience-final-gap-audit.md` item
  9: explicitly gated behind a dedicated ADR per
  `docs/milestones/advanced-manager-readiness/01-execution-roadmap.md` Phase
  F item 4. This is Phase 3 of the current multi-phase sequence ("Machine
  policy"), not this phase — **not touched**, per this task's explicit
  instruction to leave machine policy persistence alone.

### 5. Power routes (wake alarm, shutdown) — `NOT_ADMINISTRABLE` for a Settings page, and explicitly out of scope

- Routes: `PUT/DELETE /admin/power/wake-alarm`,
  `POST /admin/power/shutdown/preparations`,
  `POST /admin/power/shutdown/executions`
  (`administrative-route-security-catalog.ts:215-254`).
- These are already administrable, but they are one-shot operational
  commands (schedule/cancel a wake alarm, prepare/execute a shutdown), not
  persisted configuration — they don't fit "Settings" semantically even
  where they're not already surfaced by the Overview page's power controls
  (`src/dashboard/power-controls.ts`).
- **Disposition: not touched.** This task explicitly forbids touching power
  code in this phase; grepped and confirmed no wake-alarm/shutdown file was
  modified (see qualification section of the final report).

### 6. Event-history rotation / prune / export operations — `NOT_ADMINISTRABLE` for Settings (operational actions, not configuration)

- Routes: `POST /admin/event-history/rotations`,
  `POST /admin/event-history/retention/prunes`,
  `POST/GET /admin/event-history/exports`, etc.
  (`administrative-route-security-catalog.ts:485-562`).
- These are one-shot maintenance actions on the event history, already
  surfaced (read-only) on the Events page. They are not "settings" — they
  don't persist a policy, they perform an action once. Adding buttons for
  them belongs to Events-page scope (in the spirit of final-gap-audit.md's
  per-page ownership principle), not Settings.
- **Disposition: left alone.** Out of scope for this phase; no route or
  dashboard change made for these.

### 7. Administrative activation flags (env vars) — `NOT_ADMINISTRABLE`

- `ADMINISTRATIVE_ACTIVATION_FLAGS` in
  `administrative-route-security-catalog.ts:46-65` — e.g.
  `ADMINISTRATIVE_DASHBOARD_ENABLED`, `ADMINISTRATIVE_BACKUP_HTTP_ENABLED`.
- These are `.env`-sourced process configuration, already surfaced
  read-only on the Infrastructure page
  (`src/dashboard/main.ts`, `renderInfrastructure()`, "Administrative
  feature flags" list, lines 191-203, reading
  `record.activationFlags` from the security-status response).
- **Disposition: `NOT_ADMINISTRABLE`, explicitly excluded per this task's
  own instructions** ("Do NOT turn arbitrary environment variables into
  'Settings' — that's explicitly forbidden by this task"). No route exists
  to mutate them, and none was added. They remain read-only, on
  Infrastructure, exactly as before.

### 8. Security posture / infrastructure diagnostics — `SUPPORTED_READ_ONLY`, already exposed, out of scope for Settings

- Routes: `GET /admin/security/status`,
  `GET /admin/infrastructure/diagnostics`
  (`administrative-route-security-catalog.ts:563-576`).
- Already rendered on the Infrastructure page
  (`src/dashboard/main.ts`, `loadInfrastructure()`/`renderInfrastructure()`).
- **Disposition: not duplicated onto Settings** — these are status/posture
  reads, not settings an operator changes, and they already have a home.

## Outcome

One genuine, backend-complete `SUPPORTED_MUTATION` candidate was found
(event-history retention policy) that had no dashboard exposure of its
mutation path anywhere. It was judged sufficient to justify keeping Settings
as a real, mutation-capable page rather than downgrading it to a pure status
view: it is a real, RBAC-protected, audited, confirmed, validated mutation
with no reasonable home on any other existing page (unlike backup/service
schedule policy, which are correctly scoped to their own pages). No other
candidate qualified as `SUPPORTED_MUTATION` without either (a) already
living on another page, (b) being an operational one-shot action rather than
persisted configuration, or (c) requiring new backend surface explicitly out
of scope for this phase (machine schedule mutation, power routes).

No security boundary was expanded: no new permission scope, no new
authentication mechanism, no new confirmation-token shape, no new audit
event shape. The one implemented item reuses
`event_history.retention.write` (pre-existing), the pre-existing
`confirm_administrative_event_history_retention_update` confirmation, and
the pre-existing `runEventHistoryMutation` audit wrapper, all unchanged.

## Summary table

| # | Candidate | Classification | Disposition |
| --- | --- | --- | --- |
| 1 | Event-history retention policy | `SUPPORTED_MUTATION` | **Implemented** — new Settings page content |
| 2 | Backup schedule/retention | `SUPPORTED_MUTATION` | Already implemented on Backups page; not duplicated |
| 3 | Service schedule/availability | `SUPPORTED_MUTATION` | Already implemented on Schedules page; not duplicated |
| 4 | Machine schedule mutation | `OUT_OF_SCOPE_FOR_1_0` | Unchanged; gated behind future ADR, future phase |
| 5 | Power (wake alarm, shutdown) | `NOT_ADMINISTRABLE` for Settings | Unchanged; explicitly out of scope for this phase |
| 6 | Event-history rotation/prune/export actions | `NOT_ADMINISTRABLE` for Settings | Unchanged; one-shot actions, Events-page scope |
| 7 | Administrative activation flags (env vars) | `NOT_ADMINISTRABLE` | Unchanged; stays read-only on Infrastructure |
| 8 | Security posture / infrastructure diagnostics | `SUPPORTED_READ_ONLY` | Already implemented on Infrastructure page; not duplicated |
