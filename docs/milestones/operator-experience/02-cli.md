# CLI plan

## Status (2026-08-10)

Source: `src/cli/command-tree.ts` (`AtlasCommand.implemented`). 23 command
nodes exist; 16 are implemented, 7 are stubbed and return
`command_not_implemented`:

| State                                                              | Commands                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Implemented                                                        | `status`, `health`, `doctor`, `services list`, `services status`, `services logs`, `services schedule show`, `services schedule preview`, `backups list`, `backups status`, `backups runs`, `events`, `machine status`, `machine plan`, `machine schedule show` |
| Stubbed, blocked on CLI identity ADR (ADR-028)                     | `services start`, `services stop`, `services restart`                                                                                                                                                                                                           |
| Stubbed, blocked on infrastructure-diagnostics track (not started) | `infra status`, `infra listeners`, `nginx status`, `nginx test`, `tunnel status`                                                                                                                                                                                |

`services schedule preview` above is the pre-existing **persisted-policy**
preview. Operator Dashboard v2 Slice 4 added a distinct **candidate-draft**
preview capability (`PreviewRegisteredServiceAvailabilityPolicy`,
`GET /admin/services/:id/schedule/preview`) that has no CLI command yet.
Because preview is read-only, it does not need the CLI identity ADR the way
mutations do; exposing it via `atlas services schedule preview --policy
<file>` (or similar) is a small, well-scoped follow-up, not a blocked one.

## Architectural direction

Implement `atlas` in TypeScript/Node and package it with Atlas Manager. This is
the proposed choice in ADR-027 because command DTOs, validation domains and the
application composition are already TypeScript. The CLI must not invoke PM2,
Docker or power effects directly when an application capability exists.

Administrative mutations must travel through an authenticated protected
boundary. No mutating command is allowed to instantiate an unprotected use case
or forge Cloudflare headers. The exact local/remote credential model requires a
follow-up ADR before mutation commands land.

## Command families

| Command                             | Current capability                                        | Gap before delivery                                   |
| ----------------------------------- | --------------------------------------------------------- | ----------------------------------------------------- |
| `atlas status`                      | health, overview, service status exist in parts           | aggregate operator status use case and infra adapters |
| `atlas health`                      | `/health/live`, `/health/server`                          | CLI client and output contract                        |
| `atlas doctor`                      | deployment qualification checks exist in Go               | shared read-only diagnostic contract for runtime use  |
| `atlas services list`               | list use case and API exist                               | CLI transport/auth                                    |
| `atlas services status <id>`        | status use case and API exist                             | CLI transport/auth                                    |
| `atlas services start/stop/restart` | protected use cases and APIs exist                        | accepted CLI authentication boundary                  |
| `atlas services logs`               | application use case and PM2/Docker/Compose readers exist | protected HTTP/streaming API                          |
| `atlas services schedule show`      | policy exists in registered service                       | explicit schedule DTO/API                             |
| schedule mutation commands          | domain parser exists                                      | policy store/use cases/API/auth/audit                 |
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
- `5`: partial diagnostic failure (`doctor`/`status` still renders all checks).
- `130`: interrupted by SIGINT where applicable.

Stable error codes begin with the requested baseline:
`service_not_found`, `service_operation_failed`,
`administrative_access_denied`, `schedule_invalid`,
`infrastructure_unavailable`. Add codes only with tests and documentation.

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

### CLI-3 services

- list/status/logs first;
- mutations only after auth ADR;
- confirmation semantics derived from route policy, not duplicated strings.

### CLI-4 scheduling

- weekday/time parser is presentation-only;
- normalized input is validated by `createServiceAvailabilityPolicy`;
- preview supports current and candidate policy;
- timezone values use the existing domain validator.

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
