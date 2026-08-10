# Mutating CLI transport — threat model

Prepared at: 2026-08-10
Baseline commit: `1d97f6c4b7fd2bb09ed9dba75c3a04e905b479de` (`main`, 1.0.0-rc.13)
Decides: `docs/adr/031-authenticated-mutating-cli-transport.md`
Constrained by: ADR-003, ADR-004, ADR-025, ADR-027, ADR-028

## Scope

ADR-028 fixed _what a mutating CLI may not do_. It deliberately left the
concrete transport open, listing two acceptable shapes. This document performs
the analysis ADR-028 requires before that choice can be made.

The asset being protected is the **administrative mutation authority** of Atlas
Manager: the ability to start, stop or restart a registered service, and later
to change availability policy or run backups. The authority chain that must
survive any transport choice is:

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

## Options under evaluation

### Option A — operator-authenticated HTTP through the existing administrative boundary

```text
atlas CLI
  -> externally issued Cloudflare Access assertion (ATLAS_CLOUDFLARE_ACCESS_JWT)
  -> HTTPS to the protected administrative API
  -> Cloudflare Access assertion verification (issuer, audience, expiry, signature)
  -> AuthenticateAdministrativeRequest -> AdministrativePrincipal
  -> AuthorizeAdministrativeOperation (RBAC permission)
  -> route confirmation policy + AdministrativeServiceMutationGate
  -> ControlRegisteredService -> DispatchingServiceController -> adapter
  -> AdministrativeAuditTrail
```

The CLI adds nothing to the chain. It is a second presentation adapter in front
of the same routes the dashboard already calls.

### Option B — host-local Unix-domain socket / IPC boundary

```text
atlas CLI
  -> connect(2) to /run/atlas-manager/admin.sock
  -> SO_PEERCRED -> uid/gid
  -> uid -> administrative principal mapping table
  -> local mutation gateway
  -> RBAC equivalent
  -> mutation gate
  -> application use case -> domain -> adapter
  -> audit
```

This requires a new listener, a new principal mapping, a new authorization
evaluation point and a new audit identity kind.

## Threat analysis

| #   | Threat                                                              | Option A                                                                                                                                                                                                                                                                                                                                                                           | Option B                                                                                                                                                                                                                                                                                     |
| --- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Credential theft**                                                | A stolen Access JWT grants the thief the operator's full administrative authority until expiry. Mitigated by short Access token lifetimes, issuer/audience binding and server-side revocation at the identity provider. The CLI holds the value only in process memory.                                                                                                            | No bearer credential exists to steal; but stealing the _uid_ is equivalent to compromising the operator's shell account, which also yields the socket. Net: comparable, different failure shape.                                                                                             |
| 2   | **Credential replay**                                               | The assertion is replayable within its validity window by anyone who obtains it — this is the standing property of the Access deployment the dashboard already depends on. No new exposure.                                                                                                                                                                                        | No credential to replay; socket access is re-evaluated per connection. Advantage B.                                                                                                                                                                                                          |
| 3   | **Process-list exposure (`ps`, `/proc/*/cmdline`)**                 | Prohibited by construction: the assertion is read from the environment, never from `argv`. No `--jwt`, `--token` or `--password` option exists or may be added.                                                                                                                                                                                                                    | No credential in argv either. Tie.                                                                                                                                                                                                                                                           |
| 4   | **Environment leakage (`/proc/PID/environ`, crash dumps, CI logs)** | Real risk. `/proc/PID/environ` is readable by the same uid and by root. Mitigation: the value is never echoed, logged, embedded in errors, included in JSON output, or persisted. Same-uid exposure is not a privilege boundary the CLI can defend.                                                                                                                                | Not applicable. Advantage B.                                                                                                                                                                                                                                                                 |
| 5   | **Shell-history exposure**                                          | Zero, because the credential never appears on a command line. An operator who writes `ATLAS_CLOUDFLARE_ACCESS_JWT=… atlas …` inline does put it in history; documented as an anti-pattern.                                                                                                                                                                                         | Not applicable. Slight advantage B.                                                                                                                                                                                                                                                          |
| 6   | **Filesystem credential persistence**                               | The CLI writes no credential store, cache, cookie jar or token file in this milestone. Nothing to steal at rest.                                                                                                                                                                                                                                                                   | No store. Tie.                                                                                                                                                                                                                                                                               |
| 7   | **Cross-user access**                                               | Another local user cannot read the operator's environment. They can, however, use their own valid Access identity — which is the intended behaviour, subject to their own RBAC roles.                                                                                                                                                                                              | A socket with permissive modes (`0666`, or a group with unexpected members) silently grants administrative mutation to every local account. This is a _new_ privilege-escalation surface that must be gotten right at install time, on every host, forever. **Material disadvantage B.**     |
| 8   | **Symlink / path attack**                                           | Not applicable; no filesystem artifact.                                                                                                                                                                                                                                                                                                                                            | Real: the socket path, its parent directory and any pid/lock files must be created with `O_NOFOLLOW` semantics on a directory not writable by non-root, or a local user can pre-create a path and man-in-the-middle the administrative channel. **Material disadvantage B.**                 |
| 9   | **Socket permissions**                                              | Not applicable.                                                                                                                                                                                                                                                                                                                                                                    | Requires correct uid/gid/mode, correct `umask` at bind time, correct behaviour on restart and on stale-socket cleanup. Every one of these is an operational failure mode that produces a silent authorization bypass rather than a visible error. **Material disadvantage B.**               |
| 10  | **CSRF applicability**                                              | Applicable to the boundary and already handled: the administrative envelope enforces its Origin policy and the routes require an exact confirmation body. The CLI is not a browser and sends no ambient cookies, so it neither weakens nor depends on this.                                                                                                                        | Not applicable — but that is not a gain, because the browser-facing boundary still exists and still needs the protection.                                                                                                                                                                    |
| 11  | **Origin applicability**                                            | Enforced server-side, unchanged. The CLI sends no `Origin`; the existing policy permits that for non-browser clients exactly as it does today for read-only CLI traffic.                                                                                                                                                                                                           | Would need a second, independent equivalent, or a documented argument for why none is needed.                                                                                                                                                                                                |
| 12  | **Host validation**                                                 | Enforced server-side, unchanged. The CLI's `ATLAS_BASE_URL` must name the real administrative host or the request is rejected — which is a _feature_, since it prevents a misconfigured base URL from silently succeeding.                                                                                                                                                         | Bypasses Host validation entirely by not being HTTP. A second gap to reason about.                                                                                                                                                                                                           |
| 13  | **Cloudflare dependency**                                           | Hard dependency: no Access identity, no CLI mutation. If Cloudflare Access is down, mutations are unavailable from both the CLI and the dashboard simultaneously. This is a genuine availability cost.                                                                                                                                                                             | Independent of Cloudflare; would keep working during an Access outage. **Genuine advantage B** — the only one of substance.                                                                                                                                                                  |
| 14  | **Remote operation**                                                | Works unchanged from any host, which is the primary operator use case (the operator is not usually sitting on Atlas).                                                                                                                                                                                                                                                              | Impossible without SSH. `ssh atlas atlas services restart x` reintroduces every shell-session risk ADR-028 rejected, and makes the audit principal the SSH account rather than the administrative identity. **Material disadvantage B.**                                                     |
| 15  | **Local operation**                                                 | Works: `ATLAS_BASE_URL=http://127.0.0.1:3000`. Loopback HTTP is permitted; non-loopback plaintext HTTP is refused for mutations so a credential can never leave the host in the clear.                                                                                                                                                                                             | Works. Tie for the local case only.                                                                                                                                                                                                                                                          |
| 16  | **Audit identity quality**                                          | Highest available: the audit principal is the verified `AdministrativePrincipal` produced by assertion verification — byte-identical to what the dashboard produces. A CLI mutation and a dashboard mutation are indistinguishable in the event history except by intent, which is correct.                                                                                        | Degraded: the audit principal would be a uid mapped through a locally maintained table. A stale table entry, a recycled uid or a shared service account silently produces a _wrong but plausible_ audit record. Wrong attribution is worse than no attribution. **Material disadvantage B.** |
| 17  | **RBAC mapping**                                                    | None needed. The existing `AdministrativePermission` model (`services.start`, `services.stop`, `services.restart` as three distinct permissions) applies verbatim.                                                                                                                                                                                                                 | Requires a second authorization system, or a uid→role bridge into the first. ADR-028 and ADR-027 both forbid creating a second authorization system. **Disqualifying for B.**                                                                                                                |
| 18  | **Replay protection**                                               | Inherited from the route `replayPolicy` (`state_recheck_required` for service actions) plus the single-slot `AdministrativeServiceMutationGate`. Unchanged.                                                                                                                                                                                                                        | Would need the same gate reached through a different path — duplicated enforcement, duplicated drift risk.                                                                                                                                                                                   |
| 19  | **Session expiry**                                                  | Provided by the Access assertion's `exp`. On expiry the server returns 401 and the CLI reports an authorization error; it does not retry, refresh or fall back.                                                                                                                                                                                                                    | No expiry concept. A compromised shell session retains mutation authority indefinitely. **Disadvantage B.**                                                                                                                                                                                  |
| 20  | **Revocation**                                                      | Provided by the identity provider: revoking the operator's Access entitlement stops CLI mutations at the next request, with no Atlas-side change.                                                                                                                                                                                                                                  | Revocation means editing a mapping file on the host and reloading it. Slow, manual, easy to forget. **Disadvantage B.**                                                                                                                                                                      |
| 21  | **Privilege escalation**                                            | The CLI holds no privilege of its own. It cannot exceed the authority its assertion carries; the server decides.                                                                                                                                                                                                                                                                   | The socket _is_ a privilege-granting artifact living on the host. Every bug in its permission handling is an escalation from "can log in" to "can mutate production services".                                                                                                               |
| 22  | **sudo interaction**                                                | None. No mutation path touches `sudo`. Privilege stays behind the server-side adapters.                                                                                                                                                                                                                                                                                            | None required, but the temptation to run the gateway as root to reach PM2/systemd is exactly the pressure ADR-028 warns about.                                                                                                                                                               |
| 23  | **Concurrency**                                                     | Fully inherited: `AdministrativeRequestAdmission` (429) and `AdministrativeServiceMutationGate` (409) apply identically to CLI and dashboard traffic, so a CLI restart and a dashboard restart contend correctly.                                                                                                                                                                  | A separate gateway process would need to share the same in-process gate, which it cannot do without either being in the same process or reimplementing the gate — the latter breaks mutual exclusion between CLI and dashboard mutations. **Material disadvantage B.**                       |
| 24  | **Operator error**                                                  | The dominant realistic risk. Mitigated by: exact service-id matching (no prefix/fuzzy resolution), rejection of unexpected arguments, refusal to accept `--pm2`/`--container`/`--unit` escape hatches, canonical confirmation derived from the route policy, and an authoritative state re-read after every mutation so the operator sees the real result rather than an HTTP 200. | Same mitigations would be needed, plus the new failure mode of pointing at the wrong host's socket without noticing.                                                                                                                                                                         |
| 25  | **Headless usage**                                                  | Natural: CI/automation supplies `ATLAS_CLOUDFLARE_ACCESS_JWT` from a secret store as an environment variable and uses `--json`.                                                                                                                                                                                                                                                    | Requires shell access to the host, which most automation should not have.                                                                                                                                                                                                                    |

## Weighting

Option B wins on exactly three points: environment leakage (#4), Cloudflare
availability coupling (#13) and credential replay (#2). Two of those three are
consequences of _having a bearer credential at all_, and the third is an
availability trade, not a security one.

Option B loses on eight points that matter more, four of which are structural
rather than fixable-with-care:

- **#17 RBAC mapping** and **#16 audit identity** would require a second
  authorization system and a second, weaker notion of principal. ADR-027's
  rejected-alternatives list and ADR-028's decision both explicitly forbid
  this. This alone disqualifies Option B on governance grounds.
- **#23 concurrency** would break mutual exclusion between CLI and dashboard
  mutations, or force the gate to be reimplemented — a correctness regression in
  the mutation-admission layer.
- **#14 remote operation** removes the primary use case.
- **#7/#8/#9** add a permanent local privilege-escalation surface whose failure
  mode is a silent bypass.

The decisive asymmetry is that Option A's risks are **inherited and already
accepted** — the dashboard has depended on exactly this credential model since
ADR-004, and nothing about a second presentation adapter makes them worse —
while Option B's risks are **newly created**.

## Decision

**Option A.** The `atlas` CLI mutates through the existing protected
administrative HTTP boundary, forwarding an externally issued Cloudflare Access
assertion supplied via `ATLAS_CLOUDFLARE_ACCESS_JWT`. No second authentication
stack, no second authorization system, no new administrative route, no new
audit identity kind.

Option B is rejected, not deferred. If Cloudflare Access unavailability ever
becomes an operational problem worth solving, the correct answer is a break-glass
procedure with its own ADR and its own audit semantics — not a permanently
mounted local mutation socket.

## Residual risks accepted

| Risk                                                                | Why accepted                                                                                                                    | Compensating control                                                                                                                                                                                                     |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Access JWT readable via `/proc/PID/environ` by the same uid or root | Same-uid access is not a boundary the CLI can defend; an attacker with that access can also read the operator's browser session | Never logged, printed, embedded in errors, returned in JSON, or persisted; short assertion lifetime; IdP-side revocation                                                                                                 |
| Bearer assertion is replayable within its validity window           | Pre-existing property of ADR-004's Access model, shared with the dashboard                                                      | Short `exp`; server-side issuer/audience/signature verification; mutation gate limits concurrent effect                                                                                                                  |
| CLI mutations unavailable during a Cloudflare Access outage         | Dashboard mutations are equally unavailable; availability parity is acceptable and honest                                       | Documented; a future break-glass ADR may address it explicitly                                                                                                                                                           |
| Operator sets `ATLAS_BASE_URL` to a host they do not control        | Would leak the assertion to that host                                                                                           | Mutations refuse non-loopback plaintext HTTP; redirects are refused outright (`redirect: "error"`) so a compliant server cannot bounce the credential cross-origin; base URLs carrying embedded credentials are rejected |
| Response lost after a mutation was dispatched                       | Genuinely undecidable at the transport layer                                                                                    | The CLI never reports "definitely failed" and never auto-retries a non-idempotent mutation; it reports an indeterminate outcome and directs the operator to `atlas services status <id>`                                 |

## Required security tests

Enumerated here and implemented in this milestone:

1. missing credential → server 401 → `administrative_access_denied`, exit 3;
2. invalid credential (bad signature) → 401 → exit 3, no fallback;
3. expired credential → 401 → exit 3;
4. wrong issuer → 401 → exit 3;
5. wrong audience → 401 → exit 3;
6. valid credential, unauthorized role → 403 → exit 3, no local execution;
7. valid credential, authorized role → 200 → mutation performed once;
8. credential never appears in the request URL, in any output stream, or in any
   error message;
9. cross-origin redirect cannot carry the credential (`redirect: "error"`);
10. plaintext non-loopback base URL refuses to carry a mutation;
11. conflict (409) and busy (429) map to exit 4 without retry;
12. transport failure after possible dispatch yields an indeterminate result and
    no automatic retry;
13. SIGINT before dispatch cancels cleanly; SIGINT after possible dispatch
    reports an indeterminate outcome;
14. audit: a CLI mutation produces the same event class and the same principal
    kind as a dashboard mutation.
