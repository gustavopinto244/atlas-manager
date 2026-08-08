# `atlas` CLI

The official CLI is a TypeScript/Node presentation adapter. It is packaged as
the `atlas` binary and shares the application's typed contracts; it does not
invoke PM2, Docker, systemd or power helpers directly.

## Current foundation

The foundation provides:

- `atlas --help` and `atlas help`;
- nested help such as `atlas services schedule --help`;
- a stable JSON envelope with `schemaVersion`, `command`, `status`, `data`
  and structured `error` fields;
- stable exit-code categories;
- signal cancellation through `AbortSignal` for commands that use a transport.

The command tree is intentionally visible before each command is implemented.
Unimplemented commands return `command_not_implemented` and a non-zero exit
code; they never claim success.

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
atlas backups runs
atlas events
atlas events --tail
```

The default endpoint is `http://127.0.0.1:3000`. Set `ATLAS_BASE_URL` to use a
different HTTP endpoint. Public health responses are read directly. Protected
administrative responses require an already authenticated transport; the
default CLI transport does not forge Cloudflare Access assertions and reports
`authentication_required` in a partial `atlas status` result.

`atlas doctor` is read-only and never invokes a repair action. Its current
checks cover `/health/live`, `/health/server` and administrative overview
reachability; a failed administrative check is reported individually rather
than hidden behind a generic failure.

## Security boundary

The CLI must not forge Cloudflare Access assertions or bypass administrative
authorization. Read-only diagnostics may use a local adapter. Administrative
mutations require an explicit authenticated transport design before they are
enabled.

## Exit codes

| Code | Meaning                                           |
| ---- | ------------------------------------------------- |
| 0    | success                                           |
| 1    | operational failure                               |
| 2    | invalid arguments, unknown or unavailable command |
| 3    | authentication or authorization failure           |
| 4    | conflict or busy state                            |
| 5    | partial diagnostic failure                        |
| 130  | interrupted by SIGINT                             |

The JSON output is the machine contract. Human output is concise and may
evolve without being parsed by other Atlas components.
