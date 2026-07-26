# Agent handoff

This document records the current implementation context for the next agent
working on Atlas Manager. It is intentionally repository-local and contains no
credentials or machine-specific configuration.

## Current work

The active branch is:

```text
test/file-backed-multi-service-partial-reconciliation-recovery
```

The branch contains the test/documentation work for the multi-service partial
reconciliation recovery scenario. The implementation is committed in:

```text
4ead765 test: add file-backed multi-service partial reconciliation recovery coverage
```

Do not reset or discard that commit when continuing.

The implementation commit contains:

- `tests/service-management/integration/file-backed-multi-service-partial-reconciliation-recovery.test.ts`
- `README.md`

The current handoff-only uncommitted files are:

- `AGENTS.md`
- `docs/agent-handoff.md`

No production source file, dependency, persistence schema, or configuration
file was changed.

## Scenario implemented

The integration test uses two deterministic PM2-registered services and the
real service-management composition, scheduler cycle, reconciliation tick,
occurrence executor, and all three file-backed stores. It creates a temporary
directory containing the override, occurrence-claim, and scheduler-cursor
files, and removes it in `afterEach` even after failures.

The timeline is fixed at UTC `T0 = 2026-07-27T12:00:00.000Z` and
`T1 = 2026-07-27T20:00:00.000Z`. Both services produce a current stop
occurrence at `T1` in the same Monday schedule interval.

- `service-a` reaches the controlled PM2 control executor and succeeds.
- `service-b` reaches the same executor after its claim is persisted and
  throws a deterministic test error.
- The first tick therefore resolves with a mixed report: one successful
  occurrence result and one failed occurrence result.
- Override pruning removes both expired overrides, claim pruning removes the
  historical claims through `T0`, and both current claims remain protected.
- The first scheduler result is frozen and `incomplete`; its cursor remains
  `T0` and is not advanced.
- A newly constructed composition retries the same interval. Both occurrences
  are duplicates, so neither service operation is run again.
- Retry maintenance is idempotent (`no_override` and `unchanged`), and the
  scheduler advances the persisted cursor to `T1`.

The test asserts service identity rather than relying on report array position.
It also asserts one successful control effect for service A and no successful
control effect for service B. It documents the existing at-most-once behavior
after claim acquisition: a failed external operation is not automatically
replayed, and this is not transactional exactly-once execution.

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

All passed. The test suite reported 69 files and 1551 tests passing, and the
production-dependency audit reported zero vulnerabilities. `nvm` was not
available as a shell command in the handoff environment, so the explicit Node
24 installation path was used.

## Next steps

1. Review the implementation commit and the handoff-documentation diff.
2. Run the required checks again if the files are changed.
3. Commit the handoff documentation using a Conventional Commit, for example:
   `docs: add agent handoff context`.
4. Push the short-lived branch and open the Issue-specific pull request using
   the repository's normal review workflow.

Do not add production replay logic, new reconciliation result kinds, cross-store
transactions, locking guarantees, or external PM2/network operations as part
of this scenario.
