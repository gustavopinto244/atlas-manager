# Atlas Manager 1.0.0

## Scope

Identity promotion only — no functional change since `1.0.0-rc.15`. This is
the exact commit that passed real-host deployment and acceptance testing
(including, for the first time, real Cloudflare Access verification of the
ADR-034 CLI service-token path); see
`docs/release/atlas-manager-1.0.0-final-operational-acceptance-evidence.md`
for the full acceptance record and the operator's GA decision.

The one change that isn't purely a version string is
`scripts/validate-release-artifacts.mjs`'s version-format check, loosened
from requiring `X.Y.Z-rc.N` to also accept a bare `X.Y.Z`. This is release
tooling, not product behavior, and was landed as its own reviewable commit
ahead of this identity bump.

## What shipped to reach this point

`1.0.0` incorporates everything through `1.0.0-rc.15`: the full Operator
Experience milestone series, Settings contracts, machine operating policy
persistence (ADR-033), the remaining product gaps closed in rc.14, and the
dashboard Design v3 rebuild plus CLI Cloudflare Access service-token
identity (ADR-034) formalized in rc.15. See `CHANGELOG.md` for the
itemized history and the individual `docs/release/atlas-manager-1.0.0-rc.*.md`
notes for each candidate's own detail.

## Release identity

`package.json`, `package-lock.json` and `tests/cli/main.test.ts` are
reconciled to `1.0.0`. The diff against the accepted `1.0.0-rc.15` commit
(`956826e07c916b512fe408ef9eae28b65ead7f17`) is confirmed limited to release
identity and documentation files — no application source changed. The
release contract, evidence and digests snapshots are produced by the
project's own generators at qualification time, against the real source
commit, not hand-edited.

## Verification

Full qualification was re-run in full against this exact `1.0.0`-versioned
artifact — not partially, because the contract/evidence/digests chain
cross-hashes every version-stamped file, so a different `-version` value
produces a genuinely different artifact that must be independently
qualified: Node test suite, Go tests (deployment + power-helper), `npm
audit`, the administrative configuration qualification matrix, packaged
dashboard asset equivalence, the release rehearsal (byte-identical A/B), and
Candidate A/B bundle reproducibility (byte-identical tarball and
`MANIFEST.json`).

Manual real-host re-acceptance was **not** repeated for this promotion: the
empty functional diff against the already-accepted rc.15 commit is the
basis for that decision, not an assumption.

Power remains mock-only:

- `POWER_MANAGEMENT_BACKEND=mock`
- `MACHINE_POWER_EFFECTS_ACTIVATION=disabled`
- `MACHINE_POWER_SCHEDULER_ENABLED=false`

## Deferred

Operator Dashboard v2 automatic polling scope beyond Services, and Compose
resource aggregation semantics, remain open — see `docs/capabilities.md`'s
"Known deferred items" section and `docs/roadmap.md`'s `v1.1` scope.
