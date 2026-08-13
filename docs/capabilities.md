# Atlas Manager capability matrix

This matrix describes the current `1.0.0` source state. "Partial" means that a
safe/read-only or API-backed portion exists while a requested presentation or
authenticated transport portion remains intentionally unavailable. The
machine-readable inventory below is regression-tested against the live route
catalog, the administrative API contract, and the CLI command tree.

<!-- current-inventory {"administrativeRouteDescriptors":52,"cliCommandNodes":39,"cliImplemented":39,"cliStubs":0} -->

| Capability                       | CLI                                                                      | Dashboard                                                                              | API                                             | Domain/backend                                                                                                                              | Authorization                      | Confirmation                  | Audit             | Scheduler                 | Status                                                                          |
| -------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ----------------------------- | ----------------- | ------------------------- | ------------------------------------------------------------------------------- |
| Health                           | Yes                                                                      | Overview                                                                               | Public health routes                            | Server health reader                                                                                                                        | Public health only                 | No                            | No                | No                        | Available                                                                       |
| Administrative overview          | Yes (`status`)                                                           | Overview                                                                               | Protected `/admin/overview`                     | Overview use case                                                                                                                           | Cloudflare Access + RBAC           | No                            | Authorization     | Reports state             | Available                                                                       |
| Service list/status              | Yes                                                                      | Services (status chips, non-color state)                                               | Protected service routes                        | Shared service catalog                                                                                                                      | `services.read`                    | No                            | Authorization     | Effective policy          | Available                                                                       |
| Service start/stop/restart       | Yes (`atlas services start\|stop\|restart <id>`)                         | Yes (buttons derived from `supportedOperations`)                                       | Protected mutation routes                       | PM2/Docker/Compose controllers                                                                                                              | Operation-specific RBAC            | Exact confirmation            | Started/terminal  | Reconciliation-aware      | CLI, API and dashboard share one route and one audit class (ADR-031)            |
| Service logs                     | Yes                                                                      | Yes (conditional on `readLogs`)                                                        | Protected logs route                            | Adapter log readers                                                                                                                         | `services.read`                    | No                            | Authorization     | No                        | Available                                                                       |
| Service resource observation     | No                                                                       | Yes (compact CPU/memory/uptime on cards; 30s bounded polling, paused when hidden)      | Protected `/services/:id/resources` route       | Technology-neutral `ServiceResourceObservation`; PM2 and Docker readers reuse existing bounded executors; Mock/Compose report `unsupported` | `services.read`                    | No                            | Authorization     | No                        | Available for PM2/Docker; Compose deferred (see gaps)                           |
| Availability overrides           | No                                                                       | Yes                                                                                    | Protected update/delete routes                  | Override store + validator                                                                                                                  | Availability read/write            | Exact confirmation            | Yes               | Consumed by scheduler     | Dashboard/API                                                                   |
| Base service schedule (policy)   | Yes (`schedule show\|set\|always\|manual\|disable\|remove`)              | Yes (weekly editor: per-day enable, copy day, clear day/week, dirty-state warning)     | Protected `/schedule` routes                    | Persistent policy store overlays environment-owned base policy (full replace, not merge) + shared catalog                                   | Availability read/write            | Exact confirmation            | Yes               | Reconciliation            | Available; CLI, API and dashboard share the policy boundary                     |
| Persisted-policy preview         | Yes (`schedule preview`)                                                 | Yes                                                                                    | Protected `/availability/preview` route         | Domain interval evaluator                                                                                                                   | Availability read                  | No                            | No                | Evaluator                 | Available                                                                       |
| Candidate (draft) policy preview | Yes (`atlas services schedule preview <id> --from --to --policy <json>`) | Yes (Preview action in the weekly editor; does not persist)                            | Protected `/schedule/preview` route (GET+query) | Same domain evaluator, fed a candidate policy instead of the persisted one; tagged `source: candidate_preview`                              | Availability read                  | No                            | No                | Evaluator                 | Available in CLI and dashboard                                                  |
| Remove custom schedule           | Yes (`schedule remove`)                                                  | Yes (Remove action, distinct from Save/Preview)                                        | Protected `DELETE /schedule` route              | `RemoveRegisteredServiceAvailabilityPolicy`                                                                                                 | Availability write                 | Exact confirmation            | Yes               | Reconciliation            | Available in CLI and dashboard                                                  |
| PM2/Docker/Compose control       | Indirect only, through registered-service ids                            | Shared Services view                                                                   | Shared service API                              | Adapter-neutral service layer; no technology-specific scheduler exists                                                                      | Shared service RBAC                | Shared                        | Shared            | Shared policy             | Backend supported; the CLI never addresses a PM2/Docker/systemd target directly |
| Backup targets/runs              | Yes (`list\|status\|runs\|run\|run-status`)                              | Yes                                                                                    | Protected backup routes                         | Backup catalog and run store                                                                                                                | Granular backup RBAC               | Mutation-specific             | Yes               | Optional backup scheduler | Available in CLI, API and dashboard                                             |
| Backup schedule/retention        | Yes (`schedule show\|set\|remove`, `retention show\|set\|prune`)         | Yes                                                                                    | Protected mutation routes                       | Backup policy stores                                                                                                                        | Granular backup RBAC               | Exact confirmation            | Yes               | Backup scheduler          | Available in CLI, API and dashboard                                             |
| Event history                    | Yes                                                                      | Events                                                                                 | Protected query/operations routes               | File/segmented event store                                                                                                                  | Granular audit RBAC                | Mutation-dependent            | Yes               | Retention only            | Available                                                                       |
| Security posture                 | Yes (`status`/`doctor`)                                                  | Infrastructure                                                                         | Protected `/admin/security/status`              | Runtime route/flag reader                                                                                                                   | `security.posture.read`            | No                            | Authorization     | No                        | Available in CLI and dashboard                                                  |
| Machine plan/status and policy   | Yes (`status`, `plan`, `schedule show\|preview\|set\|remove`)            | Machine                                                                                | Protected overview and machine-schedule routes  | Environment scheduler policy plus separate persisted declarative policy (ADR-033)                                                           | Operations/power-schedule RBAC     | Policy mutations only         | Yes               | Physical scheduler gated  | Control plane available; physical authority remains disabled                    |
| Wake/shutdown effects            | No                                                                       | Tested mock controls                                                                   | Feature-flagged routes                          | Mock power adapters                                                                                                                         | Power RBAC + gates                 | Exact/gated                   | Yes               | Machine scheduler         | Physical effects disabled; DOM/HTTP states covered                              |
| Infrastructure diagnostics       | Yes (`infra`/`nginx`/`tunnel`/`doctor`)                                  | Full diagnostics + security posture                                                    | Security posture + infrastructure diagnostics   | Read-only diagnostic adapters (ADR-032)                                                                                                     | `infrastructure.diagnostics.read`  | No                            | Authorization     | No                        | Complete; read-only, no repair capability (ADR-032)                             |
| `atlas` operator CLI             | Yes (39 command nodes; all implemented, no stubs)                        | n/a                                                                                    | Typed HTTP adapter                              | TypeScript parser/output contracts                                                                                                          | Protected routes; no forged Access | n/a                           | Backend audit     | n/a                       | Packaged as reinstallable `.tgz`                                                |
| Administrative dashboard         | n/a                                                                      | Yes (persistent sidebar, topbar, mobile drawer, design tokens, focus/live-region a11y) | Protected shell/assets/API                      | Vanilla TypeScript assets, single script owner per page                                                                                     | Cloudflare Access + RBAC           | UI confirmation for mutations | Backend audit     | n/a                       | Authenticated operational shell                                                 |
| Reinstallable operator package   | `npm install`                                                            | n/a                                                                                    | Uses existing API                               | npm archive, no runtime deps                                                                                                                | Inherits API auth                  | n/a                           | Backend audit     | n/a                       | `npm run package:operator`                                                      |
| Server installation planner      | Bundle-local `inspect`/`plan`                                            | n/a                                                                                    | Fixed sibling tool reports                      | Read-only deployment orchestration                                                                                                          | OS/file permissions                | Never supplied by planner     | External evidence | n/a                       | Available; mutation remains explicit                                            |

The packaged CLI exposes its installed package version through
`atlas --version`.

The administrative route catalog currently contains 52 descriptors and the
CLI contains 39 implemented command nodes with zero stubs. These are not
free-standing prose claims: `tests/http/administrative-api-contract.test.ts`
reconciles the versioned administrative contract with the live catalog, while
`tests/documentation/current-inventories.test.ts` reconciles the inventory
marker above with both source catalogs. Route activation and feature-flag
state are exposed by the protected security posture response; disabled power
routes remain absent from the effective route set. See [CLI reference](cli.md),
[dashboard guide](dashboard.md), [scheduling](scheduling.md), and the
[operator package runbook](operations/atlas-manager-operator-cli.md).

Dashboard power controls are a
presentation component over the existing protected APIs and canonical domain
confirmation constants. Their DOM coverage includes disabled, loading,
unauthorized, busy/conflict, malformed response, confirmation and accepted
preparation/execution states.

## Known deferred items (not gaps in what shipped, explicitly out of scope)

- Compose resource aggregation semantics (per-member vs. aggregate CPU/memory)
  are undesigned; the reader reports `unsupported` rather than fabricating a
  value. Registered-service _scheduling_ for Compose is unaffected — it uses
  the same existing controller, independent of resource observability.
- A separate multi-section service detail page (Overview/Resources/Schedule/
  Logs/Events) was reassessed after Slices 3-4 and still not built: the
  service card plus the dedicated Schedules section already surface every
  field that has real backing data, and a second page would either duplicate
  that or show fields with no data behind them.
- CLI `events --tail --after <sequence>` are the only pagination controls
  exposed; there is still no live tail/follow mode that streams new events as
  they occur (`atlas events` remains a one-shot page read, repeated
  invocations required to walk the log). This is a distinct, larger feature
  than pagination and was not attempted in any tranche so far.
- Backups dashboard run-status is shown per-target from the existing runs
  feed and refreshes whenever any operator action on the page completes, but
  the Backups section is not part of the dashboard's automatic polling set —
  only Services auto-polls (`SERVICES_POLL_INTERVAL_MS` in
  `src/dashboard/main.ts`), a deliberate Slice 3 scope decision. Extending
  automatic polling to Backups (or other sections) is a real product/UX
  decision — poll interval, per-session read cost, which sections warrant it
  — not a small presentational fix. See
  `docs/reviews/operator-experience-final-gap-audit.md` item 5.

### Closed in the Operator Experience Phase 0-1 tranche

Following the source-only #320 milestone (which classified real gaps but
implemented no code fixes), this follow-up tranche closed four of the five
`REAL_GAP` items that turned out to be small and additive over already-
existing backend/domain (see
`docs/reviews/operator-experience-final-gap-audit.md` for the full
before/after evidence per item):

- **Active override + expiry** are now shown on the schedule timeline.
  `GetRegisteredServiceEffectiveAvailability.executeWithOverride()` (additive;
  `execute()` is unchanged) surfaces the active, non-expired override, and
  `services.availability.read` now returns an `override: {kind, expiresAt} |
null` field.
- **Following transitions** (not just the single next one) are now included
  as a bounded list on both the persisted-policy and candidate-policy
  preview responses, and rendered under "First required at" in the schedule
  view.
- **Backups "Run now"** is now a dashboard button, reusing the existing
  `POST /admin/backups/targets/:targetId/runs` route (already RBAC- and
  confirmation-gated, already CLI-exposed) and the existing confirmation-form
  pattern used for "Prune retention." Run-status polling was not added.
- **Events pagination** — the dashboard Events page now has a "Load more"
  button using the already-existing `hasMore`/`nextAfterSequence` response
  fields; no route or schema change.

### Closed in the Operator Experience Phase 4 tranche

Following Phase 3 (`e665bfe`, machine operating policy persistence, ADR-033),
this tranche re-verified every remaining item in
`docs/reviews/operator-experience-final-gap-audit.md` and closed the two that
were genuinely small:

- **Scheduler health/cursor visibility** (item 4, previously deferred by
  size) is now surfaced: a new `scheduler.service_availability` `CHECK_ID`
  reads `ServiceAvailabilityReconciliationSchedulerCursor` through the
  existing `infra`/`doctor` diagnostics report, wired via
  `create-administrative-runtime.ts` using the
  `serviceAvailabilityReconciliationSchedulerCursorFilePath` config field
  (already present in `EnvironmentConfig` since Phase 3, but previously
  unused by diagnostics). Implementing this also surfaced and fixed a
  genuine pre-existing bug: `readLastTick()` did not recognize the
  `completedThrough` key, so the already-shipped `scheduler.power` check was
  silently reporting "no tick recorded yet" even when its cursor had
  advanced. Both checks now report the real last-tick timestamp.
- **CLI events pagination** (the CLI half of item 6) is now closed:
  `atlas events --after <sequence>` wires the same `afterSequence` query
  parameter the route already accepted and the dashboard's "Load more"
  already used. `--tail` is unchanged and composes with `--after`.
