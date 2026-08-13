# Atlas Manager 1.0.0 — final reconciliation and power-hardening review

## Decision

**PASS_WITH_DOCUMENTED_LIMITS**

The `1.0.0` source, normative documentation, versioned release snapshots, and
deployment contracts are reconciled for maintenance. The default installation
is now explicitly mock-only and carries no power-helper execution group. Real
physical power remains outside this review and was neither activated nor
tested.

The documented limits are operational evidence boundaries, not known software
failures: infrastructure diagnostics were disabled on the accepted host,
backup acceptance observed an empty target catalog, rollback was proven by
tests and structural readiness rather than a live production drill, and real
RTC/wake/shutdown behavior remains unqualified.

## Baseline and method

- Repository: `gustavopinto244/atlas-manager`.
- Baseline: `main` commit `818daf2` on 2026-08-13.
- Release identity: `1.0.0`; no version, tag, or release change was made.
- Authority order: current source and tests, accepted ADRs, current normative
  documents, then explicitly historical audit/release snapshots.
- Source-derived inventory: 52 administrative route descriptors and 39 CLI
  command nodes, all implemented, with zero stubs.
- Safety boundary throughout the review:
  `POWER_MANAGEMENT_BACKEND=mock`,
  `MACHINE_POWER_EFFECTS_ACTIVATION=disabled`, and
  `MACHINE_POWER_SCHEDULER_ENABLED=false`.

No Atlas host access, helper installation, systemd mutation, RTC access, wake
alarm, shutdown, reboot, suspend, hibernate, or other physical effect occurred.

## Divergences found and reconciled

1. The requirements generator classified FR-037 as
   `deferred_by_accepted_scope` despite a complete packaged administrative CLI.
2. FR-022 through FR-027 used a single `physical_gate` classification that hid
   already-implemented software and control-plane behavior, especially the
   persisted machine operating policy in FR-026.
3. The capability matrix retained historical 48-route/36-command counts and
   partial/deferred descriptions for capabilities delivered before GA.
4. Current-looking security and architecture prose still described the
   pre-Cloudflare/pre-RBAC foundation, `src/main.ts` as an incomplete
   bootstrap, and only human `administrator:` actor IDs.
5. Roadmap, milestone, audit, handoff, and generic v1 release documents could
   be mistaken for current state while preserving RC-era statements.
6. Product and release language did not always separate software qualification
   from real RTC/wake/shutdown effects.
7. The default systemd unit carried the `atlas-manager-power` supplementary
   group and omitted helper-incompatible hardening even though GA defaults to
   the mock backend.
8. GitHub Actions were pinned to mutable release tags.
9. Service-token examples did not consistently explain least-privilege role
   selection or the separation between a required human/bootstrap
   administrator and automation principals.
10. Detached CI release evidence still listed Atlas deployment and Cloudflare
    ingress as open gates even though GA acceptance records them separately.

## Requirements and capability traceability

`scripts/requirements-traceability-status.json` is now the reviewed
machine-readable classification source consumed by
`scripts/generate-requirements-traceability.mjs`; the generated Markdown is no
longer the only place where scope is encoded.

- FR-004 and FR-015 remain `deferred_by_accepted_scope`.
- FR-037 is `implemented`, backed by ADR-027/031/032/034, the 39-node command
  inventory, CLI tests, and operator-package validation.
- FR-022, FR-024, FR-025, FR-026, and FR-027 are
  `implemented_with_physical_gate`: their software/control-plane paths exist,
  while the specific physical qualification or future authority decision is
  named separately.
- FR-023 remains implemented because its requirement is explicitly mock power
  operation.
- The capability matrix has a regression-tested machine-readable inventory
  marker tied to the live route catalog, administrative API contract, and CLI
  command tree. Current counts are 52 routes, 39 implemented commands, and zero
  stubs.

The release evidence generator now records the CLI as implemented and points
to GA operational acceptance separately from CI-only deterministic evidence.

## Current documentation reconciled

The review updated the current requirements, capabilities, architecture,
security model, product vision, roadmap, security policy, installation and
service lifecycle runbooks, CLI guidance, release evidence, and operational
acceptance boundaries. Historical material was retained rather than rewritten:

- the generic v1 security review and operational-readiness record are clearly
  labeled as `1.0.0-rc.8` snapshots;
- `docs/audit/PROJECT_AUDIT.md` and related rc.1 gap/traceability documents
  carry prominent historical notices and remediation/GA links;
- operator-experience plans retain their dated counts and decisions but point
  to the regression-tested current inventory;
- the agent handoff identifies the current `1.0.0` baseline and treats the
  remaining RC sections as an archive.

`SECURITY.md` deliberately distinguishes software guarantees, deployment-
specific Atlas/Cloudflare evidence, and the independent physical-power gate.

## Machine-policy and physical-authority boundary

ADR-033 remains intact. The editable persisted machine operating policy is a
declarative control-plane resource. The currently disabled scheduler consumes
its separately configured environment policy; the repository does not silently
make the persisted CRUD policy authoritative for physical effects.

Choosing which policy becomes authoritative, and how migration/integration is
qualified, is a future physical-activation decision. This review documents the
boundary without selecting a policy or enabling the scheduler.

## systemd and power hardening

ADR-035 adds two explicit deployment profiles:

- `mock` is the default and the only profile installed by the current
  installer. It has no `SupplementaryGroups` directive or
  `atlas-manager-power` authority and adds `NoNewPrivileges=true` and
  `RestrictSUIDSGID=true`, while preserving existing state, filesystem, and
  network restrictions.
- `power-enabled` is a separately checksummed future template. Selecting it
  requires the exact profile name through the code contract; empty, unknown,
  helper-presence, or installer-driven implicit selection does not exist. The
  current installer never copies this template into the active unit.

The profile validators reject extra supplementary groups, cross-profile
directives, helper paths, backend selection, effects activation/confirmation,
expected-helper digest settings, scheduler activation, and power HTTP flags.
Current lifecycle and qualification verification accept only the mock profile.
Exact old power-ready units are accepted solely during managed-upgrade
preflight and are replaced by the new mock unit before verification or
activation.

Mock runtime verification also rejects effective membership in the helper
group. The future power identity contract continues to require the exact
reviewed group, so neither contract can silently drift into the other.

ADR-015 remains the activation authority. No profile selects a backend,
activates routes or scheduler, supplies the activation confirmation, weakens
the fixed helper path/digest requirement, adds sudo or discovery, enables HTTP
activation, or introduces a Linux fallback.

## Supply-chain and service-principal guidance

Every third-party GitHub Action in CI is pinned to its reviewed immutable
commit, with the human release tag retained as a comment:

- `actions/checkout` v4.2.2 —
  `11bd71901bbe5b1630ceea73d27597364c9af683`;
- `actions/setup-go` v5.5.0 —
  `d35c59abb061a4a6fb18e82ac0862c26744d6ab5`;
- `actions/setup-node` v4.4.0 —
  `49933ea5288caeca8642d1e84afbd3f7d6820020`;
- `actions/upload-artifact` v4.6.2 —
  `ea165f8d65b6e75b540449e92b4886f43607fa02`.

A regression test rejects tag pins, unreviewed SHAs, or missing version
comments. CI behavior is otherwise unchanged.

Current examples recommend the narrow role matching each automation and
separate unrelated service principals. The administrative configuration
example keeps the schema-required human/bootstrap `administrator` assignment
but places automation roles on a different principal. The historical GA record
continues to state that its real acceptance service principal used
`administrator`; no production configuration is invented or rewritten.

## Validation

Completed locally against the changed source:

- `npm run format:check` — passed;
- `npm run lint` — passed;
- `npm run typecheck` — passed;
- full `npm test` with the deterministic power-helper fixture — 260 files,
  3,482 tests passed;
- deployment `gofmt -l`, `go vet ./...`, and `go test ./... -count=1` — passed;
- power-helper `gofmt -l`, `go vet ./...`, and `go test ./... -count=1` —
  passed;
- focused traceability, inventory, action-pinning, API-contract, CLI-contract,
  systemd-profile, runtime-identity, installer, and bundle tests — passed.
- `npm run build` and authoritative dashboard generation — passed;
- packaged dashboard source/bundle/served-asset equivalence — passed (three
  reference files and two served assets);
- `npm run package:operator`, archive SHA-256 verification, temporary install,
  and `atlas --help` smoke — passed;
- production and full dependency audits — zero reported vulnerabilities;
- versioned release snapshot validation and the live 52-route administrative
  API contract reconciliation — passed;
- helper bundle A/B archive and manifest reproducibility — byte-identical;
- Atlas Manager bundle A/B archive and manifest reproducibility —
  byte-identical;
- complete administrative release rehearsal A/B — passed with byte-identical
  evidence;
- generated evidence, contract, digest chain, deployment-bundle metadata, and
  `npm run release:validate` — passed.

The reproducible bundle gate used checksum-verified official toolchains in an
isolated `/tmp` directory: Node 24.18.0 with npm 11.16.0 and Go 1.23.0, exactly
matching the release contract. Nothing was installed system-wide.

The first full Node attempt inside the restricted workspace sandbox was not a
software failure: Supertest listeners and fixture subprocesses were denied with
`listen EPERM`. The same full suite passed outside that socket restriction with
the deterministic fixture. No real helper was invoked.

## External operational evidence limits

No new real-host evidence was fabricated or inferred:

- infrastructure diagnostics remain unexercised in GA acceptance because the
  capability was disabled on that host;
- backup acceptance used `targets: []` and therefore did not prove a live
  backup run;
- rollback is structurally ready and integration-tested, but no live rollback
  drill occurred in that acceptance;
- physical helper installation/ownership, RTC wake behavior, shutdown effects,
  and physical scheduler authority remain unqualified.

These limits justify `PASS_WITH_DOCUMENTED_LIMITS`; they do not downgrade the
verified software paths to failures and do not authorize host mutation.

## Explicit safety confirmation

This stabilization did not install or discover a helper, call systemd, touch an
RTC, set a wake alarm, invoke logind, or request shutdown/reboot/suspend/
hibernate. The default remains mock/effects-disabled/scheduler-disabled, and
the future power-enabled template is inert and unselected.
