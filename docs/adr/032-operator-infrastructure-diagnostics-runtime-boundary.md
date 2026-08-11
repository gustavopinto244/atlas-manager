# ADR-032 — Operator infrastructure diagnostics runtime boundary

Status: Accepted

Supersedes nothing. Resolves the open decision recorded as "Runtime diagnostic
implementation boundary (Node adapters versus shared Go report)" in
`docs/milestones/operator-experience/10-phase-traceability.md`. Extends
ADR-027 ("Operator CLI and dashboard"), ADR-028 ("CLI identity and privilege
boundary") and ADR-031 ("Authenticated mutating CLI transport"), and respects
the deployment-time isolation established by ADR-018 and ADR-030.

## Context

The Operator Experience milestone series shipped a mutating CLI and the
scheduling and backup mutations. Five CLI command nodes remained declared but
unimplemented — `atlas infra status`, `atlas infra listeners`, `atlas nginx
status`, `atlas nginx test`, `atlas tunnel status` — and two existing commands,
`atlas status` and `atlas doctor`, reported only what the HTTP surface could
already answer. The dashboard's Infrastructure page rendered the
`/admin/security/status` posture and nothing about the host.

The following facts were established against the source before this decision
was taken; they are the binding constraints, not background colour.

- **The CLI cannot inspect a host at all.** `tests/cli/no-direct-host-mutation.test.ts`
  scans every flat module under `src/cli/` and fails on any reference to
  `child_process`, `execFile`, `execSync`, `spawn`, a quoted `pm2`, `docker` or
  `systemctl` invocation, `sudo`, or `power-helper`; it additionally requires
  every import specifier in `src/cli/` to begin with `node:` or `./`. A host
  adapter therefore cannot be placed in the CLI even as a local-only fast path.
  This is not a lint preference — it is the structural reason the CLI can never
  become a second administration system, and it decides the "CLI/API split"
  question by itself.
- **Nothing in the live server inspects live host state today.** All host
  inspection in this repository lives in the Go deployment tooling
  (`deployment/internal/hostinspection`, `deployment/internal/systemdunit`,
  `deployment/internal/servicelifecycle`), which ADR-018 and ADR-030 keep
  deployment-time-only, root-run and packaged as a separate binary.
- **TypeScript already has a proven bounded-execution template.**
  `src/service-management/infrastructure/pm2-process-list-executor.ts` runs
  `execFile("pm2", ["jlist"], { encoding: "utf8", maxBuffer: 1_048_576,
shell: false, timeout: 5_000, windowsHide: true })` and classifies timeout,
  output-overflow and generic failure into typed error codes, with an
  injectable exec function so its tests never spawn a subprocess.
  `node-docker-container-inspect-executor.ts` follows the same shape.
- **`atlas doctor` already carries the partial-failure model** this decision
  extends: a fixed array of four independently `try`/`catch`-ed checks shaped
  `{ name, status: "pass" | "fail", code? }` with an overall `"pass" | "partial"`.
  It has never influenced the process exit code.
- **`src/cli/errors.ts` already maps `infrastructure_unavailable` to exit code
  5** (`partialFailure`), with an explicit comment that an ambiguous outcome
  must not share an exit code with definite failure. No new error code is
  needed.
- **The route catalog is closed and digest-pinned.**
  `src/http/administrative-route-security-catalog.ts` carried 47 descriptors;
  `docs/contracts/atlas-manager-administrative-api.json` pins their count,
  their ids and a `catalogSha256` that CI recomputes. `registerAdministrativeRoute`
  is the only production boundary permitted to add a route, and
  `reconcileAdministrativeRouteRegistrations` fails the process if a registered
  `/admin` route has no descriptor.
- **Zero Nginx or cloudflared configuration validation exists anywhere**, in
  TypeScript or in Go.
- **There is no "Task Manager" service and no port-3001 concept** anywhere in
  this repository.
- **The five stub commands currently fall through** the `switch` in
  `src/cli/http-transport.ts` to its `default` branch, which throws
  `AtlasCliError("command_not_implemented", ...)` — exit code 2
  (`invalidArguments`). Wiring them is purely additive: new `case` labels plus
  flipping `implemented` in `src/cli/command-tree.ts`.

The capability being decided is deliberately narrow: let Atlas **explain its
own infrastructure state** — systemd units, HTTP health, PM2, TCP listeners,
Nginx, cloudflared, schedulers, event history, power posture — safely and
remotely, replacing the manual shell checklist in `docs/operator-runbook.md`.
It is an observation capability and nothing else.

## Decision

### 1. Diagnostics are TypeScript adapters running in the live server process

New feature area `src/infrastructure-diagnostics/`, layered
`domain` / `application` / `ports` / `infrastructure` / `composition` like every
other feature area, composed into `src/http/create-administrative-runtime.ts`
the same way `powerSafetyReader` is composed today.

Every native invocation replicates the `pm2-process-list-executor.ts` template
exactly:

- a fixed bare executable name held in a module constant;
- a frozen argv array built entirely from constants — no string interpolation
  of any value, from any source, ever;
- `shell: false`;
- an explicit bounded `timeout`;
- an explicit bounded `maxBuffer`;
- typed classification of timeout, output-overflow, permission and
  missing-binary failures;
- an injectable exec (or file-read) function so tests never spawn a real
  subprocess and never read real host state.

No Go code is touched by this decision.

### 2. Rejected alternatives

**(a) Import `deployment/internal/servicelifecycle` into the live server.**
Rejected. ADR-018 and ADR-030 make that code root-run, deployment-time-only and
separately packaged on purpose. Importing it into a long-lived
non-root process would dissolve exactly the isolation those decisions bought,
and would drag a mutation-capable lifecycle API into a read-only feature.

**(b) A new shared Go diagnostic executable.** Rejected. There is no precedent
for a second runtime-time Go binary; it would add a packaging, build, signing
and test pipeline for no security benefit, because Node's `execFile` with
`shell: false`, a fixed argv, a timeout and a `maxBuffer` is already equivalent
in boundedness to what such a binary would provide.

**(c) A generic systemd inspector.** Rejected. The systemd port's `read()`
signature is the closed union `"atlas-manager" | "nginx" | "cloudflared"`, not
`string`. There is deliberately no reachable "inspect any unit" capability
anywhere in the system, and the type checker — not a runtime allowlist — is
what enforces it.

**(d) `nginx -T` directive extraction for ingress semantics.** Rejected for
this milestone; see §7.

**(e) One HTTP route per CLI command.** Rejected. The check subsets the five
commands need overlap heavily, and the project's stated preference is fewer,
coherent APIs. One report route is added; the command-specific views are
CLI-side filters over `checks[]` by id prefix.

**(f) Reusing the `operations.read` permission.** Rejected. Host, process and
network diagnostics are a materially wider read than the existing operational
summary. Conflating them would make future fine-grained scoping impossible
without a breaking permission change.

### 3. Diagnostic authority: the CLI never inspects a host

The CLI never executes a host tool — not remotely, and not when it happens to
be running on the Atlas host itself. Every diagnostic reaches the CLI through
`client.read(...)` against one protected administrative route. This is
structurally enforced by `tests/cli/no-direct-host-mutation.test.ts`, which
this milestone leaves completely unmodified.

A useful property falls out for free: **`atlas` always diagnoses the Atlas
host, never the operator's workstation.** There is no mode in which the two
could be confused.

Because the CLI may not import outside `src/cli/`, the check-id namespace it
filters on is a pinned copy in `src/cli/administrative-contract.ts`, kept
honest by the existing contract test in the same way route ids already are.

### 4. One new route, one new permission

`GET /admin/infrastructure/diagnostics` returns the whole report:
`{ generatedAt, overallStatus, checks: DiagnosticCheck[] }`.

- Activation flag: `ADMINISTRATIVE_INFRASTRUCTURE_DIAGNOSTICS_HTTP_ENABLED`.
- Operation: `read_infrastructure_diagnostics`.
- Permission: **`infrastructure.diagnostics.read`**, new and dedicated, granted
  to `auditor` and `administrator` — mirroring how `security.posture.read` is
  granted.
- Catalog entry built with the existing `read(...)` helper:
  `confirmationPolicy: "none"`, `gatePolicy: "none"`,
  `auditPolicy: "authorization_only"`, `replayPolicy: "read_only"`,
  `requestPolicy.body: "none"`.
- Registered through `registerAdministrativeRoute`, the sole permitted
  boundary. Authentication and authorization use the unchanged shared
  administrative middleware.

No other administrative route is added by this milestone.

### 5. Partial failure is enforced at four layers, independently

One failing check must never cancel, hide or downgrade another. This is
asserted separately at each layer, because each layer can break it on its own:

1. **Adapter aggregation** — every check is independently `try`/`catch`-ed into
   a fixed-order array regardless of outcome. The orchestrator runs checks with
   `Promise.allSettled` and then re-sorts results into a `CHECK_ORDER`
   constant, so the emitted order never depends on completion timing.
2. **HTTP** — the route answers `200` whenever it is reachable and the caller
   is authorized. A `5xx` is reserved for the route itself being unable to
   answer; a failing _check_ is never a failing _response_.
3. **CLI** — the exit code reflects `overallStatus`, but the full report body
   is always printed first. No check aborts the others early.
4. **Dashboard** — `renderInfrastructureDiagnostics()` iterates `checks[]` and
   renders each row independently. Whole-section `failed`/`stale` states remain
   reserved for a rejected fetch.

### 6. Status vocabulary and `overallStatus`

`DiagnosticStatus` is a five-value closed union: `ok`, `degraded`, `down`,
`disabled`, `unavailable`.

- `down` — the thing is supposed to be working and is not.
- `unavailable` — the diagnostic could not be determined (permission denied,
  binary missing, timeout). Explicitly _not_ the same as `down`.
- `disabled` — the capability is intentionally off.

`deriveOverallStatus()` is a single shared function, exported from the domain
and used verbatim by the HTTP layer, the CLI and the dashboard. It is never
reimplemented. Its algorithm:

- `disabled` checks are **excluded from the precedence computation entirely**.
  An intentionally-disabled capability must never make the report look
  unhealthy.
- If every check is `disabled` — or there are no checks — the overall status is
  `disabled`.
- Otherwise the overall status is the worst of the non-disabled subset, by the
  precedence `down` < `unavailable` < `degraded` < `ok`.

Check ids are a stable machine contract, namespaced and never display text:
`atlas.service`, `atlas.health.live`, `atlas.health.server`, `pm2.process`,
`listener.atlas`, `scheduler.backup`, `scheduler.power`,
`event_history.readiness`, `power.posture`, `nginx.service`, `nginx.config`,
`tunnel.cloudflared.service`.

(Operator Experience Phase 4 added `scheduler.service_availability`, following
this same namespaced/never-display-text contract, to close the scheduler
cursor visibility gap tracked in
`docs/reviews/operator-experience-final-gap-audit.md` item 4. The addition is
purely additive: no existing check id, ordering guarantee, or precedence rule
changed.)

### 7. Scope boundary: `nginx.config` is `nginx -t`, not ingress correctness

`nginx.config` runs `nginx -t` and reports whether the configuration parses and
tests successfully. On failure it extracts only the single
`nginx: [emerg] …` line, bounded to roughly 500 characters — never the full
stderr blob, which can contain paths and directive content.

It deliberately does **not** validate that requests are actually routed
correctly. `nginx -T`-based directive extraction was considered and rejected:
it requires a second, much larger subprocess call that dumps the entire merged
configuration, is far harder to bound safely against accidental content
disclosure, and has no precedent in this codebase. A hand-rolled regex parser
over arbitrary Nginx configuration is prohibited outright.

Operators must therefore read `atlas nginx status` / `atlas nginx test` as
"is Nginx running, and does its configuration parse" — not "are requests
reaching Atlas correctly." This boundary is repeated in
`docs/operator-runbook.md`.

### 8. Listener enumeration reads `/proc`, and spawns nothing

`listener.atlas` is answered by parsing `/proc/net/tcp` and `/proc/net/tcp6`
directly. This is strictly more bounded than `execFile("ss", …)`: there is no
PATH resolution, no subprocess, no timeout race, and the kernel caps the file
size. It relies on the standard Linux `/proc` layout, which matches Atlas's
documented deployment target.

The expected listener set is a composition-time parameter, defaulting to
Atlas's own configured `PORT` and nothing else. No second port is hardcoded;
there is no "Task Manager"/3001 concept in this system and none is invented
here. Resolving the owning PID would require elevated `/proc/<pid>/fd` access,
so it is best-effort only: its absence degrades the check to `degraded` with
"owner unresolved" and never fails it.

### 9. Security invariants

These are invariants, not guidance. Violating any of them is a defect.

- **Read-only, permanently, for this capability.** No `--fix`. No restart,
  reload, enable, disable, start or stop. No configuration mutation, no tunnel
  mutation, no port binding, no process signalling. Only read-only verbs are
  ever invoked: `systemctl show`, never `systemctl restart`; `nginx -t`, never
  `nginx -s reload`.
- **No implicit privilege escalation, ever.** `sudo` is never invoked and never
  suggested programmatically. A permission-denied result is a first-class
  diagnostic outcome — `status: "unavailable"` with `requiresPrivilege: true` —
  and it is terminal. Nothing retries with elevation.
- **No secrets in any diagnostic payload.** Specifically and exhaustively
  excluded: Cloudflare Access JWTs, tunnel tokens, tunnel certificate content,
  any full process environment, and any password or credential material.
  `observed`, `expected` and `hint` carry short structural facts only, never
  raw command output.
- Executable resolution stays bare-name and PATH-trusted, consistent with the
  existing `pm2` and `docker` adapters. No absolute-path hardening is
  introduced here; doing so for diagnostics alone while leaving the mutating
  PM2 adapter unhardened would be security theatre. If that hardening is ever
  wanted it is a separate decision covering all adapters at once.

### 10. Exit codes: an intentional behaviour change

`atlas doctor`, `atlas status` and the five new commands exit **5**
(`partialFailure`, via the existing `infrastructure_unavailable` mapping) when
the relevant `overallStatus` is `down` or `unavailable`. The error is raised
_after_ every check has completed and the full body has been rendered, never as
an early abort. `degraded` exits 0 with a printed warning. `disabled` always
exits 0.

This changes `atlas doctor`, which has always exited 0. That is deliberate: a
diagnostic that cannot fail a script is not usable in one. It is called out in
`docs/operator-runbook.md` and in the pull request that introduces it.

### 11. Testing obligations

- Every new adapter has a unit test driven by an injected exec or file-read
  function. No test spawns a real subprocess or reads real host state.
- The four partial-failure obligations of §5 are asserted at their own layers.
- `deriveOverallStatus()` is tested for: all-ok, one-down-among-ok,
  all-disabled (never `down`), mixed disabled-plus-degraded, empty input, and
  order preservation independent of input ordering.
- The route-catalog length assertion, the pinned API contract JSON and the
  CLI's pinned contract copy move in lockstep.

### 12. The repair boundary is closed

A future repair capability — restart, reload, re-enable — is **out of scope for
this ADR permanently**. It would require its own routes with a real mutation
gate, an exact confirmation policy and start/terminal audit, plus its own ADR.
The diagnostics route must never be silently upgraded into a mutation route,
and its `replayPolicy: "read_only"` descriptor is the tripwire that makes such
an upgrade fail the contract test rather than ship.

## Consequences

- Atlas can explain its own infrastructure remotely, over the same
  authenticated boundary as everything else, with no new administration path.
- The five stub commands become real; the CLI has no remaining stubs.
- Operators gain a scriptable failure signal from `atlas doctor` — and any
  existing script that relied on `doctor` always exiting 0 must be updated.
- `nginx.config` answers a narrower question than "is ingress correct". That
  gap is documented rather than papered over with an unbounded parser.
- One new permission exists that no role outside `auditor` and `administrator`
  holds, so the wider host read is separately grantable and separately
  revocable from `operations.read`.

## Consistency with prior decisions

- **ADR-003 / ADR-004** — the route reuses the unchanged Cloudflare Access
  authentication and the existing RBAC evaluation; it introduces no alternative
  identity path.
- **ADR-018 / ADR-030** — the root-run, deployment-time Go tooling stays
  exactly where it is; nothing from it is imported into the live server.
- **ADR-027** — the CLI and the dashboard remain presentation adapters over one
  protected administrative API, now including diagnostics.
- **ADR-028** — no implicit `sudo`, no secrets in `argv`, no direct host
  mutation from the CLI; all reaffirmed and left structurally enforced.
- **ADR-031** — the authenticated transport chosen there is the transport used
  here; diagnostics add reads to it and no mutations.
