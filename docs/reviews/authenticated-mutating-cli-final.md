# Authenticated mutating CLI — final report

2026-08-10

## Source baseline

| Field                        | Value                                                                                   |
| ---------------------------- | --------------------------------------------------------------------------------------- |
| `INITIAL_HEAD`               | `1d97f6c4b7fd2bb09ed9dba75c3a04e905b479de` (`origin/main`, confirmed by `git fetch`)    |
| Baseline commit              | feat: complete Operator Experience scheduling milestone (Slice 4 + reconciliation) #316 |
| `PACKAGE_VERSION`            | `1.0.0-rc.13` (unchanged by this milestone — see "Release decision")                    |
| Branch                       | `feat/authenticated-mutating-cli`                                                       |
| Baseline suite               | 231 test files, 2905 passed, 3 skipped                                                  |
| `ADMINISTRATIVE_ROUTE_COUNT` | 47 before and after                                                                     |

`origin/main` had not advanced past the SHA named in the task, so the observed
baseline was used directly rather than the prompt's assertion of it.

## Governance divergences found and corrected

1. **"ADR-028 does not exist" / "mutations are blocked on ADR-028".**
   `docs/adr/028-cli-identity-and-privilege-boundary.md` existed with
   `Status: Accepted`. The claim appeared in
   `docs/reviews/operator-experience-current-state.md`,
   `docs/milestones/operator-experience/02-cli.md`,
   `.../10-phase-traceability.md`, `.../README.md` and
   `docs/reviews/operator-experience-slice4-final.md`.

   The substance was wrong too. ADR-028 decides the _constraints_ and requires a
   **further** ADR to choose the concrete transport, so "blocked on ADR-028"
   misstated both the blocker and its remedy. Corrected everywhere, with the
   correction recorded rather than silently applied (correction C1 in the
   current-state document; a dated note at the head of the Slice 4 report, whose
   body is preserved as written).

2. **ADR-027 left `Proposed` while the whole Operator Experience was built on
   it.** Resolved by conformance review, not by assertion — see below.

3. **CLI command counts contradicted their own lists.** Both the current-state
   snapshot and the CLI plan claimed "16 implemented, 7 stubbed" while printing
   15 implemented commands and 8 stubs. Corrected and re-derived from
   `ATLAS_COMMANDS` (correction C3).

## ADR-027 decision

`docs/reviews/adr-027-implementation-conformance.md` maps all thirteen normative
decisions to source with file-level evidence: **twelve IMPLEMENTED, one
PARTIAL, none NOT_IMPLEMENTED, none SUPERSEDED**. The single PARTIAL (read-only
host diagnostics) is an unbuilt capability, not a divergence — nothing in the
source contradicts it, and its constraint is actively enforced by the new
process-execution guard.

**ADR-027 status: Proposed → Accepted**, recorded in the ADR as "Accepted based
on implementation conformance review" without rewriting its history.

## ADR-028 conformance

Re-verified against source; ADR-028 is **not** rewritten. Every invariant holds,
and each is now covered by a test rather than by inspection alone:

| ADR-028 invariant                                        | Evidence                                                                                                                                                |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| no forged assertion                                      | `tests/cli/mutating-transport-security.test.ts` — header omitted when absent; no `cf-*` header other than the assertion; no cookie/authorization header |
| no implicit sudo                                         | `tests/cli/no-direct-host-mutation.test.ts`                                                                                                             |
| no secrets in `argv`                                     | same guard rejects `--jwt`/`--token`/`--password`/`--secret` in CLI source                                                                              |
| no direct PM2/Docker/systemd mutation                    | same guard rejects `child_process`, `execFile`, `spawn`, `pm2`, `docker`, `systemctl`, `sudo`, `power-helper`                                           |
| read-only transport through HTTP                         | unchanged; reads still go through the administrative boundary                                                                                           |
| mutations unavailable without an authenticated transport | discharged by ADR-031; mutations now exist _only_ over that transport                                                                                   |

The guard additionally asserts that no `src/cli` module imports anything outside
`node:` and `./`, which is what keeps the operator package self-contained.

## New transport ADR

**ADR-031 — Authenticated mutating CLI transport** (`Accepted`). The next free
ADR number was confirmed programmatically: 029 and 030 already exist, so this is
031, not the 029 the task anticipated.

Decision: the CLI mutates through the **existing protected administrative HTTP
routes**, authenticated by an **externally issued Cloudflare Access assertion**
it only forwards. No second authentication stack, no second authorization
system, no new administrative route, no new audit identity kind.

## Threat model

`docs/reviews/mutating-cli-threat-model.md` evaluates Option A (operator-
authenticated HTTP) against Option B (host-local Unix socket / IPC) across
twenty-five threat dimensions.

Option B wins on three: environment leakage, Cloudflare availability coupling,
and credential replay — two of which are consequences of having a bearer
credential at all, and the third an availability trade rather than a security
one.

Option B loses on eight, four structurally:

- it needs a **second authorization system** and a uid→principal mapping,
  degrading the audit principal from a verified administrative identity to a
  locally maintained table (wrong-but-plausible attribution is worse than none);
- it **breaks mutual exclusion** between CLI and dashboard mutations unless the
  in-process mutation gate is shared or reimplemented;
- it **eliminates remote operation**, the primary use case;
- it adds a **permanent local privilege-escalation surface** (socket mode,
  symlink and stale-socket handling) whose failure mode is a silent bypass.

The decisive asymmetry: Option A's risks are inherited and already accepted (the
dashboard has depended on exactly this credential model since ADR-004); Option
B's are newly created. Option B is **rejected, not deferred**.

## Architecture

```text
argv
  -> parser (src/cli/parser.ts)
  -> command handler (src/cli/http-transport.ts)
  -> administrative client port (src/cli/administrative-client.ts)
  -> HTTPS or loopback HTTP
  -> Cloudflare Access assertion verification
  -> AuthenticateAdministrativeRequest -> AdministrativePrincipal
  -> AuthorizeAdministrativeOperation (services.start/stop/restart)
  -> exact confirmation + AdministrativeServiceMutationGate
  -> ControlRegisteredService -> DispatchingServiceController -> adapter
  -> AdministrativeAuditTrail
```

New CLI modules:

| Module                               | Responsibility                                                                                              |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `src/cli/administrative-contract.ts` | CLI-side binding to the canonical route security catalog: route ids, methods, path templates, confirmations |
| `src/cli/administrative-client.ts`   | the only module that knows HTTP, header names, base-URL policy, redirects, timeouts and response bounds     |
| `src/cli/render.ts`                  | short human output for mutations                                                                            |

Design points worth naming:

- **Confirmations are not duplicated.** The operator package ships only
  `dist/cli`, so the CLI cannot import the server catalog at runtime. Instead it
  declares a small table that `tests/cli/administrative-contract.test.ts` pins to
  `ADMINISTRATIVE_ROUTE_SECURITY_CATALOG`. Drift fails the suite, not production.
- **Command handlers never see `fetch`, a header name, or a credential.** They
  receive `read`, `readEnvelope`, `mutate` and `assertMutationAllowed`.
- **The pre-check is advisory, never authority.** Before a mutation the CLI reads
  the service to give precise `service_not_found` / `service_operation_unsupported`
  errors, mirroring how the dashboard hides unsupported controls. Only a
  _definitive_ answer stops the command; any other pre-check problem is ignored so
  a degraded read path cannot make a service unmanageable during an incident. The
  server re-checks everything regardless.
- **The client enforces its own timeout** rather than trusting the fetch
  implementation to honour the signal.

## Commands implemented

| Command                                           | Status                                                              |
| ------------------------------------------------- | ------------------------------------------------------------------- |
| `atlas services start <id>`                       | implemented                                                         |
| `atlas services stop <id>`                        | implemented                                                         |
| `atlas services restart <id>`                     | implemented                                                         |
| `atlas services schedule preview <id> --policy …` | implemented (read-only candidate-draft preview, Slice 4 gap closed) |

`CLI_COMMAND_NODES` 23; implemented 15 → 18; stubs 8 → 5.

## Commands deferred

- schedule mutations (`set`, `always`, `manual`, `disable`, `remove`);
- backup mutations;
- infrastructure diagnostics (`infra`, `nginx`, `tunnel`) — separate track;
- power mutations — deliberately absent, separate track under its own ADRs.

None are architecturally blocked any more. The schedule and backup routes
already carry their own RBAC, confirmation, gate and audit policies, and reuse
the ADR-031 transport unchanged; what remains is CLI parser and command wiring.

## Security test evidence

End-to-end through a real Express app with real Access verification, real RBAC
and a real audit trail (`tests/http/authenticated-cli-mutation-integration.test.ts`,
13 tests): the actual CLI transport is driven over a supertest-backed `fetch`.

| Scenario                                                                      | Result                                                                                 |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| missing credential                                                            | exit 3, no control operation audited                                                   |
| structurally invalid credential                                               | exit 3, no control operation audited                                                   |
| expired credential                                                            | exit 3, no control operation audited                                                   |
| wrong issuer                                                                  | exit 3, no control operation audited                                                   |
| wrong audience                                                                | exit 3, no control operation audited                                                   |
| valid credential, unknown principal                                           | exit 3, no control operation audited                                                   |
| authorized role (`service_operator`)                                          | start/stop/restart each succeed once, adapter effect observed in authoritative state   |
| unauthorized role (`auditor`, has `services.read` but no mutation permission) | exit 3, no control operation audited                                                   |
| audit attribution                                                             | `administrator:<principalId>` from the verified assertion — never a shell user         |
| CLI vs API parity                                                             | the API's audited operations are a subset of the CLI's; same class, not a separate one |
| busy mutation gate                                                            | exit 4                                                                                 |

Transport-level (`tests/cli/mutating-transport-security.test.ts`, 20 tests) and
behavioural (`tests/cli/service-mutations.test.ts`, 24 tests):

- assertion present only in `Cf-Access-Jwt-Assertion`, never in the URL, never
  in stdout/stderr on success, on 403 or on 500;
- no fabricated principal, role, cookie or authorization header;
- plaintext non-loopback base URL: mutation refused with `insecure_transport`
  and **zero** fetch calls; reads to such a host never carry the assertion;
- HTTPS, `127.0.0.1` and `localhost` all permit mutations and forward the
  assertion;
- `redirect: "error"` on every administrative request; a redirect surfaces as a
  transport error with no second request to any other origin;
- 409 and 429 → exit 4, exactly one POST;
- proven-undelivered (`ECONNREFUSED`) → `infrastructure_unavailable`;
  possibly-delivered (`ECONNRESET`) and timeout → `mutation_outcome_unknown`,
  exactly one POST, message directing to `atlas services status <id>`;
- 503 `administrative_service_state_recheck_required` → indeterminate, not
  failure;
- SIGINT before dispatch → `interrupted`; after dispatch →
  `mutation_interrupted_outcome_unknown`; both exit 130;
- authoritative re-read reports post-mutation state; a failed re-read still
  reports the mutation as accepted with `state: unknown` and exit 0;
- malformed JSON, wrong response shape, `successful: false`, oversized response
  all refuse to claim success;
- usage errors (missing id, extra argument, `--pm2`/`--container`/`--unit`,
  malformed id) exit 2 with **no** network call.

## Defect found and fixed

Writing the wrong-issuer and wrong-audience cases surfaced a **pre-existing
server defect**, unrelated to the CLI and equally affecting the dashboard.

The authentication domain publishes seven `unauthenticated` reasons
(`credentials_absent`, `credentials_invalid`, `signature_invalid`,
`issuer_mismatch`, `audience_mismatch`, `claims_invalid`, `key_unavailable`),
but `ADMINISTRATIVE_AUTHORIZATION_REASON_CODES` deliberately publishes a coarser
set. `create-protected-administration.ts` passed the raw reason into the audit
record, so for **five** of the seven — including a forged signature, a wrong
issuer and a wrong audience — `createAdministrativeEventInput` rejected the
record. The consequences:

1. the five most security-relevant authentication refusals were **never
   audited**;
2. they surfaced as `authorization_audit_unavailable` (**HTTP 503**) instead of
   an authentication refusal, which is both misleading and the wrong signal for
   an operator or an alert.

Fixed by mapping the authentication reason into the audit vocabulary at the
boundary — intentionally lossy rather than schema-expanding, since a forged
signature, a wrong issuer and a wrong audience are all, for authorization
purposes, invalid credentials. Covered by a seven-case regression in
`tests/access-control/access-control.test.ts`.

This is a strengthening of the authority chain, not a relaxation: no invariant
was weakened to make the CLI easier to implement.

## Full qualification

| Gate                                 | Result                                                                                                                                            |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm ci`                             | pass, 0 vulnerabilities                                                                                                                           |
| `npm run format:check`               | pass                                                                                                                                              |
| `npm run lint`                       | pass                                                                                                                                              |
| `npm run typecheck`                  | pass                                                                                                                                              |
| `npm test`                           | **236 files, 2983 passed, 3 skipped** (from 231 / 2905 / 3)                                                                                       |
| `npm run build`                      | pass                                                                                                                                              |
| `npm run build:deployment`           | pass                                                                                                                                              |
| `npm run dashboard:generate-assets`  | pass, 3-file inventory                                                                                                                            |
| dashboard asset verification         | pass — manifest digests match the generated assets, served `main.js` is byte-identical to `app.js` and is not an ES module (see limitation below) |
| `npm run package:operator`           | pass                                                                                                                                              |
| operator package smoke               | pass (see below)                                                                                                                                  |
| `npm audit --omit=dev`               | 0 vulnerabilities                                                                                                                                 |
| `npm audit`                          | 0 vulnerabilities                                                                                                                                 |
| `npm run release:validate-snapshots` | `{"result":"valid","versionedEvidence":"not_qualified"}`                                                                                          |
| deployment Go                        | `gofmt` clean, `go mod verify` ok, `go vet` clean, all packages pass                                                                              |
| power-helper Go                      | `gofmt` clean, `go mod verify` ok, `go vet` clean, all packages pass                                                                              |
| administrative route count           | 47 → 47; `catalogSha256` unchanged (`912e575b…f32396`) and still matching the published contract                                                  |

### Operator package smoke test

`dist/operator-package/atlas-manager-operator-cli-1.0.0-rc.13.tgz` installed
into a temporary directory (never the workstation global) and run against a
local HTTP fixture standing in for the administrative boundary — **no live Atlas
host and no real service was touched**:

- `atlas --version` → `1.0.0-rc.13`;
- `atlas services restart task-manager` → exit 0 with the short human result;
- observed requests: `GET /admin/services/task-manager`, then
  `POST /admin/services/task-manager/actions/restart` with body
  `{"confirmation":"confirm_registered_service_restart"}`, then the authoritative
  re-read — assertion forwarded in the header on each, never in a URL;
- without a credential → exit 3, refused at the pre-check;
- with `ATLAS_BASE_URL=http://atlas.example.com` → exit 2 `insecure_transport`
  with **no request observed**.

Package contents: `dist/cli` only, plus `package.json`, `README.md`, `LICENSE`.
Payload scanned — no tokens, no `.env`, no server state, no Cloudflare
assertion, no credentials, no host configuration, no power helper. The only
matches for credential-shaped strings are the environment-variable _names_ in
code.

### Qualification limitations

- **Reproducible deployment-bundle build and packaged-dashboard equivalence
  could not be run on this workstation.** `deployment/internal/bundle` pins an
  exact toolchain (Node 24.18.0, npm 11.16.0, Go 1.23.0); this environment has
  Node 24.19.0, npm 11.17.0, Go 1.26.5, so the builder correctly refuses with
  `tool_version_invalid`. This is the pin working as designed, not a regression.
  Both steps run in CI. The portion of asset verification that does not depend on
  the Go bundle was executed and passed.
- **Candidate A/B reproducibility was not performed** — it is required only when
  a milestone is promoted to a release candidate, which this one is not.
- `npm run release:validate` requires release artifacts generated during a
  release cut (`atlas-manager-release-contract.json` etc.), which are untracked
  and absent at baseline. Not applicable outside a release cut.

## Release decision

**No version bump.** The repository's convention, read from
`git log -- package.json`, is that version changes land in dedicated
`chore: prepare/formalize <version>` commits; Operator Dashboard v2 Slices 2, 3
and 4 (#312, #313, #316) all shipped on `1.0.0-rc.13` without bumping. This
milestone follows that convention. Cutting `rc.14` is a separate release
formalization pass, which is also where Candidate A/B reproducibility belongs.

## Power safety

Unchanged and re-confirmed: `POWER_MANAGEMENT_BACKEND=mock`,
`MACHINE_POWER_EFFECTS_ACTIVATION=disabled`,
`MACHINE_POWER_SCHEDULER_ENABLED=false`. No power command was added to the CLI.
All power-helper testing used fixtures. No physical effect was exercised.

## Remaining Operator Experience gaps

Genuinely open, in rough priority order:

1. CLI schedule mutation commands (`set`/`always`/`manual`/`disable`/`remove`) —
   unblocked, mechanical.
2. CLI backup mutation commands — unblocked, mechanical.
3. Infrastructure diagnostics (`atlas infra`/`nginx`/`tunnel`, dashboard
   Infrastructure page) — independent track, still requires the runtime
   diagnostic boundary decision.
4. Machine policy persistence and precedence — still requires a dedicated ADR.
5. Slice 4 UX follow-ups: multiple windows per day in the editor, active
   override and expiry on the timeline (needs a small new backend read),
   following transitions plural, `evaluatedAt` as a distinct preview field.
6. Compose resource aggregation semantics.
7. Operator runbook v3 and the remaining documentation set.

The unresolved-decisions table now contains only real blockers: machine policy
persistence and the runtime diagnostics boundary. Mutating CLI authentication is
no longer among them.

## Next milestone

1. Finish the remaining mutating CLI schedule and backup commands.
2. Implement Operator Infrastructure Diagnostics (needs the boundary decision
   first).
3. Close the small Slice 4 UX follow-ups.
4. Close the Operator Experience runbook and documentation.
5. Formalize the next release candidate, including Candidate A/B reproducibility
   on the pinned toolchain.
6. Read-only Atlas host qualification.
7. Register Task Manager if still pending.
8. Deploy the qualified release.
9. Run operator acceptance including the authenticated CLI mutations — this is
   where `atlas services restart` is first exercised against a real service.
10. Begin physical-power host qualification as a separate milestone.
