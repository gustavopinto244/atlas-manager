# Agent handoff

## Current work

The active branch is:

```text
feat/mock-administrative-access-control
```

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
npm ci                        PASS — lockfile unchanged; one pending esbuild script warning and one development-tree advisory
npm run format:check          PASS
npm run lint                  PASS — 0 errors, 0 warnings
npm run typecheck             PASS
npm test -- --maxWorkers=1    PASS — 160 files, 2264 tests
npm run build                 PASS
git diff --check              PASS
npm audit --omit=dev          PASS — 0 production vulnerabilities
```

No dependency changes were made. The development-tree advisory reported by
`npm ci` was not fixed or changed; the production audit is clean.

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

## Next recommended work

The next recommended prerequisite after this issue is selecting and
implementing the production administrative identity mechanism. It must define
credential/assertion verification, protected HTTP delivery, transport and
proxy validation, deployment ownership, recovery procedures, and
operator-visible failures before any real helper activation. Deployment
ownership, supported Linux verification, and helper security review remain
separate prerequisites.

Do not reset, discard, commit, push, merge, or open a Pull Request without the
project owner's approval.
