# CLI plan

> **Historical milestone plan.** The 36-node/5-stub inventory below describes
> its 2026-08-10 slice. Current `1.0.0` source has 39 implemented command nodes
> and zero stubs. See `docs/capabilities.md` and the regression-tested command
> inventory.

## Status (2026-08-10, scheduling and backup CLI mutations milestone)

Source: `src/cli/command-tree.ts` (`AtlasCommand.implemented`). 36 command
nodes exist; 31 are implemented, 5 are stubbed and return
`command_not_implemented`:

| State                                                              | Commands                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Implemented, read-only                                             | `status`, `health`, `doctor`, `services list`, `services status`, `services logs`, `services schedule show`, `services schedule preview`, `backups list`, `backups status`, `backups runs`, `events`, `machine status`, `machine plan`, `machine schedule show` |
| Implemented, read-only (this milestone)                            | `backups run-status`, `backups schedule show`, `backups retention show`                                                                                                                                                                                         |
| Implemented, mutating (ADR-031 authenticated transport)            | `services start`, `services stop`, `services restart`                                                                                                                                                                                                           |
| Implemented, mutating (this milestone)                             | `services schedule set/always/manual/disable/remove`, `backups run`, `backups schedule set/remove`, `backups retention set/prune`                                                                                                                               |
| Stubbed, blocked on infrastructure-diagnostics track (not started) | `infra status`, `infra listeners`, `nginx status`, `nginx test`, `tunnel status`                                                                                                                                                                                |

> Counts are derived from `ATLAS_COMMANDS` by counting entries at the time of
> writing, never maintained by hand. The five remaining stubs are exactly the
> infrastructure-diagnostics track; no other command node is stubbed.

`services schedule preview` covers both previews. Invoked with `--from` and
`--to` alone it performs the pre-existing **persisted-policy** preview
(`GET /admin/services/:id/availability/preview`). Adding `--policy <json>`
selects the Slice 4 **candidate-draft** preview
(`GET /admin/services/:id/schedule/preview`) without saving anything. Both are
read-only and therefore never depended on the mutation transport; the default
invocation is unchanged.

## Architectural direction

Implement `atlas` in TypeScript/Node and package it with Atlas Manager. This is
the choice accepted in ADR-027 because command DTOs, validation domains and the
application composition are already TypeScript. The CLI must not invoke PM2,
Docker or power effects directly when an application capability exists — a
regression guard (`tests/cli/no-direct-host-mutation.test.ts`) enforces this by
scanning every `src/cli` module.

Administrative mutations travel through an authenticated protected boundary. No
mutating command may instantiate an unprotected use case or forge Cloudflare
headers. The credential model is settled by **ADR-031**: the CLI forwards an
externally issued Cloudflare Access assertion supplied through
`ATLAS_CLOUDFLARE_ACCESS_JWT` to the existing administrative routes. There is no
second authentication stack, no second authorization system, and no
CLI-specific route.

### Mutating command contract (ADR-031)

- Confirmations are derived from the canonical route security catalog, pinned by
  `tests/cli/administrative-contract.test.ts`, never duplicated as CLI literals.
- Mutations require an HTTPS or loopback `ATLAS_BASE_URL`; a plaintext
  non-loopback base URL is refused with `insecure_transport` before any network
  activity, and never receives the assertion.
- Redirects are never followed (`redirect: "error"`), so a credential cannot be
  bounced to a server-chosen origin.
- Mutations are never retried automatically. A lost or timed-out response yields
  `mutation_outcome_unknown` (exit 5) and directs the operator to re-read
  authoritative state; only a provably undelivered request reports
  `infrastructure_unavailable`.
- Success is confirmed by an authoritative re-read of
  `GET /admin/services/:id`, never by the HTTP status alone.
- A refused mutation never falls back to local execution.

### Schedule and backup mutation contract (this milestone)

The slice above reused this transport unchanged, as ADR-031 pre-authorised. It
added no administrative route, no second authorization stack, and no
CLI-specific mutation path. Three properties are specific to it:

- **Policy content is never validated client-side.** `--policy` is JSON-parsed
  only to reject a malformed argument before spending a request. The server's
  schedule, backup and retention domains remain the single validation
  authority, and a rejected policy surfaces as `schedule_invalid` rather than
  as a retryable infrastructure failure.
- **Removing a schedule is not disabling it.** `services schedule remove`
  sends no `policy` key at all and deletes the stored override, so the service
  falls back to its statically configured default policy. The alias
  subcommands instead persist an explicit override, and `disable` (verb) maps
  explicitly to the domain mode `disabled` (adjective).
- **Outcome is read from the result, not the status.** A manual backup run is
  judged only by the run's own `succeeded` status, and a retention prune only
  by its `result`: `completed` succeeds, `partial` is a known partial failure
  (exit 1), and `busy`/`blocked` are genuinely ambiguous (exit 5). The
  synchronous run route is the one mutation with no separate re-read, because
  its response _is_ the post-state.

`backups scheduler tick` remains deliberately unexposed. Its `claim_protected`
replay policy and reentrancy-guarded compare-and-set cursor mark it as
internal, cron-triggered maintenance whose correctness depends on not being
invoked ad hoc; a contract test asserts the CLI declares no descriptor for it.

The destructive `backups retention prune` keeps its server-side confirmation
with no CLI bypass of any kind — no `--force`, `--yes` or `--no-confirm` — and
tests assert those flags are rejected as unknown options with nothing
dispatched.

## Command families

| Command                             | Current capability                                        | Gap before delivery                                   |
| ----------------------------------- | --------------------------------------------------------- | ----------------------------------------------------- |
| `atlas status`                      | health, overview, service status exist in parts           | aggregate operator status use case and infra adapters |
| `atlas health`                      | `/health/live`, `/health/server`                          | CLI client and output contract                        |
| `atlas doctor`                      | deployment qualification checks exist in Go               | shared read-only diagnostic contract for runtime use  |
| `atlas services list`               | list use case and API exist                               | CLI transport/auth                                    |
| `atlas services status <id>`        | status use case and API exist                             | CLI transport/auth                                    |
| `atlas services start/stop/restart` | delivered over the ADR-031 authenticated transport        | none                                                  |
| `atlas services logs`               | application use case and PM2/Docker/Compose readers exist | protected HTTP/streaming API                          |
| `atlas services schedule show`      | policy exists in registered service                       | explicit schedule DTO/API                             |
| schedule mutation commands          | policy store, use cases, API, auth and audit all exist    | CLI parser and command wiring only (next slice)       |
| `atlas backups ...`                 | most protected APIs exist                                 | CLI mapping and output contracts                      |
| `atlas events`                      | query API exists                                          | pagination/tail UX and auth                           |
| `atlas infra/nginx/tunnel ...`      | host qualification has related checks                     | runtime diagnostic ports/adapters                     |
| `atlas machine ...`                 | machine plan domain exists                                | protected read APIs and DTOs                          |

## CLI layers

```text
argv
  -> command parser
  -> command handler
  -> application/API client port
  -> authenticated transport or read-only diagnostic adapter
  -> typed command result
  -> human or JSON renderer
```

Command handlers must never parse human output from another `atlas` command.
Infrastructure adapters may parse native tool output behind typed ports and
must have fixture-based tests.

## Output and exit contract

- `0`: command completed and the requested operation succeeded.
- `1`: stable operational failure reported in the command result.
- `2`: invalid command or arguments.
- `3`: authentication or authorization failure.
- `4`: conflict/busy condition.
- `5`: partial or **indeterminate** result — `doctor`/`status` still render all
  checks, and a mutation whose response was lost reports an outcome that must be
  re-read rather than a failure.
- `130`: interrupted by SIGINT where applicable.

Stable error codes begin with the requested baseline:
`service_not_found`, `service_operation_failed`,
`administrative_access_denied`, `schedule_invalid`,
`infrastructure_unavailable`. Add codes only with tests and documentation.

The authenticated mutating CLI milestone added, each with tests:

| Code                                   | Exit | Meaning                                                                     |
| -------------------------------------- | ---- | --------------------------------------------------------------------------- |
| `service_operation_unsupported`        | 1    | the registered service does not support the requested operation             |
| `insecure_transport`                   | 2    | mutation refused: `ATLAS_BASE_URL` is plaintext HTTP to a non-loopback host |
| `mutation_outcome_unknown`             | 5    | the mutation may or may not have been applied; re-read authoritative state  |
| `interrupted`                          | 130  | cancelled before anything was dispatched                                    |
| `mutation_interrupted_outcome_unknown` | 130  | cancelled after the mutation may have been sent                             |

JSON output must include a schema version, command identifier, result status,
data and structured errors. Human output is concise and may evolve without
becoming a machine contract.

## Delivery slices

### CLI-1 foundation

- executable/package entry;
- command registry and nested help;
- human/JSON renderers;
- stable exit mapping;
- cancellation and signal hooks;
- bundle inclusion and installation tests.

### CLI-2 read-only status and doctor

- partial-result aggregation;
- health and service summaries;
- infrastructure checks;
- no `--fix` behavior.

### CLI-3 services — delivered

- list/status/logs first — done;
- mutations only after the auth ADR — ADR-031 accepted, `services
start/stop/restart` delivered against it;
- confirmation semantics derived from route policy, not duplicated strings —
  done, and pinned to the catalog by a contract test.

### CLI-4 scheduling — partially delivered

- weekday/time parser is presentation-only — still true; the CLI carries no
  schedule grammar at all;
- normalized input is validated by `createServiceAvailabilityPolicy` — the
  backend canonical parser remains authoritative;
- preview supports current and candidate policy — **done**
  (`services schedule preview [--policy <json>]`);
- timezone values use the existing domain validator — unchanged;
- schedule _mutation_ commands (`set`/`always`/`manual`/`disable`/`remove`)
  remain the next slice. They are no longer architecturally blocked: they reuse
  the ADR-031 transport and the existing `services.schedule.update` /
  `services.schedule.delete` descriptors.

### CLI-5 backups, events and machine

- map only real capabilities;
- side effects and authorization documented per command;
- event tail and log follow support cancellation without orphan processes.

## Tests

- parser and dispatch table;
- nested help and unknown commands;
- human and JSON golden/structural tests;
- exit codes for every error class;
- transport unavailable, denied, busy and not found;
- schedule normalization and backend rejection;
- SIGINT/log-follow cleanup;
- bundle inventory and executable smoke.
