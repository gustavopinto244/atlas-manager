# Operator Experience reconciliation + Slice 4 completion — final report

2026-08-10

## Initial state

- Source HEAD: `298ffa95f53fa18b48221f6c81df26279d9ea9e9` (merge of Operator
  Dashboard v2 Slice 3, #313), confirmed against `origin/main` via
  `git fetch` before any change.
- `docs/milestones/operator-experience/` (12 files) and
  `docs/milestones/operator-experience-inventory.md` had not been read in
  this working session before this reconciliation began.
- Slice 4 backend and frontend work (candidate-policy preview, weekly editor
  overhaul, timeline current-state display) had already been implemented
  and pushed as PR #314 in a prior turn of this session, targeting `main`
  after Slices 2/3 merged. This reconciliation continues on that branch's
  content rather than redoing it.

## What was already implemented (verified, not re-built)

- Security/contracts repair: the unauthenticated dashboard read exception
  described as a "decisive security divergence" in
  `00-current-state-and-divergences.md` was already removed; regression
  suite green.
- CLI foundation: 23 command nodes, 16 implemented and read-only, exactly
  matching `operator-experience-inventory.md`'s 2026-08-09 claim (verified
  against `src/cli/command-tree.ts`, not assumed).
- Dashboard shell/navigation, service resource observability, registered-
  service policy persistence and precedence, PM2/Docker/Compose behind the
  shared registered-service domain — all pre-dated this reconciliation pass
  (Slices 1-3, plus pre-existing schedule/override/preview capabilities).

## Stale planning statements corrected

| Statement                                                     | Where                                        | Correction                                                                                        |
| ------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| "45 route descriptors"                                        | README.md, 00-current-state, capabilities.md | 47, pointed at `tests/http/administrative-api-contract.test.ts` instead of a static number        |
| "no schedule editor or timeline" (2026-08-08 baseline)        | 00-current-state                             | Already marked historical; left untouched, correctly superseded by the current-state document     |
| "five-file asset contract... backup.js and event-history.js"  | docs/dashboard.md                            | Corrected to the real three-file contract; explained why the other two were retired (Slice 2)     |
| "Unresolved decisions" table listing 3 already-resolved items | 10-phase-traceability.md                     | Moved to a new "Resolved decisions" section with evidence; only 3 genuinely open decisions remain |

## Real source gaps found and fixed by this reconciliation

1. **`catalogSha256` field, corrected twice.** Investigated per the Slice 3
   commit's own flagged gap. A first pass concluded, from a grep across
   `scripts/`, `deployment/` and `tests/`, that no generator or verifier
   existed for it, and removed the field. That grep missed the actual
   consumer: `.github/workflows/ci.yml`'s release gate imports
   `createAdministrativeApiContract()` from
   `src/http/administrative-api-contract.ts` directly and fails the build if
   its `.sha256` output does not match `catalogSha256`, so removing the
   field broke CI on PR #316. The field is restored with the digest that
   function actually computes over the current 47-route catalog
   (`912e575b5415b25b2d51c6bdcdb1a1acb1c1878734349091cd4678bbdfe32396`), and
   the reconciliation test now asserts equality with that live output
   instead of asserting the field's absence.
2. **Route-order drift.** Writing the reconciliation test
   (`tests/http/administrative-api-contract.test.ts`) immediately caught a
   real bug: the published contract's `routeIds` did not match the live
   catalog's order after Slices 3-4 added two routes. Fixed and now
   automatically verified on every test run.
3. **Untested policy precedence.** `PolicyAwareRegisteredServiceCatalog`'s
   precedence (environment base → full replacement by a persisted policy →
   temporary override applied at evaluation time) was implicit in code with
   only one test covering the "override present" case. Added three tests
   covering the fallback case, the full-replace-not-merge behavior, and
   `list()` parity with `findById()`.
4. **Preview response missing a source label.** Added `source:
"candidate_preview"` to the new draft-preview use case's result, at the
   application boundary (not the shared domain evaluator, which also backs
   the unrelated persisted-policy preview).
5. **Pre-existing, unrelated CI breakage: hardcoded stale version string.**
   Diagnosing the `catalogSha256` CI failure surfaced a second, independent
   defect in `.github/workflows/ci.yml`'s release gate: `test
"$(node -p "require('./package.json').version")" = "1.0.0-rc.8"`, a
   literal frozen at the rc.8 release cut (PR #306) with no authoritative
   source to stay in sync with and never updated since. It ran before the
   `catalogSha256` check in the same `set -e` step, so it — not the digest —
   was the actual first failure point. `git log`/`gh run list` confirm this
   has failed CI on every push to `main` since PR #308 (5 merges: #308,
   #309, #310, #311, #313), unrelated to this branch's content. Removed the
   dead comparison (nothing else in the repository defines an "expected"
   version to check package.json against; the same step already reads
   `package.json`'s version dynamically everywhere else it needs it) and
   replaced the two artifact-name literals that also hardcoded `1.0.0-rc.8`
   with the same dynamically-read version, exported once via `$GITHUB_ENV`.

## Slice 4 gaps found, not fixed (deferred with reasons)

See `docs/reviews/operator-experience-slice4-gap-analysis.md` for the full
per-requirement table. Summary of what remains open:

- Multiple windows per day in the editor UI (domain already supports it).
- Active override + expiry on the timeline (needs a small new backend read).
- Following transitions, plural (needs repeated evaluator calls, not new
  domain logic).
- `evaluatedAt` as a distinct field on the preview response.
- Scheduler cursor/health per service (no authoritative API at that
  granularity yet).
- CLI exposure of the candidate-preview endpoint (read-only, not blocked by
  the CLI identity ADR, but a separate small feature).

None of these block Slice 4's own acceptance criteria; each is independently
implementable later without touching what shipped in this pass.

## Implementation delivered (this reconciliation pass, beyond Slice 4 itself)

- `tests/http/administrative-api-contract.test.ts` (new) — ongoing route
  catalog/contract reconciliation.
- `tests/service-management/infrastructure/policy-aware-registered-service-catalog.test.ts`
  — three new precedence tests.
- `src/service-management/application/preview-registered-service-availability-policy.ts`
  — `source` tag on the candidate-preview result.
- `docs/contracts/atlas-manager-administrative-api.json` — `catalogSha256`
  restored with the real digest from `createAdministrativeApiContract()`,
  `routeIds` order corrected.
- `.github/workflows/ci.yml` — removed the dead, hardcoded `1.0.0-rc.8`
  version comparison and the two artifact-name literals that shared the same
  staleness; both now derive from `package.json`'s actual version.
- `docs/pre-deploy-audit.md` — finding 8 marked resolved with evidence.
- Full `docs/milestones/operator-experience/` and `docs/capabilities.md`
  reconciliation (see the dedicated reconciliation commit).
- `docs/scheduling.md`, `docs/dashboard.md` — narrative updates for
  capabilities that existed in source but were undocumented or
  misdocumented.

## External blockers

- **Task Manager registration and any live scheduling acceptance on
  Atlas**: `BLOCKED_EXTERNAL_NO_SSH`. No SSH session is active in this
  environment. All source work for scheduling is independent of this and is
  complete; only the physical registration/acceptance steps are blocked.
- No other external blocker was encountered. Every other named blocker in
  the original prompt (host qualification, physical power, infrastructure
  diagnostics, CLI mutations) is a deliberate, documented deferral gated on
  a decision or a track that was never started — not something this session
  attempted and failed at.

## Security invariants preserved

Unchanged throughout: Cloudflare Access assertion verification, Host/Origin
envelope, fetch-metadata policy, RBAC, admission/mutation gates, audit
trail, request/body/target limits, strict JSON parsing. No route was added
without a corresponding security-catalog descriptor (permission, request
policy, confirmation policy, audit policy). Power remains
`POWER_MANAGEMENT_BACKEND=mock`, `MACHINE_POWER_EFFECTS_ACTIVATION=disabled`,
`MACHINE_POWER_SCHEDULER_ENABLED=false` throughout — never touched by this
pass. No automated test invoked a real process stop/start, container
mutation, Nginx/cloudflared change, or power effect; all scheduling tests
use fakes/fixtures/in-memory stores.

## Test evidence

- Node: 231 test files, 2905 tests passed, 3 skipped.
- `npm run lint`, `npm run typecheck`, `npm run format:check`: clean.
- `npm run build`, `npm run build:deployment`: succeed; dashboard bundles to
  the real 3-file asset contract (`app.js`, `styles.css`, `index.html`),
  verified by `npm run dashboard:generate-assets`'s manifest output.
- `npm run package:operator`: builds `atlas-manager-operator-cli-1.0.0-rc.13.tgz`
  successfully.
- `npm audit` (production and full): 0 vulnerabilities at any severity.
- `deployment/`: `gofmt` clean, `go mod verify` passed, `go vet ./...`
  clean, `go test ./...` all pass.
- `power-helper/`: `gofmt` clean, `go mod verify` passed, `go vet ./...`
  clean, `go test ./...` all pass (fake/fixture transports only).
- Working tree: clean.

Dashboard-asset **served-bundle** equivalence (source vs. the exact bytes an
installed bundle would serve) was not re-verified end-to-end in this pass —
that requires the full Go bundle pipeline (`deployment/internal/bundle`),
which is unit-tested and green, and whose `copyDashboardAssets` function
enforces the identical three-file `expected` list this reconciliation
confirmed at the source level. A full `npm run dashboard:verify-assets`
invocation needs a built bundle directory as an argument and was not run
standalone in this pass; nothing in this reconciliation touched the bundle
pipeline itself, so this is a pre-existing, unchanged gate rather than a new
risk.

## Next milestone

Recommended sequence, derived from the now-current `10-phase-traceability.md`
and this reconciliation's own findings, not assumed from the original
milestone prompt:

1. Maintainer decision: formally accept ADR-027 (source already conforms to
   it).
2. Accept ADR-028 (local/remote CLI identity boundary) before adding any
   mutating CLI command.
3. Add authenticated mutating CLI commands (`services start/stop/restart`,
   schedule mutations) once ADR-028 lands.
4. Start the infrastructure-diagnostics track (`atlas infra`/`nginx`/
   `tunnel`, dashboard Infrastructure page beyond the current security-
   posture summary).
5. Close the remaining Slice 4 follow-ups (multi-window editor UI, override/
   expiry display, following-transitions preview, CLI candidate-preview
   command) as their own small, reviewable slices.
6. Close remaining Operator Experience documentation/runbook gaps
   (`docs/operator-runbook.md` v3 per `09-testing-release-and-deployment.md`).
7. Run final full source qualification and build independent Candidate A/B.
8. Perform read-only Atlas host qualification.
9. Register/validate Task Manager (currently `BLOCKED_EXTERNAL_NO_SSH`).
10. Deploy the qualified release with rollback armed; operator acceptance.
11. Only after that: begin physical-power host qualification as its own,
    separate milestone.
