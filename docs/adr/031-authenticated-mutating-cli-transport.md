# ADR-031 — Authenticated mutating CLI transport

Status: Accepted

Supersedes nothing. Discharges the follow-up ADR required by ADR-027
("Privilege boundaries") and by ADR-028 ("Mutating commands").
Analysis: `docs/reviews/mutating-cli-threat-model.md`.

## Context

ADR-027 established that the `atlas` CLI and the dashboard are presentation
adapters over the same protected administrative API. ADR-028 accepted the
identity and privilege constraints for the CLI: no forged Cloudflare
assertions, no implicit `sudo`, no secrets in `argv`, no direct PM2/Docker/
systemd mutation, and — explicitly — **no mutating command until a separate ADR
chooses a concrete authenticated transport and end-to-end security tests
exist**.

ADR-028 listed two acceptable shapes without choosing between them:

1. an operator-authenticated HTTP session through the existing access boundary;
2. a deliberately scoped local IPC/OS identity boundary.

This ADR makes that choice. It is the last governance gate before
`atlas services start|stop|restart` can stop being stubs.

The constraint that dominates the decision is not "how do we make a CLI
mutation work". It is: **do not create a second administration system.** The
authority chain

```text
authenticated operator
  -> protected administrative boundary
  -> RBAC
  -> mutation admission
  -> application use case
  -> domain
  -> adapter
  -> audit
```

already exists, is tested, and is what the dashboard uses. Any transport that
re-implements a link in that chain is a regression regardless of how carefully
it is written.

## Decision

The `atlas` CLI performs administrative mutations by calling the **existing
protected administrative HTTP routes**, authenticated by an **externally issued
Cloudflare Access assertion** that the CLI only forwards.

Option 2 (local Unix-domain socket / IPC boundary) is **rejected**, not
deferred. See "Rejected alternatives".

### Identity source

The sole identity source is Cloudflare Access, exactly as for the dashboard
(ADR-004). The CLI:

- reads an assertion from the process environment variable
  `ATLAS_CLOUDFLARE_ACCESS_JWT` (or an injected value in tests);
- forwards it verbatim in the `Cf-Access-Jwt-Assertion` request header;
- never creates, signs, decodes, mutates or validates an assertion;
- never derives an identity from the Unix user, hostname, or any argument.

If no assertion is present the CLI still sends the request. The server decides.
The CLI must never pre-empt an authorization decision by declining to call.

### Authentication flow

```text
argv
  -> command parser                     (src/cli/parser.ts)
  -> command handler                    (src/cli/http-transport.ts)
  -> administrative client port         (src/cli/administrative-client.ts)
  -> HTTPS / loopback HTTP
  -> Cloudflare Access assertion verification
     (issuer, audience, signature, expiry)
  -> AuthenticateAdministrativeRequest -> AdministrativePrincipal
```

Verification remains entirely server-side and unchanged. A `401` is reported as
an authorization error with exit code 3. There is no retry, no refresh, no
credential prompt, and — critically — **no fallback to local execution**.

### Authorization flow

Unchanged and server-owned:
`AuthorizeAdministrativeOperation` resolves the principal's roles to an
`AdministrativePermission` derived from the route descriptor's
`AdministrativeOperation`. Service actions map to three _distinct_ permissions
(`services.start`, `services.stop`, `services.restart`), and the CLI inherits
that granularity rather than inventing its own. A `403` is reported as an
authorization error with exit code 3.

The CLI contains no permission check of any kind.

### Mutation flow

```text
POST /admin/services/:serviceId/actions/{start|stop|restart}
  Content-Type: application/json
  Cf-Access-Jwt-Assertion: <externally issued assertion, when present>
  {"confirmation":"confirm_registered_service_<operation>"}

  -> administrative request admission        (429 when saturated)
  -> exact confirmation validation           (400 on mismatch)
  -> AdministrativeServiceMutationGate       (409 when busy)
  -> ControlRegisteredService
  -> DispatchingServiceController
  -> PM2 / Docker / Compose adapter
  -> AdministrativeAuditTrail
```

Zero new administrative routes. The administrative route count stays at 47. The
CLI consumes the same `services.start`, `services.stop` and `services.restart`
descriptors the dashboard consumes.

The confirmation string is **not** duplicated as a CLI literal. It is derived
from the canonical route descriptor's `confirmationPolicy`
(`exact:<confirmation>`) in the security catalog, and a contract test asserts
that the CLI's binding and the catalog agree for every mutation the CLI can
perform. Because the operator package ships only `dist/cli`, the CLI cannot
import the server catalog at runtime; the binding is therefore a small declared
table in `src/cli/administrative-contract.ts` that the contract test pins to the
catalog. Drift fails the build, not production.

### Audit identity

The audit principal is the verified `AdministrativePrincipal` produced by
assertion verification at the server boundary. It is never the shell username,
the hostname, or any CLI argument.

A CLI mutation and a dashboard mutation therefore produce the **same event
class with the same principal**. The audit schema is not extended: presentation
source is deliberately _not_ recorded, because doing so would add a field with
no authorization meaning and invite consumers to treat it as one.

### Credential handling

- Origin: externally issued by Cloudflare Access. The CLI never mints one.
- Transport into the CLI: the `ATLAS_CLOUDFLARE_ACCESS_JWT` environment
  variable only. Never `argv`. No `--jwt`, `--token`, `--password` option
  exists, and none may be added.
- Placement: the `Cf-Access-Jwt-Assertion` header only. Never a query string,
  path segment, fragment, cookie, or request body.
- Lifetime in process: held in a closure for the duration of the process; not
  written to disk, not cached, not refreshed.
- Persistence: **none**. This milestone adds no credential store. A persistent
  store or refresh flow requires its own ADR.
- Disclosure: never logged, printed, included in an error message, included in
  the JSON envelope, or included in debug output.

### Base-URL and credential-forwarding policy

`ATLAS_BASE_URL` decides where a credential may travel:

| Base URL                                                 | Reads                    | Mutations                          |
| -------------------------------------------------------- | ------------------------ | ---------------------------------- |
| `https://…`                                              | credential sent          | allowed                            |
| `http://` loopback (`localhost`, `127.0.0.0/8`, `[::1]`) | credential sent          | allowed                            |
| `http://` non-loopback                                   | credential **withheld**  | **refused** (`insecure_transport`) |
| URL containing userinfo                                  | rejected at construction | rejected at construction           |
| non-HTTP(S) scheme                                       | rejected                 | rejected                           |

Plaintext HTTP to a non-loopback host never carries the assertion, for reads or
mutations, and a mutation against such a base URL fails closed before any
network activity. Loopback HTTP remains permitted for backward compatibility
with local read-only operation and local qualification.

### Redirect behaviour

All administrative requests use `redirect: "error"`. The CLI never follows a
redirect, so a compliant `fetch` cannot re-send the `Cf-Access-Jwt-Assertion`
header to a location chosen by the server. A redirect is surfaced as a
transport error, not silently followed.

### Replay and idempotency properties

The route descriptors classify `services.start`, `services.stop` and
`services.restart` as `replayPolicy: "state_recheck_required"`. The CLI honours
this literally:

- it never retries a mutation automatically;
- a transport-level failure is not treated as evidence that the mutation did
  not occur;
- timeouts do not trigger retries.

Where the underlying network error proves the request was never delivered
(connection refused, DNS failure), the CLI reports an unavailable
infrastructure error. In every other failure case it reports an **indeterminate
outcome** and directs the operator to re-read authoritative state. This is the
only honest classification available at the transport layer.

### Authoritative re-read

After a mutation returns success, the CLI re-reads
`GET /admin/services/:serviceId` and reports the authoritative current state
alongside the accepted operation. Success is never claimed from an HTTP status
alone. If the re-read fails, the mutation is still reported as accepted and the
state is reported as unknown; the command does not fail, because the mutation
did succeed.

### Local and remote behaviour

Identical. The same code path, the same credential rule and the same error
mapping apply whether `ATLAS_BASE_URL` points at loopback or at the public
administrative origin. There is no "local mode".

### Error behaviour

| Condition                                            | CLI error code                         | Exit |
| ---------------------------------------------------- | -------------------------------------- | ---- |
| 401 / 403                                            | `administrative_access_denied`         | 3    |
| 404 `registered_service_not_found`                   | `service_not_found`                    | 1    |
| 422 `administrative_service_operation_not_supported` | `service_operation_unsupported`        | 1    |
| 409 (mutation gate busy)                             | `operation_conflict`                   | 4    |
| 429 (administrative admission)                       | `operation_conflict`                   | 4    |
| 400 (rejected request contract)                      | `service_operation_failed`             | 1    |
| 5xx                                                  | `service_operation_failed`             | 1    |
| malformed / non-JSON / oversized response            | `service_operation_failed`             | 1    |
| non-loopback plaintext HTTP mutation                 | `insecure_transport`                   | 2    |
| proven-undelivered network failure                   | `infrastructure_unavailable`           | 5    |
| possibly-delivered network failure, timeout          | `mutation_outcome_unknown`             | 5    |
| SIGINT before dispatch                               | `interrupted`                          | 130  |
| SIGINT after possible dispatch                       | `mutation_interrupted_outcome_unknown` | 130  |

The pre-existing exit-code contract (0/1/2/3/4/5/130) is unchanged.

### Security invariants

This ADR changes no server invariant. The following remain exactly as they are
and are authoritative over CLI convenience:

Cloudflare Access verification; Host validation; Origin policy; RBAC; mutation
gates; concurrency gates; audit; strict JSON request parsing; body limits;
request-target limits; bounded responses.

The CLI adapts to the server. Any change that would relax one of these to make
a command easier to implement is out of scope for this ADR and is a defect.

### Scope of this ADR

In scope: `atlas services start|stop|restart`.

Out of scope, requiring no further ADR but a subsequent implementation slice:
schedule mutations, backup mutations. They reuse this transport unchanged.

Out of scope entirely: power mutations (`shutdown`, `reboot`, wake effects)
remain absent from the CLI. Physical power stays a separate track under its own
ADRs.

## Rejected alternatives

- **Host-local Unix-domain socket / IPC gateway.** Requires a second
  authorization system and a uid→principal mapping, degrading audit identity
  from a verified administrative principal to a locally maintained table; breaks
  mutual exclusion with dashboard mutations unless the mutation gate is shared
  or duplicated; eliminates remote operation, the primary use case; and adds a
  permanent local privilege-escalation surface (socket mode, symlink and stale-
  socket handling) whose failure mode is a silent bypass rather than a visible
  error. Its only substantive advantage — independence from Cloudflare Access
  availability — is an availability trade, not a security gain, and is better
  addressed by an explicit break-glass procedure if it ever becomes necessary.
  Full analysis: `docs/reviews/mutating-cli-threat-model.md`.

- **A CLI-specific mutation API** (e.g. `POST /admin/cli/services/start`).
  Duplicates a route that already exists, doubles the contract surface, and
  creates two places for authorization and confirmation policy to drift apart.

- **A CLI-issued session/token endpoint.** Would require a new administrative
  route, a new credential lifecycle, a new revocation story and a new secret at
  rest, to replace a credential the operator already has.

- **Accepting the assertion as a command-line argument.** Exposes it in
  `/proc/*/cmdline` and shell history. Prohibited by ADR-028.

- **Treating the Unix user as the administrative principal.** Prohibited by
  ADR-028; produces plausible-but-wrong audit attribution.

- **Falling back to direct PM2/Docker/systemd execution when the HTTP mutation
  fails.** This is the single most dangerous shortcut available and is
  forbidden: it would bypass authentication, RBAC, mutation admission and audit
  precisely at the moment those controls said no. A regression test forbids
  process execution anywhere in `src/cli/`.

- **Automatic retry on transport failure.** Service start/stop/restart are not
  idempotent under `state_recheck_required`. A retry after a lost response can
  execute the operation twice.

## Consequences

- `atlas services start|stop|restart` become implemented commands with no new
  administrative route and no new authorization code.
- CLI mutations are unavailable when Cloudflare Access is unavailable — the
  same condition under which dashboard mutations are unavailable.
- Operators must supply `ATLAS_CLOUDFLARE_ACCESS_JWT` for mutations; there is no
  interactive login in this milestone.
- Schedule and backup mutations become a mechanical follow-up slice rather than
  an architectural question.
- The indeterminate-outcome result class is new operator-facing vocabulary and
  must be documented in the CLI runbook.
- The CLI↔catalog confirmation binding must be kept pinned by its contract
  test; adding a mutation command without updating the binding fails the suite.

## Tests required

Implemented in `tests/cli/administrative-client.test.ts`,
`tests/cli/service-mutations.test.ts`,
`tests/cli/mutating-transport-security.test.ts`,
`tests/cli/no-direct-host-mutation.test.ts` and
`tests/http/administrative-service-mutation-cli-parity.test.ts`:

1. missing, invalid, expired, wrong-issuer and wrong-audience credentials each
   yield exit 3 with no local fallback;
2. unauthorized role (403) yields exit 3; authorized role succeeds once;
3. the credential appears only in the `Cf-Access-Jwt-Assertion` header — never
   in the URL, stdout, stderr, the JSON envelope or an error message;
4. `redirect: "error"` is set on every administrative request;
5. non-loopback plaintext HTTP refuses a mutation before any network call;
6. 409 and 429 map to exit 4 and issue exactly one request;
7. a possibly-delivered transport failure or timeout yields an indeterminate
   outcome, exit 5, and exactly one request;
8. a proven-undelivered failure yields `infrastructure_unavailable`;
9. SIGINT before and after dispatch produce their distinct results, both exit
   130;
10. success triggers exactly one authoritative re-read; a failed re-read still
    reports the mutation as accepted with unknown state;
11. unknown service ids and unsupported operations map to stable codes;
12. the CLI confirmation binding equals the route security catalog;
13. a CLI mutation and a dashboard mutation produce the same audited event
    class and principal;
14. no `src/cli/` module references `pm2`, `docker`, `systemctl`, `sudo` or
    `node:child_process`.
