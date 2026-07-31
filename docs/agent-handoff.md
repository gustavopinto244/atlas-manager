# Agent handoff

## Current work

The active branch is:

```text
feat/mock-machine-operating-schedule-and-power-planning
```

It starts from `main` at commit `01bb0df` after Pull Request #222 and extends
the isolated `src/power-management/` feature boundary with immutable machine
operating policies, weekly operating windows, explicit timezone validation,
deterministic schedule evaluation, next-shutdown and next-wake planning, and
the `getMachinePowerPlan` application capability.

The safe default is `always_on`: the machine is expected to operate and no
automatic shutdown or wake transition is planned. Scheduled policies use the
explicit `America/Sao_Paulo` timezone and the Node.js runtime timezone
database. The new result is schedule intent only.

No real RTC device, kernel file, system bus, child process, executable,
filesystem write, privileged interface, HTTP endpoint, scheduler integration,
persistence, timer, automatic mock transition, or real machine power operation
exists in this slice. Power-plan queries do not mutate the existing mock
wake-alarm state and do not invoke the mock shutdown controller.

## Validation

Using Node.js 24.18.0 and npm 11.16.0:

```text
nvm use                       NOT AVAILABLE — nvm is not installed in the shell
npm ci                        PASS — lockfile unchanged; one dev-tree advisory reported
npm run format:check          PASS
npm run lint                  PASS — 0 errors, 0 warnings
npm run typecheck             PASS
npm test -- --maxWorkers=1    PASS — 126 files, 2104 tests
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

The new slice uses one shared process-local mock wake-alarm state for the
independent wake-alarm reader, wake-alarm controller, and RTC reader. It has no
real RTC effects, persistence, timers, child processes, filesystem writes,
privileged operations, HTTP exposure, or machine power effects.

## Next recommended work

Implement project-owned machine-power occurrences, duplicate-protected mock
transition claiming and execution, and coordination of planned transitions
with mock wake scheduling and simulated shutdown. Define failure, partial
effect, confirmation, and duplicate behavior before combining mutation
capabilities. Keep service schedules and machine schedules separate; real RTC
and privileged power adapters remain deferred until confirmation,
authorization, auditing, and least-privilege boundaries are explicitly
designed.

Do not reset, discard, commit, push, merge, or open a Pull Request without the
project owner's approval.
