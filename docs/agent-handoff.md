# Agent handoff

This document records the current implementation context for the next agent
working on Atlas Manager. It is intentionally repository-local and contains no
credentials or machine-specific configuration.

## Current work

The active branch is:

```text
test/file-backed-post-advance-override-pruning-failure-recovery
```

This branch starts from the updated `main` at:

```text
5dea734 test: add post-advance claim-pruning failure recovery coverage (#183)
```

The current Issue's changes are not committed yet. Do not reset or discard
the existing work when continuing.

Current Issue changes:

- `tests/service-management/integration/file-backed-post-advance-override-pruning-failure-recovery.test.ts`
- `README.md`

The handoff document itself is also modified to preserve this context for the
next agent. No production source file, dependency, persistence schema, or
configuration file was changed.

No production source file, dependency, persistence schema, or configuration
file was changed.

## Scenario implemented

The integration test uses one deterministic PM2-registered service and the
real service-management composition, scheduler cycle, reconciliation tick,
occurrence executor, and all three file-backed stores. It creates a temporary
directory containing the override, occurrence-claim, and scheduler-cursor
files, and removes it in `afterEach` even after failures.

The timeline is fixed at UTC `T0 = 2026-07-27T12:00:00.000Z`,
`T1 = 2026-07-27T20:00:00.000Z`, and
`T2 = 2026-08-03T12:00:00.000Z`. The Monday schedule produces one occurrence
in each interval.

- The first process executes the `T0 → T1` effect, preserves its claim through
  `T0`, and advances the cursor to `T1`.
- The second process persists and executes the `T1 → T2` effect, then fails
  the first conditional expired-override removal through a test-local wrapper.
- The scheduler returns frozen `incomplete` with a null claim-pruning result;
  the cursor remains `T1`, and the override plus both claims remain persisted.
- A reconstructed retry sees the second occurrence as duplicate, removes the
  override, prunes the first claim through authoritative `T1`, preserves the
  current claim, and advances to `T2`.

The test asserts exact error/report behavior, persisted state, effect counts,
and the existing at-most-once behavior after claim acquisition. It does not
claim transactional rollback or globally exactly-once execution.

## Validation already completed

Validation was run with the repository's Node.js 24 installation (`v24.18.0`):

```text
npm ci
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
git diff --check
npm audit --omit=dev
```

All passed. The test suite reported 72 files and 1554 tests passing, and the
production-dependency audit reported zero vulnerabilities. `nvm` was not
available as a shell command in the handoff environment, so the explicit Node
24 installation path was used.

## Next steps

1. Review the test, README, and handoff-documentation diff.
2. Commit using a Conventional Commit, for example:
   `test: cover post-advance override-pruning failure recovery`.
3. Push the Issue-specific branch and open the pull request using the normal
   review workflow.

Do not add production replay logic, new reconciliation result kinds, cross-store
transactions, locking guarantees, or external PM2/network operations as part
of this scenario.
