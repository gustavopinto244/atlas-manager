# Agent handoff

## Current work — Issue #254

The active branch is:

```text
feat/linux-power-helper-installation-bundle
```

The authoritative PR #253 merge baseline in this checkout is:

```text
df23dc5ecdeb1ea65f020331c6281cb3776d8d34
```

Issue #254 adds ADR-009, a deterministic `linux/amd64` bundle with
`GOAMD64=v1` and `CGO_ENABLED=0`,
strict manifest and executable checksums, an operator-only Go installer, the
fixed empty-group prerequisite, atomic installation state, verification,
upgrade, recovery, rollback, and uninstall documentation. The installer uses
only fixed production paths, executes no child process, requires root only for
mutation, and never creates the group or enrolls a user. The archive does not
carry setuid; the explicit installer applies exact `04750` metadata only after
validation. Tests use temporary sandbox paths through internal constructors;
the production CLI exposes no root or destination option.

Validation and final artifact hashes are still pending in this working tree.
The helper is not installed, no group or user was changed, no setuid was
applied, and Atlas Manager remains mock-first. The next recommended delivery
is host qualification and a disabled installation drill, not automatic
production activation.

## Current work — Issue #252

The active branch is:

```text
feat/linux-power-helper-systemd-shutdown-backend
```

The authoritative merged PR #251 baseline in this checkout is:

```text
df59b47da3a6074b20546c608954e67f5b69f4f8
```

Issue #252 adds ADR-008 and the real helper-side shutdown backend through the
fixed systemd-logind D-Bus contract. The helper validates the root-owned
`/run/dbus/system_bus_socket` and `/run/dbus` parent, uses one private
EXTERNAL-authenticated connection, performs `Hello`, and calls only
`org.freedesktop.login1.Manager.PowerOff(false)`. The existing exclusive
operation lock is held across socket inspection, connection, call, response
construction, and release. The fixed internal deadline is three seconds.

Definite unsupported conditions map to `operation_unsupported`, controlled
logind or inhibitor rejection maps to `operation_rejected`, and infrastructure
or uncertain-acceptance failures map to `operation_failed`. No retry,
reconnect, fallback, inhibitor bypass, RTC access, shell, subprocess, syscall,
or signal subscription is present. The helper remains uninstalled, unsetuid,
and unwired; Atlas Manager remains mock-first and simulated.

The only direct new dependency is `github.com/godbus/dbus/v5 v5.2.2` under the
Go module, with transitive `golang.org/x/sys v0.27.0`. Final validation used
Node.js 24.18.0, npm 11.16.0, and Go 1.23.0 linux/amd64. The Node suite passed
171 files and 2,415 tests with the deterministic fixture enabled; the Go suite
passed 97 tests. Formatting, lint, typecheck, Node build, Go format, vet,
module verification, Linux builds, compatibility tests, and `git diff --check`
passed. npm dependencies are unchanged; production audit reports zero
vulnerabilities. `nvm use` is unavailable in the shell; versions were verified
directly. No helper was installed, no setuid or group change was made, and no
system bus or real shutdown was invoked.

Do not reset, discard, commit, push, merge, or open a Pull Request without the
project owner's approval.

## Current work — Issue #248

The active branch is:

```text
feat/linux-power-helper-read-only-rtc-backend
```

The authoritative merged PR #247 baseline in this checkout is:

```text
b836aa826dbad6e7265d542de1f78179aa60297e
```

Issue #248 adds ADR-006 and a fixed read-only Linux backend under the pinned
Go 1.23.0 helper module. Production reads only `/sys` after checking the
sysfs magic, then `/sys/class/rtc/rtc0/since_epoch` and
`/sys/class/rtc/rtc0/wakealarm`; no path, environment, argument, or request
field selects an RTC. Attribute reads are capped at 128 bytes and RTC time
must be within 300 seconds of the system clock captured around the read.
Missing support is `operation_unsupported`; malformed, unreadable, or
misaligned state is `state_unavailable`; an absent wakealarm is a successful
`unsupported` observation. Only `read_rtc_information` and `read_wake_alarm`
are real; schedule, cancel, and shutdown remain deny-all.

The protocol now has typed operation-specific read-success responses with
canonical field ordering. A separately named deterministic fixture executable
supports TypeScript/Go compatibility tests without host RTC hardware. The
production helper is not installed, setuid-enabled, or wired into Atlas
Manager, and npm dependencies and Go third-party modules remain unchanged.

Final validation for Issue #248 completed with Node.js 24.18.0, npm 11.16.0,
and Go 1.23.0 on Linux. `nvm use` is unavailable in the shell. The complete
Node suite passed with 171 test files, 2,408 passing tests, and 1 skipped
test. The Go suite passed 32 tests, including the Linux build and
TypeScript/Go fixture compatibility. Formatting, lint, typecheck, Go vet,
build, and `git diff --check` passed. `npm ci` completed without dependency
changes; its existing development-tree advisory was not changed. Production
`npm audit --omit=dev` reported zero vulnerabilities.

Do not reset, discard, commit, push, merge, or open a Pull Request without the
project owner's approval.

## Current work — Issue #250

The active branch is:

```text
feat/linux-power-helper-wake-alarm-mutation-backend
```

The authoritative merged PR #249 baseline in this checkout is:

```text
3daf7c2aaad03479e6e06360d7fc4280b52041b4
```

Issue #250 adds ADR-007 and real fixed `rtc0` wake-alarm schedule/cancel
source code to the standalone Go helper. Reads use a shared lock and
mutations use an exclusive nonblocking lock at
`/run/atlas-manager-power-helper.lock`; production lock files must be
root-owned regular files with exact mode `0600`, one link, and no final
symlink. The helper writes only absolute canonical epoch payloads capped at 32
bytes or exactly `0\n` for cancellation.

Scheduling validates aligned RTC time and current wake state, returns
`scheduled`, `unchanged`, or `replaced`, and replacement performs cancel,
verify absent, schedule, verify exact target under one lock. Cancellation is
idempotent. Write failures and read-after-write mismatches return
`operation_failed`; partial replacement effects remain authoritative with no
retry, rollback, or compensation. `request_shutdown` remains unsupported and
does not acquire the lock. The helper remains uninstalled and unwired; all
Atlas Manager HTTP behavior remains mock-first.

Final validation used Node.js 24.18.0, npm 11.16.0, and Go 1.23.0
linux/amd64. The Node suite passed with 171 test files, 2,410 passing tests,
and 2 skipped tests. The Go suite passed 73 tests; format, vet, Linux helper
builds, TypeScript build, lint, typecheck, and `git diff --check` passed.
`npm ci` completed successfully, npm and Go dependencies remain unchanged,
and `npm audit --omit=dev` reported zero production vulnerabilities. `nvm use`
remains unavailable in the shell; versions were verified directly. No helper
was installed, no setuid or group change was applied, and no production
wiring or real hardware effect was introduced.

Do not reset, discard, commit, push, merge, or open a Pull Request without the
project owner's approval.

## Current work — Issue #246

The active branch is:

```text
feat/external-linux-power-helper-executable
```

The authoritative merged PR #245 baseline is:

```text
9a66397e4d65a3dd8eba555773676ffaeb2b93dd
```

Issue #246 adds ADR-005 and the standalone pinned Go module under
`power-helper/`. The executable name and future installation path remain
`atlas-manager-power-helper` and `/usr/local/libexec/atlas-manager-power-helper`.
The intended owner/group/mode are `root`, `atlas-manager-power`, and `04750`.
The helper requires Linux, effective UID zero, the fixed executable identity,
and no arguments; it handles one bounded v1 JSON request and rejects every
valid operation with `operation_unsupported`. Invalid input exits 64 and
internal startup failure exits 70, with no stderr diagnostics.

The deny-all backend performs no filesystem, device, process, shell, network,
RTC, wake, or shutdown effect. The application-side inspector now checks
exact mode, setuid, nonzero GID, process group membership, root parent
ownership, and safe parent permissions without repairing installation state.
CI pins Go 1.23.0, runs format/vet/tests, and builds an ignored Linux artifact;
no installation or production wiring is present. TypeScript and Go consume
the shared protocol corpus. Final validation used Node.js 24.18.0, npm
11.16.0, and Go 1.23.0: 171 Node test files/2,406 tests, 7 Go tests, clean
format/lint/typecheck/vet/build checks, unchanged npm and Go module
dependencies, and 0 production npm vulnerabilities. `nvm use` remains
unavailable in the shell; versions were verified directly.

The next recommended delivery is the separately reviewed read-only helper
backend. Real effects remain disabled.

## Current work

The active branch for Issue #244 is:

```text
feat/protected-administrative-shutdown-http
```

The authoritative merged PR #243 baseline is:

```text
40f050b1e35947204d783247a8b98067038cebe0
```

Issue #244 adds the disabled-by-default loopback-only shutdown workflow:
`POST /admin/power/shutdown/preparations` and `POST
/admin/power/shutdown/executions`. Activation requires the existing Cloudflare,
role-assignment and persistent event-history settings plus paired distinct
`MACHINE_SHUTDOWN_OCCURRENCE_CLAIM_FILE` and
`MACHINE_POWER_SCHEDULER_CURSOR_FILE` paths. A configured principal must have
`power_operator` or `administrator`.

Preparation and execution use separate immutable request-owned confirmations:
`confirm_shutdown_preparation` and `confirm_shutdown_execution`. Preparation
may stop registered services through the shared dependency-aware
service-management composition but never claims, schedules wake, or requests
shutdown. Execution never performs automatic preparation; it performs fresh
readiness, permanently claims the occurrence, schedules mock wake, and requests
simulated shutdown. Direct `requestMachineShutdown` is not HTTP-exposed.

The routes share the global 60 requests per 60 seconds/four concurrent
administrative admission and the one-active-power-operation gate with the
event-history and wake-alarm routes. Bodies are JSON-only and bounded to 1 KiB;
targets are bounded to 4 KiB and offline intervals to seven days. Responses are
explicitly mapped and bounded to 64 KiB, with restrictive no-store headers.
Claims and partial effects are never released, retried, rolled back, or
compensated; safe state-recheck errors require a later operator inspection.
The backend remains mock/simulated with no helper, RTC, or real shutdown effect.

The active branch for Issue #242 is:

```text
feat/protected-administrative-wake-alarm-http
```

The authoritative merged PR #241 baseline is:

```text
66d195eddcde2fbf6ae0b3a96370023ca9244f58
```

Issue #242 adds the explicitly gated mock-first resource
`/admin/power/wake-alarm` with GET, PUT, and DELETE. It adds
`power.wake.read` and `read_wake_alarm`, keeps auditor and scheduler roles
without wake access, and shares the persistent event history, Cloudflare
verifier/JWKS cache, role reader, clock, power composition, global 60-per-60
second/four-concurrent admission, and one-active-mutation gate with Issue
#240. Requests are request-scoped at the assertion reader, authentication,
access-control, and protected-facade layers.

GET uses the authorization timestamp for observation. PUT and DELETE are
idempotent state-setting operations and preserve authorization/start/effect/
terminal audit ordering. Invalid or admitted-limit requests create no audit
event. Terminal audit failure preserves the mock state and returns a safe
state-recheck response without retry or rollback. The delivery is loopback-
only, disabled by default, bounded, non-CORS, and does not activate a helper or
real RTC/power effect.

Version-one JSON Lines reconstruction accepts the new authorization detail pair
`read_wake_alarm`/`power.wake.read` without migration. A binary predating Issue
#242 may reject newly written authorization-detail vocabulary during rollback;
events must not be silently skipped or removed.

Validation for Issue #242 completed with Node.js `v24.18.0` and npm `11.16.0`.
`nvm use` was unavailable because nvm is not installed in the shell; the
reported runtime versions were verified directly. `npm ci` completed with the
existing development-tree advisory and no dependency changes. Format check,
lint, typecheck, build, and `git diff --check` passed. The full suite passed
with 166 test files and 2,375 tests. `npm audit --omit=dev` reported zero
production vulnerabilities. `package.json` and `package-lock.json` remain
unchanged. The next recommended delivery is the separately reviewed
destructive shutdown HTTP slice.

The active branch for Issue #240 is:

```text
feat/protected-administrative-event-history-http
```

The authoritative merged PR #239 baseline is:

```text
6dfab4223e8d8e544c7669a0042d7f7fcd9cfa92
```

Issue #240 adds the explicitly gated `GET /admin/event-history` route. Enabled
delivery requires `HOST=127.0.0.1`, paired Cloudflare Access configuration,
`ADMINISTRATIVE_EVENT_HISTORY_FILE`, and strict JSON
`ADMINISTRATIVE_ROLE_ASSIGNMENTS` containing an auditor or administrator.
Authentication remains request-scoped; the JWKS provider, role reader, event
history, clock, and mock-first power composition are shared. The handler calls
only the protected administration facade, records authorization in the same
file-backed history before querying, and maps strict event fields into a
bounded response.

The route is limited to 60 admitted requests per 60-second process-local
window and four concurrent requests. It rejects bodies, overlong URLs,
malformed raw queries, proxy/IP-based security, CORS, bearer challenges, and
all methods other than GET. No power route, helper activation, or real machine
effect was added. The next recommended delivery is the separately reviewed
wake-alarm HTTP slice.

Historical Issue #238 context:

```text
feat/cloudflare-access-administrative-authentication
```

The authoritative merged PR #237 baseline is:

```text
4c50b54f4b9e101138f2b0d67337308b07033af6
```

Issue #238 accepts ADR-004: Cloudflare Access application JWTs are verified
with the fixed team issuer and JWKS endpoint, RS256 only, one exact audience,
`type: app`, and a canonical lowercase UUID subject. Configuration uses
`CLOUDFLARE_ACCESS_TEAM_NAME` and `CLOUDFLARE_ACCESS_AUDIENCE` as a strict
pair. The only assertion source is `Cf-Access-Jwt-Assertion`; no cookie,
email header, session, or production route is accepted. Header assertions are
bounded to 16 KiB, JWKS responses to 65,536 bytes, fetch timeout to five
seconds, successful cache lifetime to ten minutes, and failed-fetch cooldown
to thirty seconds. Unknown key refreshes are coalesced and limited to one.

The request-scoped provider feeds the existing AdministrativePrincipal,
role-assignment, authorization, audit, and protected-operation boundaries.
Service-token assertions with an empty subject reject as invalid credentials.
Missing configuration retains deny-all authentication and performs no network
request. The only new runtime dependency is `jose` version `6.2.6`.

Issue #236 starts from the authoritative merged PR #235 baseline:

```text
5e5658d4953d18381e85a101d37308eae867b740
```

It starts from the merged Issue #233 baseline commit `3f9b638` and extends
the isolated `src/power-management/` feature boundary with immutable machine
operating policies, weekly operating windows, explicit timezone validation,
deterministic power planning, shutdown occurrences, process-local claims, and
duplicate-protected explicit execution with file-backed claims, scheduler
cursors, bounded interval generation, explicit scheduler ticks, and a
fail-closed safe-shutdown readiness boundary with explicit mock preparation,
dependency-aware service stopping, idempotent task/backup/filesystem
boundaries, ordered preparation events, final readiness reevaluation, and the
reviewed Linux helper foundation. The current Issue #234 adds the dedicated
`src/event-history/` feature and audits state-changing power operations through
one shared event-history boundary.

The safe default is `always_on`: the machine is expected to operate and no
automatic shutdown or wake transition is planned. Scheduled policies use the
explicit `America/Sao_Paulo` timezone and the Node.js runtime timezone
database. The new result is schedule intent only.

No real RTC device, kernel file, system bus, installed helper, filesystem
write, privileged interface, HTTP endpoint, automatic scheduler, persistence,
retry, rollback, compensation, or real machine power operation exists. The
secure transport can invoke only the fixed helper when explicitly supplied;
default composition performs no helper work. Readiness is evaluated before claims and
effects; rejected occurrences remain unclaimed and retryable. Approved
execution schedules wake before simulated shutdown and leaves claims consumed
after dependency failure. Scheduler ticks are explicit, bounded, and have no
timer or lifecycle integration.

Preparation is evaluation-scoped: initial confirmation permits the current
attempt, and any preparation mutation requires a fresh confirmation before the
occurrence can be claimed. Partial preparation effects are preserved without
rollback; later explicit attempts rely on authoritative idempotent mock state.

## Validation

Using Node.js 24.18.0 and npm 11.16.0:

```text
nvm use                       NOT AVAILABLE — nvm is not installed in the shell
npm ci                        PASS — jose 6.2.6 installed; existing esbuild script warning and one development-tree advisory
npm run format:check          PASS
npm run lint                  PASS — 0 errors, 0 warnings
npm run typecheck             PASS
npm test -- --maxWorkers=1    PASS — 162 files, 2306 tests
npm run build                 PASS
git diff --check              PASS
npm audit --omit=dev          PASS — 0 production vulnerabilities
```

One runtime dependency was added: `jose` version `6.2.6`. The development-tree
advisory reported by `npm ci` was not fixed or changed; the production audit is
clean.

## Delivered capabilities

The mock-first v0.6 slice provides:

- project-owned canonical RTC information;
- immutable wake-alarm states `unsupported`, `not_scheduled`, and `scheduled`;
- exact application-owned observation/request timestamps;
- deterministic mock RTC information reader;
- narrow simulated shutdown controller;
- immutable simulated shutdown results;
- frozen `createPowerManagement` capabilities;
- controlled unit, composition, and integration tests.

The third slice adds:

- `always_on`, `scheduled`, and `manual` machine operating modes;
- immutable weekly machine operating schedules with 1–64 windows;
- exact `America/Sao_Paulo` timezone handling;
- `operating`, `offline`, and `manual` schedule expectations;
- immutable next-shutdown and next-wake plans;
- a pure bounded evaluator and `GetMachinePowerPlan` query;
- frozen composition integration and a complete mock-first schedule scenario.

The fourth slice adds machine-shutdown occurrence planning, a narrow in-memory
claim store, due/stale/duplicate execution outcomes, wake-before-shutdown
coordination, and explicit partial-effect errors.

The fifth slice adds versioned file-backed occurrence claims, completed-claim
pruning, in-memory and file-backed scheduler cursors, bounded interval
generation, compare-and-set cursor progression, process reconstruction, and
crash-window recovery behavior.

The readiness slice adds a public service availability interval query, runtime
service readiness, explicit confirmation, immutable blocker and decision
models, mock operational readers, readiness enforcement before claims, and
retryable incomplete scheduler reports.

Issue #230 adds the explicit mock safe-shutdown preparation boundary:

- preparable versus non-preparable blocker classification;
- immutable preparation plans, step results, reports, and sequence-numbered
  in-memory events;
- public dependency-aware registered-service batch stopping;
- idempotent mock task draining, backup completion, and filesystem
  synchronization controllers;
- fresh final confirmation and readiness reevaluation before occurrence claims;
- preparation-incomplete execution and scheduler results that remain retryable;
- preserved partial effects with no rollback or compensation.

Issue #232 starts from baseline `8ceb286` and adds the accepted ADR-002
security boundary for a future Linux power helper:

- fixed executable `/usr/local/libexec/atlas-manager-power-helper`;
- protocol version `1` with five allowlisted operations;
- immutable strict requests/responses and canonical newline JSON;
- Linux-only root-owned installation inspection;
- no-shell transport with empty arguments, fixed `/` cwd, minimal environment,
  five-second timeout, and 16 KiB/4 KiB output bounds;
- serialized same-instance transport operations;
- helper-backed RTC, wake-alarm, and machine-shutdown adapters;
- frozen shared adapter bundle, deterministic fake transport, and test fixture.

The baseline is `8ceb286`. Final validation passed with 153 test files and
2,238 tests. The dedicated coverage now spans protocol models,
canonical serialization, installation inspection, no-shell transport,
adapters, fake transport, composition overrides, preparation plans, events,
mocks, service stopping, occurrence execution, scheduler retry, and complete
integration scenarios. No dependency changes are intended.

The mock slice uses one shared process-local mock wake-alarm state for the
independent wake-alarm reader, wake-alarm controller, and RTC reader. It has no
real RTC effects, persistence, timers, filesystem writes, privileged
operations, HTTP exposure, or machine power effects. The helper fixture is
test-only and performs no RTC or power operation.

Issue #234 adds the first bounded v0.8 event-history and auditing slice:

- immutable administrative-event models with strict source, target, operation,
  status, and operation-specific detail validation;
- internally generated UUID attempt IDs and store-assigned contiguous
  sequences;
- narrow recorder, reader, and readiness ports with immutable query pages;
- deterministic in-memory storage and explicitly configured canonical JSON
  Lines persistence;
- bounded filters and cursor pagination;
- safe parent/file permission checks, reconstruction, corruption rejection,
  capacity limits, and safe error translation;
- one shared event-history instance for power auditing and readiness;
- started-before-effect and terminal-after-result semantics for direct and
  scheduler power operations;
- preserved partial effects with no audit retry, rollback, or compensation.

Direct operations use `administrative/unattributed-local`; scheduler operations
use `automated/machine-power-scheduler`. This is not authenticated attribution.
The event history is separate from logs and preparation events, has no HTTP
surface, and has no retention, rotation, cross-process lock, or tamper-proof
claim. Default power behavior remains mock-first and real helper activation
remains disabled.

Issue #236 adds the accepted ADR-003 mock-first access-control foundation.
Principals are immutable canonical lowercase UUIDs. Authentication results are
`authenticated`, `unauthenticated`, or `unavailable`; the default provider
returns `credentials_absent`. The fixed roles are `power_operator`,
`scheduler_operator`, `auditor`, and `administrator`, mapped in reviewed code
to seven explicit permissions. Unknown principals and unavailable role data
fail closed. Protected capabilities authenticate once, authorize once, record
an authorization event, and only then invoke the underlying power or
event-history capability.

Authenticated audit actors are internally constructed as
`administrator:<principalId>` and propagate to power started/terminal events.
Unauthenticated attempts use `administrative/unauthenticated`. Authorization
does not imply shutdown confirmation. The composition is frozen, has no work
at construction, and is not HTTP-exposed. No credentials, sessions, tokens,
production identity provider, role persistence, helper activation, real RTC,
real shutdown, timer, or background worker was added.

Validation completed on Node `24.18.0` and npm `11.16.0`. `nvm use` was not
available because nvm is not installed in the shell. `npm ci` completed with
the existing esbuild install-script approval warning and one development-tree
advisory; no dependency files changed and no audit-fix command was run.

```text
npm run format:check       PASS
npm run lint               PASS — 0 errors, 0 warnings
npm run typecheck          PASS
npm test -- --maxWorkers=1 PASS — 161 files, 2272 tests
npm run build              PASS
git diff --check            PASS
npm audit --omit=dev        PASS — 0 vulnerabilities
```

## Historical next-work note

The earlier Issue #236 handoff recommended selecting the production identity
mechanism. Issue #238 recorded that decision in ADR-004, and Issue #240 now
delivers the first protected read-only HTTP route.

Do not reset, discard, commit, push, merge, or open a Pull Request without the
project owner's approval.

## Issue #238 final validation

The Issue #238 validation supersedes older historical totals in this handoff:

```text
Node.js                    24.18.0
npm                        11.16.0
nvm use                    unavailable — nvm is not installed in the shell
npm ci                     PASS
npm run format:check       PASS
npm run lint               PASS
npm run typecheck          PASS
npm test -- --maxWorkers=1 PASS — 162 files, 2306 tests
npm run build              PASS
git diff --check           PASS
npm audit --omit=dev       PASS — 0 vulnerabilities
jose                      6.2.6
```

No HTTP administrative route, production helper activation, real RTC
mutation, real shutdown, session, cookie fallback, or trusted-proxy change
was introduced. The next delivery is protected administrative HTTP delivery
using this request-scoped provider and the existing protected facade.

## Issue #240 final validation

The Issue #240 validation supersedes the older historical totals above:

```text
Baseline                   6dfab4223e8d8e544c7669a0042d7f7fcd9cfa92
Branch                     feat/protected-administrative-event-history-http
Route                      GET /admin/event-history
Activation                 ADMINISTRATIVE_EVENT_HISTORY_HTTP_ENABLED=true
Binding                    HOST=127.0.0.1 only
Query page                 default 50, maximum 100
Rate limit                 60 requests / 60 seconds, process-local
Concurrency                4 admitted requests
Response bound             1 MiB
Dependencies               unchanged
Node.js                    24.18.0
npm                        11.16.0
nvm use                    unavailable — nvm is not installed in the shell
Test files                 164 passed
Tests                      2347 passed
Production audit           0 vulnerabilities
Next delivery              protected wake-alarm HTTP lifecycle
```

Validation commands passed: `npm ci`, `npm run format:check`, `npm run lint`,
`npm run typecheck`, `npm test -- --maxWorkers=1`, `npm run build`, and
`git diff --check`. `npm ci` reported the existing development-tree advisory
and esbuild script approval warning; no audit-fix command was run. The
production-only audit passed.

Authorization events and event-history query results use the same persistent
event-history instance. Successful reads can therefore include their own
authorization event. Malformed queries and admission-limit rejections do not
create authorization events.

## Current work — Issue #256

The active branch is:

```
feat/linux-power-helper-host-qualification
```

The authoritative merged PR #255 baseline for this work is
`e6d36bf84969d177303c5a64f68ecb544c9dba8b`.

This delivery adds ADR-010 and a fixed-resource, read-only host qualification
executable with `qualify`, `verify-disabled-installation`, and
`verify-removed`. It requires effective UID zero but performs no
installation, group change, helper execution, sysfs write, lock creation,
`PowerOff` call, or child process. The qualification executable is
included in the deterministic bundle without setuid metadata. Atlas Manager
remains mock-first and live host evidence must stay outside source control.

Validation for this branch used Node.js 24.18.0, npm 11.16.0, and Go
1.23.0 linux/amd64 with `GOAMD64=v1`. The Go module passed formatting, module verification,
vet, tests, and Linux builds; the deterministic bundle was reproduced twice
with package version `0.1.1` and `SOURCE_DATE_EPOCH=1722470400`.
Both bundle archives hashed to
`11a5e5ce538e07a275e3b4d6f1d31eb4ff2d1b7f8283f4ec2aad755c478da795`.
No host installation, group modification, setuid change, helper execution,
RTC access, D-Bus operation, wake effect, or shutdown occurred.

## Current work — Issue #258

The active branch is:

```text
feat/production-shaped-linux-power-helper-composition
```

The authoritative merged PR #257 baseline for this delivery is:

```text
eb6440c98314ed52ba6ff0b53061c39b291fd7cd
```

Issue #258 adds ADR-011 and the immutable, fail-closed
`POWER_MANAGEMENT_BACKEND` selector. `mock` remains the exact default and
`linux_helper` is the only alternate value. Linux selection creates one
shared, frozen helper-adapter bundle; composition performs no helper request
and helper failures never fall back to mock. The Linux shutdown result is
`accepted`, while mock shutdown remains `simulated`; accepted does not claim
completed power-off.

The helper remains uninstalled and unwired for deployment. No Atlas host or VM
drill, helper execution, group or user change, setuid change, RTC access or
mutation, D-Bus power request, reboot, or shutdown was performed.

Final validation used Node.js 24.18.0, npm 11.16.0, and Go 1.23.0
linux/amd64. Node passed 172 test files, 2,433 tests, and 3 skipped tests.
The Go suite passed 111 individual tests; formatting, module verification,
vet, tests, and Linux amd64 CGO-disabled builds passed. Node formatting, lint,
typecheck, build, and `git diff --check` passed. Production npm audit reported
zero vulnerabilities. `npm ci` restored the lockfile dependency tree without
changing package metadata. No real helper, host, RTC, D-Bus, wake, reboot, or
shutdown operation was performed.

The final Node run reported three skipped compatibility tests. All are
conditional on the nonproduction deterministic Go fixture environment
variable `ATLAS_MANAGER_POWER_HELPER_FIXTURE`, which is intentionally unset
for the ordinary repository test command so it cannot accidentally select an
executable:

```text
tests/power-management/integration/linux-power-helper-protocol-compatibility.test.ts
  round-trips read requests through the deterministic Go fixture
  round-trips shutdown requests through the deterministic Go fixture
  round-trips mutation requests through the deterministic Go fixture
```

Reason: these process-level TypeScript/Go compatibility checks require the
separately built, nonproduction fixture path. They are not skipped because of
host RTC, D-Bus, installation, privilege, or power-operation availability.
The dedicated fixture compatibility workflow enables that path explicitly and
does not execute the production helper.

The artifact check found no remaining helper binaries, installer/bundle/
qualification binaries, or `.tar.gz` archives outside `.git`. A previously
generated ignored `dist/power-helper/atlas-manager-power-helper` artifact was
removed; no release artifact is retained in the working tree.

## Current work — Issue #260

The active branch is:

```text
feat/configured-machine-operating-policy
```

The authoritative merged PR #259 baseline for this delivery is:

```text
884f6afa724570f07f3cb1a6dda9e3e3fa659817
```

Issue #260 adds ADR-012 and strict immutable `MACHINE_OPERATING_POLICY`
startup configuration. The absent-value default is `{"mode":"always_on"}`;
`manual` and scheduled policies remain available, with scheduled windows
restricted to `America/Sao_Paulo`. A project-owned strict JSON decoder rejects
duplicate fields and bounded malformed input before the existing policy domain
validator canonicalizes the result. The administrative runtime passes one
policy to power composition; backend selection, HTTP activation, and
scheduler activation remain independent.

No automatic scheduler loop or startup tick was added. No helper was installed
or executed, no group or setuid state changed, no host or VM drill occurred,
and no RTC, wake, D-Bus, reboot, shutdown, or other real power effect was
performed.

Final validation for Issue #260:

```text
Node.js       → 24.18.0
npm           → 11.16.0
Node files    → 172 passed
Node tests    → 2,466 passed
Node skipped  → 3
Go tests      → 111 individual tests
format        → passed
lint          → passed
typecheck     → passed
build         → passed
Go format     → passed
go mod verify → passed
go vet        → passed
npm audit     → 0 production vulnerabilities
git diff      → passed
dependencies  → unchanged
```

The three skipped tests are intentionally conditional compatibility checks in
`tests/power-management/integration/linux-power-helper-protocol-compatibility.test.ts`:

```text
round-trips read requests through the deterministic Go fixture
round-trips shutdown requests through the deterministic Go fixture
round-trips mutation requests through the deterministic Go fixture
```

They are skipped because the ordinary test command does not set
`ATLAS_MANAGER_POWER_HELPER_FIXTURE`. The dedicated compatibility workflow
provides the separately built nonproduction fixture path. This prevents the
standard suite from selecting or executing a helper binary implicitly; the
tests do not depend on host RTC, D-Bus, installation, privilege, or power
operation availability.

No host or VM was used for validation. No helper was executed, no group or
user membership was changed, no setuid state was changed, and no RTC, wake,
D-Bus, reboot, shutdown, or other real power effect occurred.

## Current work — Issue #262

The active branch is:

```text
feat/policy-bound-machine-power-scheduler-confirmation
```

The authoritative merged PR #261 baseline for this delivery is:

```text
8f521432b38483ee7f09048f4cf1bf3a1ea8df28
```

Issue #262 adds ADR-013 and a scheduler-only confirmation reader built from
the same immutable canonical machine policy used by planning and occurrence
generation. It regenerates the one-minute interval ending at each candidate
shutdown and confirms only one exact matching occurrence. `always_on` and
`manual` never confirm scheduler shutdowns. Scheduler execution now requires
`executeAt` and receives the scheduler source, policy-bound confirmation, and
`automaticallyPrepare: true`; there is no fallback to `execute`.

Direct and administrative shutdown paths retain their existing confirmation
contracts. Readiness, preparation, claims, wake-before-shutdown ordering, and
failure handling remain authoritative. No scheduler loop, timer, startup tick,
helper request, RTC access, D-Bus request, host or VM drill, reboot, shutdown,
or other real power effect is part of this delivery.

Final validation for Issue #262:

```text
Node.js       → 24.18.0
npm           → 11.16.0
Node files    → 174 passed
Node tests    → 2,481 passed
Node skipped  → 3
Go tests      → 111 individual tests
format        → passed
lint          → passed
typecheck     → passed
build         → passed
Go format     → passed
go mod verify → passed
go vet        → passed
npm audit     → 0 production vulnerabilities
git diff      → passed
dependencies  → unchanged
```

The three skipped tests are the conditional compatibility checks in
`tests/power-management/integration/linux-power-helper-protocol-compatibility.test.ts`:

```text
round-trips read requests through the deterministic Go fixture
round-trips shutdown requests through the deterministic Go fixture
round-trips mutation requests through the deterministic Go fixture
```

They require `ATLAS_MANAGER_POWER_HELPER_FIXTURE`, which is intentionally
unset in the ordinary test command. The dedicated compatibility workflow
provides the separately built nonproduction fixture path; no production
helper, host RTC, D-Bus, installation, privilege, or power operation is used.

No automatic scheduler loop, timer, startup tick, host or VM drill, helper
installation or execution, group or user membership change, setuid change,
RTC access or mutation, D-Bus power request, reboot, or shutdown occurred.

## Current work — Issue #264

The active branch is:

```text
feat/disabled-machine-power-scheduler-lifecycle
```

The authoritative merged PR #263 baseline for this delivery is:

```text
d548477cbee6a1be7f1765d89ef714d68beb7ddb
```

Issue #264 adds ADR-014 and a disabled-by-default machine-power scheduler
lifecycle. `MACHINE_POWER_SCHEDULER_ENABLED` accepts only exact `true` or
`false` and defaults to `false`; enabled operation requires persistent cursor,
permanent occurrence-claim, and administrative event-history files. The loop
starts only after HTTP listening, runs the existing explicit tick immediately,
then waits a fixed 60 seconds after each continuing result. Ticks cannot
overlap, and blocked, incomplete, conflict, timer, or tick failures terminate
the application fail-closed without retry.

Administrative power surfaces and the scheduler use one shared production
power capability bundle and one shared event-history bundle. The scheduler is
independent from HTTP activation, backend selection, and machine policy. The
default remains mock-first, always-on, and scheduler-disabled.

Final validation for Issue #264:

```text
Node.js                            → v24.18.0
npm                                → 11.16.0
Node test files                    → 178 passed
Node tests                         → 2,522 passed
Node skipped tests                 → 3
Go                                 → 1.23.0 linux/amd64
Go tests                           → 111 individual tests
format                             → passed
lint                               → passed
typecheck                          → passed
build                              → passed
go format                          → passed
go mod verify                      → passed
go vet                             → passed
npm audit --omit=dev               → 0 production vulnerabilities
git diff --check                   → passed
dependencies                       → unchanged
```

The three skipped tests are the conditional compatibility checks in
`tests/power-management/integration/linux-power-helper-protocol-compatibility.test.ts`:

```text
round-trips read requests through the deterministic Go fixture
round-trips shutdown requests through the deterministic Go fixture
round-trips mutation requests through the deterministic Go fixture
```

They require `ATLAS_MANAGER_POWER_HELPER_FIXTURE`, intentionally unset by the
ordinary test command so it cannot select an executable implicitly. The
dedicated compatibility workflow supplies the separately built nonproduction
fixture path. No production helper, host RTC, D-Bus, installation, privilege,
or power operation is used.

No scheduler loop was exercised against a real host. No Atlas or VM drill
occurred; no helper was installed or executed; no group or user membership or
setuid state changed; no RTC, wake, D-Bus, reboot, shutdown, or other real
power effect occurred.

## Current work — Issue #266

The active branch is:

feat/linux-power-effects-activation-admission

The authoritative merged PR #265 baseline for this delivery is:

c397132c8fbb0c4bc2ebb6a890b31a6e65a614f0

Issue #266 adds ADR-015 and a disabled-by-default, hash-bound Linux
power-effects startup admission boundary. Exact activation requires
MACHINE_POWER_EFFECTS_ACTIVATION=linux_helper,
MACHINE_POWER_EFFECTS_CONFIRMATION=confirm_linux_helper_power_effects, an
exact lowercase installed-helper SHA-256, and a read-only fixed-path
preflight. Mock operation remains valid without activation; inert Linux
backend selection remains possible when no effect-capable surface is enabled.

The preflight reuses the existing installation inspector, validates safe
parents, root ownership, the reviewed non-root group, mode 04750, setuid,
single link count, process group membership, bounded file size, and a
streaming built-in SHA-256. It performs no helper request, RTC access, D-Bus
power request, wake mutation, repair, installation, or group modification.
Preflight failure occurs before HTTP listening and scheduler startup and never
falls back to mock.

This delivery does not install or execute the helper, change groups or setuid,
access a real RTC, connect to the real system D-Bus for a power request, run a
host or VM drill, reboot, or shut down. Physical deployment, host
qualification, application-user enrollment, firmware wake certification, and
real shutdown certification remain deferred.

Final validation for Issue #266:

```text
baseline                          → c397132c8fbb0c4bc2ebb6a890b31a6e65a614f0
branch                            → feat/linux-power-effects-activation-admission
Node.js                           → 24.18.0
npm                               → 11.16.0
Node test files                   → 180 passed
Node tests                        → 2,568 passed
Node skipped tests                → 3
Go                                → 1.23.0 linux/amd64
Go tests                          → 111 individual tests
format                            → passed
lint                              → passed
typecheck                         → passed
build                             → passed
go format                         → passed
go mod verify                     → passed
go vet                            → passed
npm audit --omit=dev              → 0 production vulnerabilities
git diff --check                  → passed
dependencies                      → unchanged
```

The three skipped tests are the conditional compatibility checks in
`tests/power-management/integration/linux-power-helper-protocol-compatibility.test.ts`:

```text
round-trips read requests through the deterministic Go fixture
round-trips shutdown requests through the deterministic Go fixture
round-trips mutation requests through the deterministic Go fixture
```

They are skipped because the ordinary test command does not set
`ATLAS_MANAGER_POWER_HELPER_FIXTURE`. The dedicated compatibility workflow
provides the separately built nonproduction fixture path. This prevents the
standard suite from selecting or executing a helper binary implicitly; the
tests do not depend on host RTC, D-Bus, installation, privilege, or power
operation availability.

No Atlas host or VM drill was used. No helper was installed or executed, no
group or user membership or setuid state changed, no real RTC or D-Bus power
request occurred, and no wake, reboot, shutdown, or other real power effect
occurred.

## Current work — Issue #268

The active branch is:

`feat/exact-linux-power-runtime-identity-admission`

The authoritative merged PR #267 baseline for this delivery is:

`9a76f016f2bb2092fc2ef3c72834c9e7d64d74f6`

Issue #268 adds ADR-016 and exact Linux runtime identity admission. Admitted
Linux effects require the fixed `atlas-manager` user, primary group
`atlas-manager`, home `/var/lib/atlas-manager`, shell
`/usr/sbin/nologin`, and process membership in `atlas-manager-power`.
Numeric IDs remain host-assigned but are resolved uniquely from bounded, safe
fixed `/etc/passwd` and `/etc/group` inspection.

The immutable identity is inspected only for admitted Linux effects. Disabled,
mock, and inert Linux configurations do not inspect account files. The
resolved helper-group GID is passed to both startup hash preflight and
operation-time helper transport inspection, so another non-root group cannot
substitute for `atlas-manager-power`.

No account, group, membership, ownership, permission, or setuid state was
changed. No helper, host, VM, RTC, D-Bus, wake, reboot, shutdown, or real power
effect was used.

Final validation for Issue #268:

```text
baseline                          → 9a76f016f2bb2092fc2ef3c72834c9e7d64d74f6
branch                            → feat/exact-linux-power-runtime-identity-admission
Node.js                           → 24.18.0
npm                               → 11.16.0
Node test files                   → 181 passed
Node tests                        → 2,607 passed
Node skipped tests                → 3
Go                                → 1.23.0 linux/amd64
Go tests                          → 111 individual tests
format                            → passed
lint                              → passed
typecheck                         → passed
build                             → passed
go format                         → passed
go mod verify                     → passed
go vet                            → passed
npm audit --omit=dev              → 0 production vulnerabilities
git diff --check                  → passed
dependencies                      → unchanged
local helper/archive artifacts    → none
```

The three skipped tests remain the deterministic fixture compatibility checks
listed above and require `ATLAS_MANAGER_POWER_HELPER_FIXTURE`; the standard
suite intentionally does not set that variable.

Identity inspection is read-only and is not performed for disabled, mock, or
inert Linux configurations. No account files were inspected on the real host,
and no account or group was created or modified. The exact resolved helper GID
is shared by startup preflight and operation-time inspection. No host or VM
drill, helper execution, real RTC/D-Bus operation, wake effect, reboot, or
shutdown occurred.
