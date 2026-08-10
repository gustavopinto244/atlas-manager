# `atlas` CLI

The official CLI is a TypeScript/Node presentation adapter. It is packaged as
the `atlas` binary and shares the application's typed contracts; it does not
invoke PM2, Docker, systemd or power helpers directly.

## Current foundation

The foundation provides:

- `atlas --version`, `atlas --help` and `atlas help`;
- nested help such as `atlas services schedule --help`;
- a stable JSON envelope with `schemaVersion`, `command`, `status`, `data`
  and structured `error` fields;
- stable exit-code categories;
- signal cancellation through `AbortSignal` for commands that use a transport.

The command tree is intentionally visible before each command is implemented.
Unimplemented commands return `command_not_implemented` and a non-zero exit
code; they never claim success. Of 23 command nodes, 18 are implemented; the
five remaining stubs (`infra status`, `infra listeners`, `nginx status`,
`nginx test`, `tunnel status`) belong to the infrastructure-diagnostics track.

## Available read-only commands

```text
atlas health
atlas health --json
atlas status
atlas doctor
atlas services list
atlas services status <service-id>
atlas services logs <service-id>
atlas services schedule show <service-id>
atlas services schedule preview <service-id>
atlas backups list
atlas backups status
atlas backups runs
atlas events
atlas events --tail
atlas machine status
atlas machine plan
atlas machine schedule show
```

The default endpoint is `http://127.0.0.1:3000`. Set `ATLAS_BASE_URL` to use a
different HTTP endpoint. Public health responses are read directly. Protected
administrative responses require an already authenticated transport; the
default CLI transport does not forge Cloudflare Access assertions and reports
`authentication_required` in a partial `atlas status` result. If the operator
already has a real Cloudflare Access JWT, it may be supplied in memory through
`ATLAS_CLOUDFLARE_ACCESS_JWT`; the adapter forwards it as
`Cf-Access-Jwt-Assertion`. Never put it in `ATLAS_BASE_URL`, command arguments
or shell history.

`atlas doctor` is read-only and never invokes a repair action. Its current
checks cover `/health/live`, `/health/server`, administrative overview and the
protected security posture endpoint; a failed administrative check is reported
individually rather than hidden behind a generic failure.

Schedule preview defaults to the next 24 hours and previews the **persisted**
policy. Use `--from <canonical-timestamp> --to <canonical-timestamp>` for an
explicit interval, and add `--policy <json>` to preview a **candidate** policy
without saving it:

```text
atlas services schedule preview task-manager \
  --from 2026-08-11T00:00:00.000Z \
  --to   2026-08-12T00:00:00.000Z \
  --policy '{"mode":"manual"}'
```

## Mutating commands

```text
atlas services start <service-id>
atlas services stop <service-id>
atlas services restart <service-id>
```

These are the first mutating commands, delivered under ADR-031. They require an
externally issued Cloudflare Access assertion in
`ATLAS_CLOUDFLARE_ACCESS_JWT`, and they call the same protected administrative
routes the dashboard calls — same RBAC, same exact confirmation, same mutation
gate, same audit event with the same principal.

```text
$ atlas services restart task-manager
Service: Task Manager
Operation: restart
Result: completed
State: running
```

What the CLI does, and deliberately does not do:

- **Target.** The only accepted argument is a registered service id. There is no
  `--pm2`, `--container` or `--unit` option, because those would address a
  runtime object outside the application's authorization and audit model.
- **Authoritative result.** After a successful mutation the CLI re-reads
  `GET /admin/services/<id>` and reports the real current state. Success is
  never claimed from an HTTP status alone. If the re-read fails, the operation
  is still reported as accepted with `State: unknown`.
- **Transport security.** Mutations require an HTTPS or loopback
  `ATLAS_BASE_URL`. A plaintext non-loopback endpoint is refused with
  `insecure_transport` before any network activity, and never receives the
  assertion. Redirects are never followed.
- **No retries.** `start`, `stop` and `restart` are not idempotent. If a
  response is lost or times out, the CLI reports `mutation_outcome_unknown`
  (exit 5) and tells you to run `atlas services status <id>` — it does not retry
  and does not claim the operation failed.
- **No fallback.** If the administrative request is refused, the CLI stops. It
  never runs PM2, Docker or systemd instead.

## Security boundary

The CLI must not forge Cloudflare Access assertions or bypass administrative
authorization. The assertion is accepted only through the
`ATLAS_CLOUDFLARE_ACCESS_JWT` environment variable, is sent only in the
`Cf-Access-Jwt-Assertion` header, and is never logged, printed, embedded in an
error, emitted in JSON output, or written to disk. Never place it in
`ATLAS_BASE_URL`, in command arguments, or in shell history.

## Exit codes

| Code | Meaning                                                              |
| ---- | -------------------------------------------------------------------- |
| 0    | success                                                              |
| 1    | operational failure                                                  |
| 2    | invalid arguments, unknown or unavailable command, insecure endpoint |
| 3    | authentication or authorization failure                              |
| 4    | conflict or busy state                                               |
| 5    | partial diagnostic failure, or an indeterminate mutation outcome     |
| 130  | interrupted by SIGINT                                                |

Stable error codes for mutating commands:

| Code                                   | Exit | Meaning                                                       |
| -------------------------------------- | ---- | ------------------------------------------------------------- |
| `service_not_found`                    | 1    | no registered service with that id                            |
| `service_operation_unsupported`        | 1    | the service does not support that operation                   |
| `service_operation_failed`             | 1    | Atlas rejected or could not complete the operation            |
| `insecure_transport`                   | 2    | `ATLAS_BASE_URL` is plaintext HTTP to a non-loopback host     |
| `administrative_access_denied`         | 3    | missing, invalid or unauthorized credential                   |
| `operation_conflict`                   | 4    | another service mutation is in progress, or rate limited      |
| `mutation_outcome_unknown`             | 5    | may or may not have been applied; re-read authoritative state |
| `interrupted`                          | 130  | cancelled before anything was sent                            |
| `mutation_interrupted_outcome_unknown` | 130  | cancelled after the mutation may have been sent               |

The JSON output is the machine contract. Human output is concise and may
evolve without being parsed by other Atlas components.
