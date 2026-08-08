# Testing, documentation, release and deployment plan

## Per-slice gates

Each capability commit runs formatting, lint, typecheck and its direct unit,
integration, HTTP and asset tests. Documentation and `docs/capabilities.md` are
updated in the same slice that makes a capability usable.

Resource-intensive suites should run in bounded groups to avoid repeating the
host crash that preceded this planning pass. Full qualification remains
mandatory at the end.

## Full source qualification

Pinned toolchain:

- Node.js `24.18.0`
- npm `11.16.0`
- Go `1.23.0`
- `GOTOOLCHAIN=local`
- deterministic `SOURCE_DATE_EPOCH`

Required gates:

- `npm ci`, format, lint, typecheck and production build;
- all Node tests, including CLI/dashboard/security/scheduler regressions;
- `gofmt`, `go mod verify`, `go vet`, `go test ./...` in deployment and
  power-helper modules;
- production audit zero and reviewed full-audit classifier;
- administrative route catalog and contract validation;
- dashboard generation/equivalence;
- release snapshot validation;
- `git diff --check` and clean worktree.

## Reproducible release

Build Candidate A and an independent Candidate B from the final source commit.
Do not copy built output between candidates. Require:

- archive byte comparison;
- manifest comparison;
- internal `SHA256SUMS` comparison;
- complete bundle directory comparison;
- identical archive digest;
- safe tar inventory and required packaged files.

Only `REPRODUCIBILITY=PASS` can produce immutable release evidence.

## Host and deployment

1. Read-only Atlas qualification: service states, health, listeners, Nginx,
   cloudflared, PM2, runtime/deployment/lifecycle state and current source
   binding.
2. Transfer only the immutable qualified artifact to a new incoming name.
3. Validate digest, manifest, source commit, version, bundle inspection and tar
   safety on Atlas.
4. Back up and minimally update the migration/deployment script.
5. Require an atomic preflight and no concurrent migration.
6. Deploy with rollback armed.
7. Validate CLI commands, dashboard pages, RBAC, audit, local/external routes,
   logs and lifecycle probes.

Power remains mock/disabled during rehearsal and first deployment validation.

## Documentation deliverables

- `README.md`: purpose, architecture, access, CLI/dashboard and subsystem
  overview with links.
- `docs/operator-runbook.md`: CLI-first operations; shell commands only under
  break-glass troubleshooting.
- `docs/cli.md`: complete command reference and side effects.
- `docs/scheduling.md`: policies, transitions, reconciliation, stores and
  adapter-independent examples.
- `docs/dashboard.md`: pages, components, API mapping, permissions and states.
- `docs/capabilities.md`: updated in every capability commit.
- ADRs for presentation boundaries, CLI identity and any machine-policy store.

## Acceptance matrix

The final report must derive its PASS values from evidence. No item is marked
deployed based only on source tests. Required operator flows and Definition of
Done remain those in the milestone prompt.
