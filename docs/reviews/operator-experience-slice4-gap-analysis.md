# Operator Dashboard v2 Slice 4 — gap analysis

2026-08-10, reconciled against
`docs/plans/operator-dashboard-v2/04-scheduling-and-adapters.md` and
`docs/milestones/operator-experience/04-service-management-and-scheduling.md`
after both Slice 4 commits (`b08b426`, `7d635e9`) and this reconciliation
pass (`d1c88cc` and later).

For each requirement: `ALREADY_IMPLEMENTED` (existed before Slice 4),
`PARTIAL`, `MISSING` (now delivered by this pass — see evidence), `DEFERRED`
(explicit, justified), or `BLOCKED_EXTERNAL`.

## Weekly editor

| Requirement                                  | Status                                 | Evidence                                                                                                                                                                                                             |
| -------------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Always / Scheduled / Manual / Disabled modes | ALREADY_IMPLEMENTED                    | `src/dashboard/weekly-schedule-editor.ts` mode `<select>`, predates Slice 4                                                                                                                                          |
| IANA timezone                                | ALREADY_IMPLEMENTED                    | timezone `<input>`, validated by `createServiceScheduleTimezone` server-side                                                                                                                                         |
| 7 weekday rows                               | ALREADY_IMPLEMENTED                    | `EDITOR_WEEKDAYS`                                                                                                                                                                                                    |
| Explicit enable/disable per day              | DELIVERED (Slice 4)                    | Per-day `enabled` checkbox replaces the prior implicit "empty inputs = disabled" convention                                                                                                                          |
| Start/end time controls                      | ALREADY_IMPLEMENTED                    | `<input type="time">` per day                                                                                                                                                                                        |
| Copy day to selected days                    | DELIVERED (Slice 4)                    | `copyWindowToDays` (pure, tested) + per-row "Copy to selected" control                                                                                                                                               |
| Clear day                                    | DELIVERED (Slice 4)                    | `clearDayWindow` (pure, tested) + per-row button                                                                                                                                                                     |
| Clear week                                   | DELIVERED (Slice 4)                    | Single button resets the draft to no windows                                                                                                                                                                         |
| Multiple windows per day                     | DEFERRED                               | Domain supports it (`weekly-availability-schedule.ts`'s overlap check allows same-weekday entries); editor UI is still one-window-per-day. Extending to dynamic rows is a real, bounded follow-up, not a domain gap. |
| Inline validation                            | ALREADY_IMPLEMENTED                    | `validateWeeklyEditorWindows`                                                                                                                                                                                        |
| Backend validation                           | ALREADY_IMPLEMENTED                    | `createServiceAvailabilityPolicy` remains authoritative                                                                                                                                                              |
| Dirty state                                  | DELIVERED (Slice 4)                    | Any field change sets a flag surfaced in a status region                                                                                                                                                             |
| Navigation warning                           | DELIVERED (Slice 4)                    | `beforeunload` guard while dirty                                                                                                                                                                                     |
| Save                                         | ALREADY_IMPLEMENTED, refined (Slice 4) | Now one of three distinct actions instead of the only submit handler                                                                                                                                                 |
| Preview                                      | DELIVERED (Slice 4)                    | New candidate-policy preview endpoint + button; does not persist                                                                                                                                                     |
| Remove                                       | DELIVERED (Slice 4)                    | Wires up `DELETE /admin/services/:id/schedule`, which existed on the backend with no prior dashboard trigger                                                                                                         |

## Timeline

| Requirement                              | Status                                   | Evidence                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 24h weekly grid (online/offline windows) | ALREADY_IMPLEMENTED                      | `schedule-view.ts` table                                                                                                                                                                                                                                                                                             |
| Current local time                       | DELIVERED (Slice 4)                      | `Intl.DateTimeFormat` in the policy's own timezone — display formatting only, not a transition calculation                                                                                                                                                                                                           |
| Current effective state                  | DELIVERED (Slice 4)                      | `effectiveAvailability`, already computed server-side, now fetched on the success path (previously only as an error fallback)                                                                                                                                                                                        |
| Active override + expiry                 | MISSING                                  | No current read endpoint returns the override object (`kind`/`expiresAt`) on a success path the timeline consumes; `GetRegisteredServiceAvailability` returns policy + effective availability, not the override. This is a small, well-scoped backend read this reconciliation did not add — see "Next steps" below. |
| Next transition                          | ALREADY_IMPLEMENTED                      | `firstRequiredAt` in the persisted-policy preview                                                                                                                                                                                                                                                                    |
| Following transitions (plural)           | MISSING                                  | Both preview paths return only one `firstRequiredAt`, not a series. Computing several would mean walking the evaluator forward repeatedly (still reusing the same domain function, not duplicating it) — scoped but not built in this pass.                                                                          |
| Preview source                           | DELIVERED (Slice 4, this reconciliation) | `source: "candidate_preview"` added to the candidate-preview use case's result                                                                                                                                                                                                                                       |
| `evaluatedAt`                            | PARTIAL                                  | The interval response has `startsAt`/`endsAt`, not a distinct evaluation instant; the HTTP layer's audit envelope has one internally but it isn't surfaced in this response                                                                                                                                          |
| Scheduler cursor/health                  | DEFERRED                                 | No authoritative API exposes per-service scheduler cursor/health; the plan itself gates this on "when exposed"                                                                                                                                                                                                       |

## Mutation semantics

| Requirement                                               | Status              | Evidence                                                                                  |
| --------------------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------- |
| Authoritative reread after Save/Remove                    | ALREADY_IMPLEMENTED | `onSaved()` callback triggers `refresh()`                                                 |
| Audit (principal, service ID, normalized policy, outcome) | ALREADY_IMPLEMENTED | Existing administrative audit trail on the schedule mutation operations                   |
| Conflict handling (never shown as success)                | ALREADY_IMPLEMENTED | Fetch failures set an explicit failure message; success is only reported on `response.ok` |

## Adapters

| Requirement                                                            | Status                    | Evidence                                                                                                                                                                                                        |
| ---------------------------------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PM2 adapter uses registered-service domain                             | ALREADY_IMPLEMENTED       | `Pm2ServiceController`, no `Pm2Schedule` or adapter-specific scheduler exists                                                                                                                                   |
| Docker adapter uses registered-service domain                          | ALREADY_IMPLEMENTED       | `DockerServiceController`, same domain                                                                                                                                                                          |
| Compose adapter uses registered-service domain                         | ALREADY_IMPLEMENTED       | `ComposeServiceController`, same domain. (Compose _resource observation_ is `unsupported` by design — a Slice 3 item, unrelated to Compose _scheduling_, which was never blocked.)                              |
| Control-plane protection (Atlas/Nginx/cloudflared cannot be scheduled) | VERIFIED, not implemented | There is no HTTP route to register a new service at all; `managementAdapter` is a closed enum (`mock`/`pm2`/`docker`/`docker-compose`) with no `systemd` option. Nothing to add — the protection is structural. |

## Not attempted this pass, with reasons

- **CLI exposure for candidate-draft preview.** Read-only, not blocked by the
  CLI identity ADR, but a genuinely separate small feature (parser support
  for a `--policy` file/inline argument, output rendering, tests). Left as a
  named follow-up rather than folded into this already-large reconciliation
  pass.
- **Active override + expiry on the timeline; multiple following
  transitions.** Both require small, well-scoped backend additions (a new
  read for the former, repeated evaluator calls for the latter) that were
  deliberately not started in the same pass as the reconciliation work, to
  keep this pass's diff reviewable. Neither blocks anything else in Slice 4.
- **Service detail reassessment.** Re-evaluated per the plan's own
  instruction after Slices 3-4 landed real resource and scheduling data.
  Conclusion: still not justified as a separate page. The service card
  (status chip, resources, dependencies, actions) plus the dedicated
  Schedules section already surface every field with real backing data;
  splitting them into Overview/Resources/Schedule/Logs/Events tabs would
  either duplicate what's already visible in one click or add tabs with
  nothing behind them (readiness, dependents, active override are still
  unavailable regardless of page layout). Revisit once override display or
  dependents are real.

## Task Manager acceptance

`TASK_MANAGER_REGISTRATION` and any live scheduling acceptance on Atlas
require host access this reconciliation does not have (no SSH session
active). All _source_ work for scheduling — policy store, preview, editor,
timeline, control-plane protection — is independent of that access and is
complete as described above. See
`docs/reviews/operator-experience-slice4-final.md` for the explicit blocker
record.
