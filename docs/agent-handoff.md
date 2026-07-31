# Agent handoff

## Current work

The active branch is:

```text
feat/secure-linux-power-helper-foundation
```

It starts from the merged Issue #231 baseline commit `8ceb286` and extends
the isolated `src/power-management/` feature boundary with immutable machine
operating policies, weekly operating windows, explicit timezone validation,
deterministic power planning, shutdown occurrences, process-local claims, and
duplicate-protected explicit execution with file-backed claims, scheduler
cursors, bounded interval generation, explicit scheduler ticks, and a
fail-closed safe-shutdown readiness boundary with explicit mock preparation,
dependency-aware service stopping, idempotent task/backup/filesystem
boundaries, ordered preparation events, and final readiness reevaluation.

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
npm ci                         PASS — lockfile unchanged; npm reported one dev-tree advisory
npm run format:check          PASS
npm run lint                  PASS — 0 errors, 0 warnings
npm run typecheck             PASS
npm test -- --maxWorkers=1     PASS — 153 files, 2238 tests
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

## Next recommended work

Complete the activation prerequisites in ADR-002, in separate reviewed Issues
before enabling the future external helper: persistent administrative audit,
authenticated and authorized power operations, documented deployment and
permission ownership, recovery procedures, supported Linux verification,
operator-visible failures, and security review of the helper implementation.

Do not reset, discard, commit, push, merge, or open a Pull Request without the
project owner's approval.
