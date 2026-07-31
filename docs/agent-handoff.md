# Agent handoff

## Current work

The active branch is:

```text
feat/mock-safe-machine-shutdown-preparation
```

It starts from the merged Issue #229 baseline commit `3f18b3a` and extends
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

No real RTC device, kernel file, system bus, child process, executable,
filesystem write, privileged interface, HTTP endpoint, timer, automatic
scheduler, persistence, retry, rollback, compensation, or real machine power
operation exists in this slice. Readiness is evaluated before claims and
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
npm ci                         PASS — lockfile unchanged; one dev-tree advisory reported
npm run format:check          PASS
npm run lint                  PASS — 0 errors, 0 warnings
npm run typecheck             PASS
npm test -- --maxWorkers=1     PASS — 147 files, 2204 tests
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

The baseline is `3f18b3a`. Validation for this working tree is currently
passing with 147 test files and 2,204 tests. The new dedicated coverage spans
preparation plans, events, mocks, service stopping, occurrence execution,
composition, scheduler retry, and complete integration scenarios. No
dependency changes were made.

The new slice uses one shared process-local mock wake-alarm state for the
independent wake-alarm reader, wake-alarm controller, and RTC reader. It has no
real RTC effects, persistence, timers, child processes, filesystem writes,
privileged operations, HTTP exposure, or machine power effects.

## Next recommended work

Define the remaining mock-first v0.6 infrastructure boundary for reviewed RTC,
wake-alarm, and shutdown adapters. This should include a security ADR covering
fixed command construction, least privilege, bounded output, timeouts,
confirmation, authorization, auditing, supported operating systems, and
failure/recovery behavior before any real machine effect is enabled.

Do not reset, discard, commit, push, merge, or open a Pull Request without the
project owner's approval.
