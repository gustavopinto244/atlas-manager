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
