# Changelog

## Unreleased

- adds a per-route HTTP study guide (`study/`, one document per registered
  route grouped by domain) written while re-learning the request flow of
  every administrative endpoint;
- fixes several HTTP error-mapping bugs surfaced while writing those docs:
  invalid service availability policies and invalid event-history retention
  policies were responding `503`/`500` instead of `400`, an out-of-range
  `limit` on `GET /admin/backups/runs` responded `503` instead of `400`,
  and a rejected `DELETE /admin/event-history/retention` reported an
  incomplete `Allow` header;
- fixes `POST /admin/event-history/exports` returning a response with every
  field `undefined` — the handler passed the mutation's nested
  `{outcome, metadata}` result straight into a mapper expecting a flat
  metadata object;
- corrects a swapped audit operation label between the service schedule and
  service availability read paths (authorization behavior was unaffected,
  since both resolve to the same permission);
- aligns the published API contract's declared `maxBodyBytes` with the
  byte limits actually enforced by several mutation routes, which had
  drifted (documented 8192 bytes vs. enforced 512/4096), and regenerates
  the contract digest accordingly;
- removes seven orphaned source files that nothing imported, found by
  cross-referencing every relative import across `src/`, `tests/`,
  `scripts/` and `deployment/`: an unused Cloudflare Access JWKS test
  fake, an unwired `BackupReadinessReader` implementation, four one-line
  re-export shims for classes now defined directly in
  `linux-power-helper-adapters.ts`, and an unreferenced
  `DockerContainerDetailsReader`;
- removes the `docker-container-details.ts` domain module and its test,
  left with no production consumer once its only importer above was
  deleted; the three container domain types it composed
  (`docker-container-{health-state,resource-usage,runtime-state}.ts`)
  stay, since the Docker inspect/stats parsers still use them.

## 1.0.0

General availability. Identity promotion only — no functional change from
`1.0.0-rc.15`, which passed full real-host deployment and acceptance
testing, including the first real-Cloudflare verification of the ADR-034
CLI service-token authentication path. See
`docs/release/atlas-manager-1.0.0.md` and
`docs/release/atlas-manager-1.0.0-final-operational-acceptance-evidence.md`.

## 1.0.0-rc.15

- rebuilds the dashboard's visual system as Design v3: a layered dark/neon
  design system with cyan/violet accents used as outlines, washes and glows
  rather than fills, a restructured shell markup, and the four
  `SectionStatusRegion` async states (loading/empty/failed/stale) made
  visually distinct instead of rendering identically (#326);
- adds CLI authentication as a Cloudflare Access service token (ADR-034):
  `CF_ACCESS_CLIENT_ID`/`CF_ACCESS_CLIENT_SECRET` take precedence over the
  now-deprecated `ATLAS_CLOUDFLARE_ACCESS_JWT`, principals are discriminated
  as `human`/`service` so a machine identity can never appear in the audit
  trail as an operator, and an undeclared service token authenticates as
  nobody even when Cloudflare accepted it (#326);
- formalizes this release candidate as the interim, #326-inclusive build the
  1.0.0 GA promotion sequence deploys and accepts on the real Atlas host
  before promoting that exact accepted commit to bare `1.0.0`;
- retains mock-only power safety and, as of this candidate, still no
  completed real-host deployment: acceptance is pending, see
  `docs/release/atlas-manager-1.0.0-rc.15.md`.

## 1.0.0-rc.14

- closes four Operator Experience gap-audit items that were re-verified as
  genuinely small and additive over already-existing backend/domain code:
  following transitions on service availability, active-override + expiry
  reporting, a dashboard "Run now" button for backups, and CLI/dashboard
  events pagination (#321);
- adds authenticated Settings contracts: exposes the already-backend-complete
  event-history retention policy (`GET`/`PUT /admin/event-history/retention`)
  on a new dashboard Settings page, reusing the existing RBAC scope,
  confirmation gate and audit logging rather than inventing new ones (#322);
- adds machine operating policy persistence (ADR-033): a file-backed
  `MachineOperatingPolicyStore` overlaying the ADR-012 environment default,
  new `GET/PUT/DELETE /admin/machine/schedule` and preview routes, `atlas
machine schedule set|remove|preview` CLI commands, and a dashboard editor;
  the machine power scheduler and its confirmation reader continue to consume
  only the ADR-012 environment-parsed policy captured at startup — this only
  changes what operators can read, preview and declare (#323);
- closes the remaining two Operator Experience product gaps: scheduler
  health/cursor visibility (new `scheduler.service_availability` `CHECK_ID`,
  plus a fix for `readLastTick()` not recognizing the `completedThrough` key
  that was silently hiding the already-shipped `scheduler.power` check's last
  tick) and CLI events pagination (`atlas events --after <sequence>`) (#324);
- formalizes this release candidate: reconciles release metadata (contract,
  snapshots, traceability, evidence, CLI version test) against the current
  source commit via the project's existing release-identity tooling, with no
  hand-edited digests;
- retains mock-only power safety and no real host deployment:
  `POWER_MANAGEMENT_BACKEND=mock`, `MACHINE_POWER_EFFECTS_ACTIVATION=disabled`,
  `MACHINE_POWER_SCHEDULER_ENABLED=false`.

## 1.0.0-rc.13

- derives dashboard service controls (start/stop/restart/logs) from each
  registered service's actual `supportedOperations` instead of a hardcoded
  button list, closing the remaining verifiable gap in Operator Dashboard v2
  Slice 1 reliability work;
- extracts the operation-filtering logic into a new testable module
  (`src/dashboard/service-operations.ts`), since the dashboard entrypoint
  executes DOM-dependent code and cannot be unit tested directly;
- fixes release-identity drift across the lockfile, release contract, CLI
  version test, and requirements-traceability generator's hardcoded fallback
  (see `docs/reviews/rc13-release-identity-audit.md`); the traceability
  generator now derives its release-candidate label from `package.json`
  instead of a literal that required a manual bump every release;
- registering the real Task Manager PM2 entry remains an operator action
  pending live Atlas inspection of the actual PM2 process — the PM2 dispatch
  pipeline is already adapter-generic and requires no further source work.

## 1.0.0-rc.12

- closes deployability and authentication-hardening gates identified by the
  pre-deployment audit (CRIT-01 plaintext sudo password, MED-06 unhandled errors)
  and the 2026-08-09 Cloudflare Access authentication loop;
- distinguishes JWT verification failures internally (signature_invalid,
  issuer_mismatch, audience_mismatch, claims_invalid, key_unavailable) for
  self-diagnosing audit trails without temporary diagnostic routes;
- registers process-level handlers for unhandledRejection and uncaughtException,
  ensuring graceful shutdown with failure exit codes instead of orphaned
  processes;
- delivers reference templates for Nginx administrative server block
  (deployment/nginx/atlas-manager-admin.conf) and scoped sudoers file
  (deployment/sudoers/atlas-manager-operator), with regression tests ensuring
  critical invariants remain checked into the repository;
- defers Operator Dashboard v2 Slice 1 (Task Manager PM2 registration) to rc.13
  and PM2/Docker sudoers decisions to operational deployment feedback;
- retains mock-only power safety and no real host deployment.

## 1.0.0-rc.11

- fixes Cloudflare Access identity readiness against the production JWKS envelope
  returned by the configured Access team;
- accepts the required `keys` member and official optional metadata members
  `public_cert` and `public_certs` in the JWKS parser;
- rejects unknown envelope fields and validates every signing key as a bounded,
  unique RS256 RSA key;
- supports concurrent JWKS refresh coalescing and bounded provider cooldown after
  failures;
- keeps power mock-only with physical effects disabled and no Atlas host
  deployment.

## 1.0.0-rc.10

- aligns Cloudflare Access application-token verification with the assertion
  format observed at the qualified administrative ingress;
- accepts the optional JWT protected-header `typ` when absent and requires
  exactly `JWT` when present;
- fixes authenticated dashboard requests whose valid Cloudflare Access assertion
  omits the optional `typ` header;
- does not weaken Host, Origin, Cloudflare Access, RBAC, audit, admission, or
  mutation controls;
- retains mock-only power for qualification and deployment.

## 1.0.0-rc.9

- fixes dashboard-access hotfix for the qualified rc.8 deployment in response to
  Cloudflare Access redirecting the browser from the Access login domain to the
  administrative origin;
- accepts the exact cross-site return shape: `GET /` with `Sec-Fetch-Site:
cross-site`, `Sec-Fetch-Mode: navigate`, and `Sec-Fetch-Dest: document`;
- maintains mandatory authentication after the envelope check with Cloudflare
  Access assertion verification and backend-authoritative RBAC;
- keeps Host and Origin validation enabled with cross-site administrative API and
  mutation requests rejected;
- requires reproducible byte-identical bundle qualification and mock-only power
  safety.

## 1.0.0-rc.8

- assigns a new immutable release identity to the Advanced Manager readiness
  source after the Atlas host was already running a different `1.0.0-rc.7`
  generation;
- prevents deployment procedures from overwriting the managed
  `/opt/atlas-manager/releases/1.0.0-rc.7` directory or weakening the
  installer rollback contract;
- requires fresh commit-bound candidates, reproducibility evidence, host
  preflight, and side-by-side upgrade qualification before deployment.

## 1.0.0-rc.7

- canonicalizes bundle directories and regular files to `0755` or `0644`,
  making manifests, checksums, and archives independent of the builder's
  `umask`; commit-bound rc.7 bundles built before this correction are
  superseded and must not be used for physical qualification;
- corrects the false-positive runtime identity preparation block when the
  supported shadow 4.17.4 build omits the `lastlog` backend and the trusted
  preexisting `lastlog` contains records;
- classifies `lastlog` build capability from the shared `ENABLE_LASTLOG`
  contract governing the advertised `--no-log-init` option and
  `lastlog_reset` implementation;
- retains fail-closed handling for non-empty `faillog`, executable
  `pam_tally2`, unsafe paths, and changed immutable login-log baselines;
- supersedes rc.6 and requires a new commit-bound bundle plus complete
  physical Atlas requalification before merge, tag, or release.

## 1.0.0-rc.6

- accepts the proven trusted Ubuntu login-log layout without permitting
  arbitrary group-writable paths;
- supports canonical merged-usr `/sbin -> /usr/sbin` resolution while
  rejecting unsafe ownership, permissions, types, and symlink targets;
- captures immutable path-layout and external-artifact baselines and preserves
  `recovery_required` behavior when they change;
- records rc.5 as historically blocked for physical identity preparation and
  requires complete physical requalification for this candidate.

## 1.0.0-rc.5

- corrects clean-absent runtime identity password-state handling;
- hardens real `useradd` capability probing and removes unsupported hardcoded
  `--no-log-init` assumptions;
- accepts `GROUPS=`, expanded canonical defaults, and compatible
  `USRSKEL`/`LOG_INIT` output while requiring exactly one
  `CREATE_MAIL_SPOOL=no`;
- classifies login-log backends and verifies immutable external baselines;
- hardens rollback ownership boundaries and recovery-required reporting;
- adds Ubuntu 26.04 source-level fixture coverage;
- keeps rc.2, rc.3, and rc.4 historical blockers intact; physical
  requalification and a new commit-bound bundle remain required.

## 1.0.0-rc.4

- resets the software release candidate after the two runtime-identity
  corrections delivered after `rc.2` and `rc.3`;
- probes fixed `useradd` capabilities before mutation and conditionally uses
  `--no-log-init`;
- validates effective `CREATE_MAIL_SPOOL=no` without the invalid `--key`
  override;
- preserves original failure stages and verifies complete rollback residue;
- remains software-only and unqualified pending a new commit-bound bundle and
  physical qualification.

## 1.0.0-rc.3

- supersedes `1.0.0-rc.2` after correcting the clean-absent runtime identity
  password precondition exposed by physical-host inspection;
- accepts zero shadow entries only while the complete runtime identity is
  absent, while retaining blocking checks for residual, missing, duplicate,
  and unlocked shadow states;
- retains mandatory post-creation verification of one locked runtime password;
- requires a new commit-bound deployment bundle and physical qualification;
- keeps the `rc.2` physical-host evidence historical and software-only.

## 1.0.0-rc.2

- supersedes `1.0.0-rc.1` after audit remediation;
- hardens managed directory metadata, backup reconstruction, sequencing, and retention;
- binds administrative route registration to the closed security catalog;
- hardens administrative authority parsing and identity-readiness reporting;
- qualifies configuration generation replacement and rollback boundaries;
- records software-only release evidence; physical qualification remains pending.

## 1.0.0-rc.1

- completed v0.9 administrative route inventory and security envelope;
- added identity readiness and disabled configuration replacement/rollback;
- superseded by `1.0.0-rc.2` because its evidence was not reproducible;
- kept physical deployment, helper activation, and real power effects separate.
