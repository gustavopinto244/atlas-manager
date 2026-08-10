# Operator CLI — scheduling and backup mutations: final review

Milestone review for `feat/operator-cli-schedule-backup-mutations`.

- **Initial HEAD:** `2d39723` (merge of PR #317, "authenticated mutating Atlas CLI")
- **Branch base:** `origin/main` @ `2d39723`, unmoved at branch time
- **Release identity:** `1.0.0-rc.13`, deliberately unchanged — this milestone
  ships no version bump.

## What this milestone did

It turned two backend capabilities that already existed and were already used
by the dashboard — registered-service scheduling, and backup run/schedule/
retention operations — into new `atlas` CLI presentations.

It did **not** create a second domain, a second authorization system, or an
alternate mutation path. ADR-031 pre-authorised exactly this reuse as a
"mechanical follow-up slice", so **no new ADR was required**; the conditions
that authorisation depended on are evidenced below.

## Command inventory

Counts derived by counting `ATLAS_COMMANDS` entries in
`src/cli/command-tree.ts`, never hand-maintained.

|               | Before (`2d39723`) | After |
| ------------- | ------------------ | ----- |
| Command nodes | 23                 | 36    |
| Implemented   | 18                 | 31    |
| Stubbed       | 5                  | 5     |

The five stubs are unchanged and are exactly the Infrastructure Diagnostics
track: `infra status`, `infra listeners`, `nginx status`, `nginx test`,
`tunnel status`. No other command node is stubbed.

### Delivered per phase

**Phase 1 — service scheduling mutations**

`services schedule set|always|manual|disable|remove <service-id>`

**Phase 2 — backup manual run**

`backups run <target-id>`, `backups run-status <run-id>`

**Phase 3 — backup schedule and retention**

`backups schedule show|set|remove <target-id>`,
`backups retention show|set|prune <target-id>`

## Routes reused — zero new

`git diff 2d39723...HEAD -- src/http/administrative-route-security-catalog.ts`
is empty. The administrative route catalog remains at **47 descriptors**,
reconciled against source by
`tests/http/administrative-route-security-catalog.test.ts` and
`tests/http/administrative-api-contract.test.ts`.

Every route these commands call already existed and is already used by the
dashboard:

| CLI command                                   | Route                                                    | Confirmation                                  | Permission                    | Gate               |
| --------------------------------------------- | -------------------------------------------------------- | --------------------------------------------- | ----------------------------- | ------------------ |
| `services schedule set/always/manual/disable` | `PUT /admin/services/:serviceId/schedule`                | `confirm_registered_service_schedule_update`  | `services.availability.write` | `service_mutation` |
| `services schedule remove`                    | `DELETE /admin/services/:serviceId/schedule`             | `confirm_registered_service_schedule_removal` | `services.availability.write` | `service_mutation` |
| `backups run`                                 | `POST /admin/backups/targets/:targetId/runs`             | `confirm_registered_backup_run`               | `backups.run`                 | `backup_operation` |
| `backups schedule set`                        | `PUT /admin/backups/targets/:targetId/schedule`          | `confirm_registered_backup_schedule_update`   | `backups.schedule.write`      | `backup_operation` |
| `backups schedule remove`                     | `DELETE /admin/backups/targets/:targetId/schedule`       | `confirm_registered_backup_schedule_removal`  | `backups.schedule.write`      | `backup_operation` |
| `backups retention set`                       | `PUT /admin/backups/targets/:targetId/retention`         | `confirm_registered_backup_retention_update`  | `backups.retention.write`     | `backup_operation` |
| `backups retention prune`                     | `POST /admin/backups/targets/:targetId/retention/prunes` | `confirm_registered_backup_retention_prune`   | `backups.retention.prune`     | `backup_operation` |

Reads used: `services.read`, `services.schedule.read`, `backups.target.read`,
`backups.run.read`, `backups.schedule.read`, `backups.retention.read`.

## Security evidence

- **No new authentication or authorization stack.** The CLI holds zero
  permission logic. Every command goes through the same
  `createAtlasAdministrativeClient` transport landed by ADR-031.
- **Confirmations are never bare literals.** They live in
  `src/cli/administrative-contract.ts` and are pinned to the canonical server
  catalog by `tests/cli/administrative-contract.test.ts`, which fails if any
  route id, method, path template or confirmation drifts.
- **No direct host mutation.** `tests/cli/no-direct-host-mutation.test.ts` is
  untouched by this milestone and still passes: no `child_process`, no PM2 /
  Docker / systemd invocation, no `sudo`, no credential flags (`--jwt`,
  `--token`, `--password`, `--secret`), no target-selector flags (`--pm2`,
  `--container`, `--unit`), and every `src/cli` import still starts with
  `node:` or `./`.
- **No path vocabulary.** A backup is addressed by registered target id only.
  `tests/cli/backup-run.test.ts` asserts structurally that `--source`,
  `--destination` and `--path` are rejected as unknown options with nothing
  dispatched, and that a filesystem path is rejected as an invalid target id.
- **Destructive prune keeps its confirmation with no bypass.**
  `tests/cli/backup-retention-mutations.test.ts` asserts `--force`, `--yes`,
  `-y`, `--no-confirm` and `--confirm` are all rejected without dispatching.
- **No automatic retry, ever.** Every failure test asserts exactly one
  mutating request was issued.
- **Ambiguity is its own class.** Timeout, connection reset and
  interrupted-after-dispatch map to `mutation_outcome_unknown` /
  `mutation_interrupted_outcome_unknown`, distinct from both success and
  definite failure, and each message names the command that resolves it. Only
  a _provably_ undelivered request reports `infrastructure_unavailable`.
- **The CLI validates no policy content.** `--policy` is JSON-parsed only to
  reject a malformed argument early. The server's schedule, backup and
  retention domains remain the single validation authority.

## Audit evidence

`tests/http/authenticated-cli-mutation-integration.test.ts` drives the real CLI
transport against a real Express app — real Cloudflare Access verification,
real RBAC, real mutation admission, real audit sink — and asserts the CLI
produces the _same_ audited operation a dashboard-style API call produces:

- `update_registered_service_schedule`, `remove_registered_service_schedule`
- `run_registered_backup`
- `update_backup_schedule`, `update_backup_retention`,
  `run_backup_retention_prune`

There is no parallel CLI-only audit vocabulary. RBAC refusals are asserted to
leave the audit trail free of the mutation operation entirely.

## Two latent server defects found and repaired

Neither was introduced by this milestone; both blocked it, and both affected
the dashboard and API paths identically.

**1. Authorization audit allowlist drift (blocking, severe).** The
authorization-audit details validator in
`src/event-history/domain/administrative-event.ts` kept hand-written copies of
the operation vocabulary, the permission vocabulary and the operation-to-
permission mapping. They had drifted from the access-control domain: **18 of 48
administrative operations were missing**, so every authorization decision for
them was refused by the audit trail and surfaced to the caller as HTTP 503
`authorization_audit_unavailable`. That covered service logs, service schedule
reads _and_ mutations, every backup read, and all event-history operations —
whose five entries carried names the operation vocabulary never used
(`rotate_administrative_event_history` versus the real `rotate_event_history`).

The validator now asks `ADMINISTRATIVE_OPERATIONS` and
`permissionForAdministrativeOperation` directly, and a parameterised test in
`tests/event-history/domain/administrative-event.test.ts` asserts every
declared operation is recordable in both the allowed and denied direction, so
the drift cannot return.

**2. Policy validation errors reported as infrastructure failures.** The
protected-operation runner in `create-protected-administration.ts` swallowed
domain policy validation errors into `protected_operation_failed`, yielding
HTTP 503 for a merely invalid policy — telling the operator to retry something
that could never succeed unchanged — and leaving the schedule route's own
HTTP 400 mapping for exactly those error classes unreachable. The four service
scheduling validation error classes and `BackupTargetValidationError` now pass
through, and the backups route maps the latter to
`400 invalid_backup_request`. The CLI reports both as `schedule_invalid`.

## Deviations from the plan

1. **`src/service-scheduling/application/` does not exist.** The plan asked for
   a read of that directory before finalising the PUT response shape. The
   backing use case is
   `src/service-management/application/update-registered-service-availability-policy.ts`,
   reached via `create-protected-administration.ts`. Its 2xx body is the
   **persisted policy object** (`{mode, timezone, schedule}`) — _not_ a
   `{successful: boolean}` envelope like the service action routes. The
   acknowledgement check verifies a string `mode` for PUT and `removed === true`
   for DELETE, rather than the boolean the plan tentatively assumed.
2. **The backup run response is `{run, artifactDirectory}`, not a bare
   `BackupRun`.** Terminal statuses are `started|succeeded|failed|interrupted`;
   only `succeeded` is success. The `artifactDirectory` is a host filesystem
   path and is deliberately never surfaced by the CLI.
3. **A failed backup run cannot actually return 2xx today** — the use case
   throws, and the route maps that to 503. The plan called the "2xx with a
   failure status" case the single most important test in Phase 2; it is
   implemented and tested defensively anyway, for all three non-succeeded
   statuses, so the classification stays correct if the route ever starts
   returning the terminal record on failure.
4. **`backups schedule remove` resets the target to `manual`**, which is that
   domain's default, rather than falling back to a static environment config
   the way service schedule removal does. Documented rather than papered over.
5. **One extra CLI error code, `backup_run_not_found`.** The plan listed three
   new codes; `run-status` for a missing run would otherwise have reported
   `infrastructure_unavailable` (exit 5, "retry later"), which is wrong for a
   run that does not exist.
6. **Confirmation is written last in the mutation body**
   (`{...payload, confirmation}` rather than `{confirmation, ...payload}`), so
   no payload key can displace the route's authorization evidence. Key count
   and server-side validation are identical; JSON key order is not significant.
7. **The backup run timeout is an option, not a hard-coded constant.** The
   effective bound is the larger of `ATLAS_BACKUP_RUN_TIMEOUT_MS` (5 minutes)
   and any configured mutation timeout, so a deliberately longer global timeout
   is never silently shortened. It never removes the bound.
8. **Two server-side repairs were made** (above). Strictly speaking the second
   was not blocking — exit code 1 was already correct — but reporting invalid
   operator input as a transient subsystem failure is a correctness problem in
   the same family as the first, and the first had already established the fix.

## Deferred, by design

- **`backups scheduler tick` — deliberately unexposed.** Its `claim_protected`
  replay policy and reentrancy-guarded compare-and-set cursor mark it as
  internal, cron-triggered maintenance whose correctness depends on not being
  invoked ad hoc. A contract test asserts the CLI declares no descriptor for
  it. This is a classification, not an omission.
- **No `always`/`manual`/`disable` aliases for backup schedules.** Backup modes
  are `manual|scheduled|disabled` — there is no `always` — so partial alias
  parity with service schedules would be more confusing than one uniform
  `set --policy`. A negative test pins `backups schedule always` as an unknown
  command.
- **Restore commands** — no restore capability exists server-side.
- **Infrastructure diagnostics** (`infra`, `nginx`, `tunnel`) — the five
  remaining stubs; the next milestone.
- **Machine schedule mutation** — still blocked on a dedicated policy-store ADR.
- **Power CLI** — out of scope and untouched.

## Recommended next milestone

Infrastructure Diagnostics. It is now the _only_ stubbed track in the command
tree, and closing it would make every declared `atlas` command node
implemented. Its open question — the runtime diagnostic implementation boundary
(Node adapters versus a shared Go report) — is recorded as an unresolved
decision in `10-phase-traceability.md` and should be settled first.
