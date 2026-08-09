# PR #301 — endpoint audit

## Common enforced contract

Every administrative row below is registered through
`registerAdministrativeRoute`, requires Cloudflare Access authentication and
backend RBAC permission, applies administrative security headers and shared
admission, rejects unknown fields/duplicate JSON keys, and has the catalogued
audit/replay policy. Mutations pass their named gate and use case; use cases own
persistence and event history. No power route can use a physical adapter in the
reviewed mock-administrative profile.

`PASS` means current runtime registration reconciles to the descriptor; direct
PR impact marks dashboard, overview and power surfaces. The target limit is
4,096 B for every catalogued route. Read requests have no body; JSON mutation
content type is `application/json` (optional UTF-8 charset) and identity-only
content encoding.

## Public health endpoints

### GET /health/live

Route ID: none · activation: always · auth/RBAC: none · request: no body ·
side effect/audit: none · response: exact `{status:"ok"}` · merge impact:
transitive lifecycle retry · tests: health, runtime verification · verdict:
**PASS**.

### GET /health/server

Route ID: none · activation: always · auth/RBAC: none · request: no body ·
side effect/audit: none · response: bounded server metrics object · merge
impact: transitive lifecycle retry · tests: server health/runtime verification ·
verdict: **PASS**.

## Administrative catalog (45 descriptors)

| Endpoint / route ID                                                                   | Activation · permission              | Confirmation · gate · audit/replay                          | Request / response                      | PR impact · verdict |
| ------------------------------------------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------- | --------------------------------------- | ------------------- |
| `GET /` `dashboard.read`                                                              | dashboard · `dashboard.read`         | none · none · authorization-only/read-only                  | no body → HTML                          | direct · PASS       |
| `GET /assets/:asset` `dashboard.asset.read`                                           | dashboard · `dashboard.read`         | none · none · authorization-only/read-only                  | no body → named asset                   | direct · PASS       |
| `GET /admin/event-history` `event_history.read`                                       | event history · `event_history.read` | none · none · authorization-only/read-only                  | no body → JSON                          | transitive · PASS   |
| `GET /admin/power/wake-alarm` `power.wake.read`                                       | wake · `power.wake.read`             | none · none · authorization-only/read-only                  | no body → observation JSON              | direct · PASS       |
| `PUT /admin/power/wake-alarm` `power.wake.update`                                     | wake · `power.wake.schedule`         | none · power · started-terminal/state-recheck               | strict JSON ≤512 B → mutation JSON      | direct · FIXED      |
| `DELETE /admin/power/wake-alarm` `power.wake.delete`                                  | wake · `power.wake.cancel`           | none · power · started-terminal/state-recheck               | strict JSON ≤512 B → mutation JSON      | direct · FIXED      |
| `POST /admin/power/shutdown/preparations` `power.shutdown.prepare`                    | shutdown · `power.shutdown.prepare`  | exact preparation · power · started-terminal/state-recheck  | strict JSON ≤1,024 B → preparation JSON | direct · FIXED      |
| `POST /admin/power/shutdown/executions` `power.shutdown.execute`                      | shutdown · `power.shutdown.execute`  | exact execution · power · started-terminal/state-recheck    | strict JSON ≤1,024 B → execution JSON   | direct · FIXED      |
| `GET /admin/services` `services.list`                                                 | service mgmt · `services.read`       | none · none · authorization-only/read-only                  | no body → JSON                          | transitive · PASS   |
| `GET /admin/services/:serviceId` `services.read`                                      | service mgmt · `services.read`       | none · none · authorization-only/read-only                  | no body → JSON                          | transitive · PASS   |
| `GET /admin/services/:serviceId/logs` `services.logs.read`                            | service mgmt · `services.read`       | none · none · authorization-only/read-only                  | no body → JSON                          | transitive · PASS   |
| `POST /admin/services/:serviceId/actions/start` `services.start`                      | service mgmt · `services.start`      | exact start · service · started-terminal/state-recheck      | strict JSON ≤8,192 B → JSON             | transitive · PASS   |
| `POST /admin/services/:serviceId/actions/stop` `services.stop`                        | service mgmt · `services.stop`       | exact stop · service · started-terminal/state-recheck       | strict JSON ≤8,192 B → JSON             | transitive · PASS   |
| `POST /admin/services/:serviceId/actions/restart` `services.restart`                  | service mgmt · `services.restart`    | exact restart · service · started-terminal/state-recheck    | strict JSON ≤8,192 B → JSON             | transitive · PASS   |
| `GET /admin/services/:serviceId/availability` `services.availability.read`            | availability · read                  | none · none · authorization-only/read-only                  | no body → JSON                          | transitive · PASS   |
| `GET /admin/services/:serviceId/schedule` `services.schedule.read`                    | schedule · availability read         | none · none · authorization-only/read-only                  | no body → JSON                          | transitive · PASS   |
| `GET /admin/services/:serviceId/availability/preview` `services.availability.preview` | availability · read                  | none · none · authorization-only/read-only                  | no body → JSON                          | transitive · PASS   |
| `PUT /admin/services/:serviceId/availability` `services.availability.update`          | availability · write                 | exact update · service · started-terminal/state-recheck     | strict JSON ≤8,192 B → JSON             | transitive · PASS   |
| `DELETE /admin/services/:serviceId/availability` `services.availability.delete`       | availability · write                 | exact removal · service · started-terminal/state-recheck    | strict JSON ≤8,192 B → JSON             | transitive · PASS   |
| `PUT /admin/services/:serviceId/schedule` `services.schedule.update`                  | schedule · availability write        | exact update · service · started-terminal/state-recheck     | strict JSON ≤8,192 B → JSON             | transitive · PASS   |
| `DELETE /admin/services/:serviceId/schedule` `services.schedule.delete`               | schedule · availability write        | exact removal · service · started-terminal/state-recheck    | strict JSON ≤8,192 B → JSON             | transitive · PASS   |
| `GET /admin/overview` `operations.read`                                               | overview · `operations.read`         | none · none · authorization-only/read-only                  | no body → capability JSON               | direct · PASS       |
| `GET /admin/backups/targets` `backups.targets.read`                                   | backups · target read                | none · none · authorization-only/read-only                  | no body → JSON                          | transitive · PASS   |
| `GET /admin/backups/targets/:targetId` `backups.target.read`                          | backups · target read                | none · none · authorization-only/read-only                  | no body → JSON                          | transitive · PASS   |
| `GET /admin/backups/runs` `backups.runs.read`                                         | backups · run read                   | none · none · authorization-only/read-only                  | no body → JSON                          | transitive · PASS   |
| `GET /admin/backups/runs/:runId` `backups.run.read`                                   | backups · run read                   | none · none · authorization-only/read-only                  | no body → JSON                          | transitive · PASS   |
| `POST /admin/backups/targets/:targetId/runs` `backups.run`                            | backups · run                        | exact run · backup · started-terminal/state-recheck         | strict JSON ≤8,192 B → JSON             | transitive · PASS   |
| `GET /admin/backups/targets/:targetId/schedule` `backups.schedule.read`               | backups · schedule read              | none · none · authorization-only/read-only                  | no body → JSON                          | transitive · PASS   |
| `PUT /admin/backups/targets/:targetId/schedule` `backups.schedule.update`             | backups · schedule write             | exact update · backup · started-terminal/state-recheck      | strict JSON ≤8,192 B → JSON             | transitive · PASS   |
| `DELETE /admin/backups/targets/:targetId/schedule` `backups.schedule.delete`          | backups · schedule write             | exact removal · backup · started-terminal/state-recheck     | strict JSON ≤8,192 B → JSON             | transitive · PASS   |
| `GET /admin/backups/targets/:targetId/retention` `backups.retention.read`             | backups · retention read             | none · none · authorization-only/read-only                  | no body → JSON                          | transitive · PASS   |
| `PUT /admin/backups/targets/:targetId/retention` `backups.retention.update`           | backups · retention write            | exact update · backup · started-terminal/state-recheck      | strict JSON ≤8,192 B → JSON             | transitive · PASS   |
| `POST /admin/backups/targets/:targetId/retention/prunes` `backups.retention.prune`    | backups · retention prune            | exact prune · backup · started-terminal/state-recheck       | strict JSON ≤8,192 B → JSON             | transitive · PASS   |
| `POST /admin/backups/scheduler/ticks` `backups.scheduler.tick`                        | backups · scheduler tick             | exact tick · backup · started-terminal/claim-protected      | strict JSON ≤8,192 B → JSON             | transitive · PASS   |
| `GET /admin/event-history/integrity` `event_history.integrity.read`                   | history ops · integrity read         | none · none · authorization-only/read-only                  | no body → JSON                          | transitive · PASS   |
| `POST /admin/event-history/rotations` `event_history.rotation.run`                    | history ops · rotation run           | exact rotation · maintenance · started-terminal/conflict    | strict JSON ≤8,192 B → JSON             | transitive · PASS   |
| `GET /admin/event-history/retention` `event_history.retention.read`                   | history ops · retention read         | none · none · authorization-only/read-only                  | no body → JSON                          | transitive · PASS   |
| `PUT /admin/event-history/retention` `event_history.retention.update`                 | history ops · retention write        | exact update · maintenance · started-terminal/state-recheck | strict JSON ≤8,192 B → JSON             | transitive · PASS   |
| `POST /admin/event-history/retention/prunes` `event_history.retention.prune`          | history ops · prune                  | exact prune · maintenance · started-terminal/conflict       | strict JSON ≤8,192 B → JSON             | transitive · PASS   |
| `GET /admin/event-history/exports` `event_history.exports.read`                       | history ops · exports read           | none · none · authorization-only/read-only                  | no body → JSON                          | transitive · PASS   |
| `POST /admin/event-history/exports` `event_history.exports.create`                    | history ops · exports create         | exact export · maintenance · started-terminal/state-recheck | strict JSON ≤8,192 B → JSON             | transitive · PASS   |
| `GET /admin/event-history/exports/:exportId` `event_history.export.read`              | history ops · export read            | none · none · authorization-only/read-only                  | no body → JSON                          | transitive · PASS   |
| `GET /admin/event-history/exports/:exportId/content` `event_history.export.download`  | history ops · export download        | none · none · authorization-only/read-only                  | no body → download                      | transitive · PASS   |
| `POST /admin/event-history/exports/retention/prunes` `event_history.exports.prune`    | history ops · export prune           | exact prune · maintenance · started-terminal/conflict       | strict JSON ≤8,192 B → JSON             | transitive · PASS   |
| `GET /admin/security/status` `security.status.read`                                   | security · posture read              | none · none · authorization-only/read-only                  | no body → JSON                          | transitive · PASS   |

## Priority-route adversarial review

`/`, `/assets/:asset` and `/admin/overview` were exercised without an assertion,
with invalid assertion, unknown principal and authorized principal. Host/origin
enforcement is upstream in the protected administrative runtime and remains
required before route use. Wake and shutdown tests cover invalid methods,
queries, content type/encoding, body size, duplicate/unknown fields, future
timestamps, confirmation, gate contention, auth failures and missing route
registration. The lifecycle probe additionally asserts loopback physical URL
with configured public Host authority.
