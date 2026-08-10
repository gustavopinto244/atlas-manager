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

## Additional read-only commands

Beyond the routine set above, the CLI exposes a full read surface. See
[`docs/cli.md`](cli.md) for the complete, authoritative list; the operationally
relevant ones not already covered above:

```text
atlas services logs <service-id>       # protected log read, adapter-owned

atlas backups list                     # registered backup targets
atlas backups status                   # backup subsystem summary
atlas backups runs                     # recent run history
atlas backups run-status <run-id>      # a single run's terminal result
atlas backups schedule show <target-id>
atlas backups retention show <target-id>

atlas machine status                   # authoritative operating policy
atlas machine plan                     # machine power plan
atlas machine schedule show            # read-only; no machine schedule mutation exists

atlas events                           # recent administrative event history
atlas events --tail                    # a larger single page (100 vs. 20); not streaming
```

## Mutating commands

Every mutating command requires an externally issued Cloudflare Access
assertion in `ATLAS_CLOUDFLARE_ACCESS_JWT` and calls the same protected
administrative route the dashboard calls — same RBAC, same exact
confirmation, same mutation gate, same audit event with the same principal.
None of these commands accept a bypass flag (`--force`, `--yes`,
`--no-confirm`): the server-side confirmation token is the only accepted
authorization. See [`docs/cli.md`](cli.md#mutating-commands) for the full
behavioral contract (no retries, no fallback to PM2/Docker/systemd,
transport-security requirements, authoritative re-read semantics).

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

Operational notes:

- `services start/stop/restart` only accept a registered service id — never a
  PM2/container/unit name. After a successful mutation the CLI re-reads
  `GET /admin/services/<id>` and reports the real state; a lost or timed-out
  response is reported as `mutation_outcome_unknown` (exit 5), never retried
  and never claimed as failed. Run `atlas services status <id>` to resolve it.
- `services schedule remove` is **not** the same as `services schedule
disable`: `remove` deletes the stored override entirely, falling back to
  the service's statically configured default policy (which may not be
  `always`); `disable` writes an explicit stored `disabled` policy.
- `backups run <target-id>` is synchronous — it blocks until the run is
  terminal and that response is the authoritative result (bounded at five
  minutes, never unbounded). If the outcome is lost, use `atlas backups runs`
  and `atlas backups run-status <run-id>` to recover it.
- `backups retention prune` is the most consequential command here. Its exit
  code reflects the server's own `result`, not the HTTP status: `completed`
  (0), `partial` (1, with counts for how much ran), `busy`/`blocked` (5, may
  have partially deleted artifacts).
- `backups scheduler tick` is deliberately **not** exposed as an operator
  command — it is cron-triggered maintenance whose correctness depends on not
  being invoked ad hoc.
- There is no machine schedule mutation command (`machine schedule show` is
  read-only); machine schedule persistence is explicitly out of scope pending
  a dedicated ADR (see `docs/reviews/operator-experience-final-gap-audit.md`
  item 9).

## Infrastructure diagnostics

These are the primary troubleshooting path. They ask the running Atlas server
to describe its own infrastructure over the same authenticated administrative
boundary as everything else.

```text
atlas infra status        # the whole report: units, health, listeners, schedulers, edge
atlas infra listeners     # is Atlas's configured port actually being served, and how
atlas nginx status        # the nginx unit plus its configuration test
atlas nginx test          # the configuration test alone
atlas tunnel status       # the cloudflared unit
atlas doctor              # HTTP checks plus the full diagnostic report
```

They require the `infrastructure.diagnostics.read` permission, held by the
`auditor` and `administrator` roles, and the
`ADMINISTRATIVE_INFRASTRUCTURE_DIAGNOSTICS_HTTP_ENABLED` activation flag.

**`atlas` always diagnoses the Atlas host, never your workstation.** The CLI
cannot execute a host tool — it only makes an authenticated HTTP request — so
there is no mode in which the two could be confused.

### What the statuses mean

| Status        | Meaning                                                                |
| ------------- | ---------------------------------------------------------------------- |
| `ok`          | Observed and healthy.                                                  |
| `degraded`    | Working, but not as expected — for example a wider bind than intended. |
| `down`        | Supposed to be working and is not.                                     |
| `unavailable` | The diagnostic could not be determined. **Not** the same as `down`.    |
| `disabled`    | Intentionally switched off. Never counted as unhealthy.                |

An `unavailable` check often means Atlas lacks the privilege to look; the check
then carries `requiresPrivilege: true`. **Atlas never escalates privilege on
your behalf and never runs `sudo`.** Grant the access deliberately, or accept
that the check stays undetermined.

### Exit codes — a behaviour change

`atlas doctor` previously always exited 0. It no longer does.

| Overall status          | Exit code                           |
| ----------------------- | ----------------------------------- |
| `down` or `unavailable` | **5** (`partialFailure`)            |
| `degraded`              | 0, with a warning printed to stderr |
| `ok` or `disabled`      | 0                                   |

This applies to `atlas doctor`, `atlas status` and the five diagnostics
commands above. **Any script that relied on `atlas doctor` always exiting 0
must be updated.**

The full report is always printed before the exit code is decided — a failing
check never suppresses the checks around it, at any layer. For `doctor` and
`status` specifically, a diagnostics capability that is simply not enabled
reads as `disabled` and still exits 0, so those two commands keep working on a
deployment that never turned the flag on.

### Scope boundary: `nginx test` is not an ingress check

`atlas nginx status` and `atlas nginx test` run `nginx -t`. They answer **"is
nginx running, and does its configuration parse?"** — not **"are requests
actually reaching Atlas correctly?"**

Semantic ingress validation is deliberately out of scope (ADR-032 §7). A
passing `nginx test` with a still-unreachable dashboard means the fault is in
routing, DNS, the tunnel or Access — not in configuration syntax. Check
`atlas tunnel status` and the Cloudflare Access configuration next.

### Diagnostics never repair

There is no `--fix`, and no restart, reload, enable or disable in any
diagnostics command or on the dashboard's Infrastructure page. This is
permanent (ADR-032 §12): a repair capability would need its own routes with a
real mutation gate, confirmation and audit, plus its own ADR. Use
`atlas services restart <id>` for registered services, or the break-glass
commands below for the host units themselves.

## Dashboard workflow

Open Overview for aggregate health, Services for registered service state,
Schedules for weekly availability, Backups for backup state and Events for
audit history. Start/stop/restart actions require explicit confirmation and
are reread after completion.

Infrastructure shows the security posture and the full diagnostic report, one
independently-rendered row per check. It is not in the 30-second auto-poll set:
it refreshes on a manual refresh, which is also when the `nginx -t` probe runs.

## Break-glass troubleshooting

Only when the CLI itself cannot reach the server — the diagnostics commands
above cover every check below and do not require shell access to the host:

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
