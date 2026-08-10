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
code; they never claim success. **Every command node is now implemented** —
ADR-032 completed the last five stubs (`infra status`, `infra listeners`,
`nginx status`, `nginx test`, `tunnel status`), and a regression test asserts
no declared-but-unimplemented command remains.

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
atlas backups run-status <run-id>
atlas backups schedule show <target-id>
atlas backups retention show <target-id>
atlas events
atlas events --tail
atlas machine status
atlas machine plan
atlas machine schedule show
atlas infra status
atlas infra listeners
atlas nginx status
atlas nginx test
atlas tunnel status
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

`atlas doctor` is read-only and never invokes a repair action. Its checks cover
`/health/live`, `/health/server`, administrative overview, the protected
security posture endpoint and — appended — every infrastructure diagnostic
check. A failed check is reported individually rather than hidden behind a
generic failure.

## Infrastructure diagnostics (ADR-032)

`atlas infra status`, `atlas infra listeners`, `atlas nginx status`,
`atlas nginx test` and `atlas tunnel status` are views over one protected read:
`GET /admin/infrastructure/diagnostics`. Each command filters the report's
`checks[]` by check-id prefix and derives a status for that subset alone, so a
cloudflared outage never fails `atlas nginx test`.

They require the `infrastructure.diagnostics.read` permission (`auditor`,
`administrator`) and the
`ADMINISTRATIVE_INFRASTRUCTURE_DIAGNOSTICS_HTTP_ENABLED` activation flag.

Every check reports one of `ok`, `degraded`, `down`, `disabled` or
`unavailable`. `unavailable` means the diagnostic could not be determined —
commonly a missing privilege, flagged as `requiresPrivilege` — and is
deliberately distinct from `down`. `disabled` means intentionally switched off
and never counts as unhealthy.

**Diagnostics are read-only, permanently.** There is no `--fix` and no restart,
reload, enable or disable in any of these commands. The CLI never executes a
host tool; it only makes an authenticated HTTP request, which is why `atlas`
always diagnoses the Atlas host and never the operator's workstation.

`nginx status`/`nginx test` run `nginx -t`: they confirm the configuration
parses, not that requests are routed correctly. See `docs/operator-runbook.md`.

### Exit codes for diagnostics — a behaviour change

`atlas doctor` previously always exited 0. `atlas doctor`, `atlas status` and
the five commands above now exit **5** (`partialFailure`, reusing the existing
`infrastructure_unavailable` mapping) when the relevant overall status is
`down` or `unavailable`. `degraded` exits 0 with a warning on stderr;
`disabled` and `ok` exit 0. The full report is always printed before the exit
code is decided.

For `doctor` and `status` only, a diagnostics capability that is unreachable or
not enabled degrades to `disabled` and still exits 0, so those two commands
keep working on deployments that never set the flag.

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

atlas services schedule set <service-id> --policy '<json>'
atlas services schedule always <service-id>
atlas services schedule manual <service-id>
atlas services schedule disable <service-id>
atlas services schedule remove <service-id>

atlas backups run <target-id>
atlas backups schedule set <target-id> --policy '<json>'
atlas backups schedule remove <target-id>
atlas backups retention set <target-id> --policy '<json>'
atlas backups retention prune <target-id>
```

These are the mutating commands, delivered under ADR-031. They require an
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

### Scheduling

`services schedule set` forwards `--policy` to the server verbatim. The CLI
parses the JSON only to catch a malformed argument before spending a request;
it never validates the policy's content, so the server's schedule domain stays
the single validation authority and a rejected policy returns
`schedule_invalid`.

The alias subcommands each write one explicit **stored** policy override:
`always`, `manual`, and `disable` — which writes the domain mode `disabled`,
since the verb an operator types and the adjective the domain stores are not
the same word.

`services schedule remove` is **not** the same as `disable`. It sends no
`policy` at all, deleting the stored override so the service falls back to its
statically configured default policy — which may be any mode, not necessarily
`always`. Every schedule mutation is followed by an authoritative re-read of
`GET /admin/services/<id>/schedule`.

Backup schedules use the same `set --policy` / `remove` shape, and deliberately
have **no** `always`/`manual`/`disable` aliases: backup modes are
`manual|scheduled|disabled`, with no `always`, so partial alias parity would be
more confusing than one uniform form.

### Backups

`atlas backups run <target-id>` runs a registered target now. The only accepted
argument is a registered target id — there is deliberately no `--source`,
`--destination` or path option of any kind, so a backup can only ever read and
write the locations its registered target declares.

The run route is synchronous: it blocks until the run is terminal, so the
response is itself the authoritative result and there is no separate re-read.
Success is judged only by the run's own `succeeded` status, never by the HTTP
status — a terminal run that did not succeed is reported as a failure carrying
the server's status verbatim. Because the work happens inside the request, this
one call site raises the bounded timeout to at least five minutes; it never
removes the bound. If the outcome is lost, the CLI points you at
`atlas backups runs` and `atlas backups run-status <run-id>`.

`atlas backups retention prune` is the most consequential command here, and its
outcome is read from the server's own `result`, never from the HTTP status:

| `result`    | Exit | Meaning                                                      |
| ----------- | ---- | ------------------------------------------------------------ |
| `completed` | 0    | the prune ran to completion                                  |
| `partial`   | 1    | a known partial failure; the counts say exactly how much ran |
| `busy`      | 5    | did not complete; it may have deleted some artifacts         |
| `blocked`   | 5    | did not complete; it may have deleted some artifacts         |

The prune keeps its server-side confirmation, and there is **no** CLI bypass:
no `--force`, no `--yes`, no `--no-confirm`. The canonical confirmation the
route requires is the only accepted authorization.

`backups scheduler tick` is deliberately **not** exposed. Its claim-protected
replay policy and compare-and-set cursor make it cron-triggered maintenance
whose correctness depends on not being invoked ad hoc.

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
| `schedule_invalid`                     | 1    | the server rejected the schedule or retention policy          |
| `backup_target_not_found`              | 1    | no registered backup target with that id                      |
| `backup_run_not_found`                 | 1    | no backup run with that id                                    |
| `backup_operation_unsupported`         | 1    | the target does not support that backup operation             |
| `backup_operation_failed`              | 1    | the backup or prune did not succeed                           |
| `insecure_transport`                   | 2    | `ATLAS_BASE_URL` is plaintext HTTP to a non-loopback host     |
| `administrative_access_denied`         | 3    | missing, invalid or unauthorized credential                   |
| `operation_conflict`                   | 4    | another mutation is in progress, or rate limited              |
| `mutation_outcome_unknown`             | 5    | may or may not have been applied; re-read authoritative state |
| `interrupted`                          | 130  | cancelled before anything was sent                            |
| `mutation_interrupted_outcome_unknown` | 130  | cancelled after the mutation may have been sent               |

The JSON output is the machine contract. Human output is concise and may
evolve without being parsed by other Atlas components.
