# Operator runbook

Use the official CLI for routine inspection. The dashboard is available at the
protected administrative hostname after Cloudflare Access authentication.

## Routine commands

```text
atlas status
atlas health
atlas doctor
atlas services list
atlas services status task-manager
atlas services schedule show task-manager
atlas services schedule preview task-manager
```

Use `--json` when another tool needs the result. Do not parse human output.
The CLI never forges Cloudflare Access assertions; administrative reads require
an authorized transport.

## Dashboard workflow

Open Overview for aggregate health, Services for registered service state,
Schedules for weekly availability, Backups for backup state and Events for
audit history. Start/stop/restart actions require explicit confirmation and
are reread after completion.

## Break-glass troubleshooting

Only when the CLI is unavailable, inspect the low-level services directly:

```text
systemctl is-active atlas-manager.service
curl --fail http://127.0.0.1:3000/health/live
curl --fail http://127.0.0.1:3000/health/server
nginx -t
systemctl is-active nginx.service
systemctl is-active cloudflared.service
```

Do not use break-glass commands to bypass administrative authentication or to
enable physical power effects. Preserve loopback listeners and the existing
Cloudflare Access → Tunnel → Nginx → Atlas architecture.
