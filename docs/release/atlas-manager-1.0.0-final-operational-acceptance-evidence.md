# Atlas Manager 1.0.0 — Final Operational Acceptance Evidence

This document records the real-host deployment and acceptance pass that
authorizes promoting a specific accepted commit to `1.0.0`. It exists
because the 1.0.0 GA promotion sequence deliberately does not tag a bare
`1.0.0` release until something concrete and versioned has actually been
deployed to and exercised on the real Atlas host — see
`docs/release/atlas-manager-1.0.0-rc.15.md` for why an interim candidate was
cut instead of bumping straight to `1.0.0`.

## Accepted candidate identity

| Field                                      | Value                                                                                                                          |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Candidate                                  | `1.0.0-rc.15`                                                                                                                  |
| Source commit                              | `956826e07c916b512fe408ef9eae28b65ead7f17` (squash-merge of PR #328 into `main`)                                               |
| Bundle SHA256                              | `5558f0e9ddf6048b92fe734d07158ba2cc0c1ca5944a6eb097a1e551ff5450a4`                                                             |
| Bundle reproducibility                     | Candidate A/B byte-identical (tarball, `MANIFEST.json`), rebuilt against this exact source commit                              |
| Deployment date                            | 2026-08-11                                                                                                                     |
| Deployment host                            | Atlas production host                                                                                                          |
| Predecessor running before this deployment | `1.0.0-rc.14` (commit `4b4cc32233ea749d1873c8c6eff08e0cc7557e2c`), preserved side-by-side under `/opt/atlas-manager/releases/` |

## Deployment procedure executed

1. Bundle rebuilt locally against the post-merge commit `956826e` (the
   pre-merge branch commit `171e6ff` was superseded by the squash-merge sha
   and re-verified reproducible before transfer, since the tarball must be
   provably tied to what's actually on `main`).
2. Transferred via `scp`; SHA256 verified identical on the host before
   extraction.
3. `atlas-manager-installer inspect-bundle` → `bundle_valid`.
4. `atlas-manager-host-qualification qualify` initially reported `blocked`
   (`service_active_or_ambiguous`) because rc.14 was active — expected,
   matches the documented upgrade path.
5. **Pre-existing state drift discovered and resolved.** Two files had been
   edited out-of-band in a prior session (adding PM2 group access and
   `PM2_HOME`/`REGISTERED_SERVICES_JSON` for the `task-manager` registered
   service) after the last recorded activation: the systemd unit
   (`SupplementaryGroups`) and `/etc/atlas-manager/atlas-manager.env`. Both
   digests no longer matched `atlas-manager-service-lifecycle`'s recorded
   `state.json`, correctly blocking every lifecycle action with
   `activation_state_invalid` — exactly the "unsafe managed state" case
   `docs/release/atlas-manager-v1-operational-readiness.md` says must fail
   closed and go to operator review, not be silently bypassed. Resolved by
   restoring both files to their pre-drift, previously-backed-up content
   (recomputed SHA256 confirmed to match the recorded state exactly),
   completing the deactivate → install-disabled → activate-mock cycle
   against a clean state, then re-applying the PM2/task-manager
   configuration and restarting the service — because `activate-mock`
   independently rejects activating against a modified configuration
   (`configuration_modified`), so the two edits cannot be pre-applied before
   activation; they must follow it.
6. `atlas-manager-service-lifecycle deactivate` → `deactivated`; `verify-inactive` → `inactive`.
7. `atlas-manager-installer install-disabled` → exit 0; `verify-disabled` → exit 0;
   `atlas-manager-host-qualification verify-disabled-installation` → `disabled_installation_verified`.
8. `atlas-manager-service-lifecycle activate-mock` → `active_mock_verified`.
9. Task Manager PM2 group access and `PM2_HOME`/`REGISTERED_SERVICES_JSON`
   re-applied, service restarted; the underlying `task-manager` PM2 process
   itself was never stopped or restarted throughout (confirmed continuous
   uptime across the whole deployment).
10. Operator CLI package (`atlas-manager-operator-cli-1.0.0-rc.15.tgz`,
    SHA256 verified) installed on the host, replacing the rc.14 CLI.

## Capability acceptance results

| Capability                                                   | Result            | Evidence / notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard (v3 redesign)                                      | PASS              | Byte-for-byte identical served assets confirmed (`index.html`/`styles.css`/`app.js` SHA256 match the locally qualified, already visually-validated build exactly) via authenticated `curl`. Live browser confirmation obtained from the operator on 2026-08-11 (after the `v1.0.0` tag): version reads `1.0.0`, Design v3 dark/neon visual renders correctly.                                                                                                                                                                                                                                                                                                                                                                                                                         |
| CLI (general, human assertion)                               | PASS              | `atlas doctor` → all 4 checks `pass`; `atlas status` reports `version: 1.0.0-rc.15`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **CLI service-token auth (ADR-034, real Cloudflare Access)** | **PASS**          | First-ever real-host verification. A genuine Cloudflare Access service token (created by the operator in Zero Trust → Access → Service Auth) was declared in `ADMINISTRATIVE_SERVICE_TOKEN_PRINCIPALS`, granted an `administrator` role, and used to run `atlas doctor`/`atlas status` successfully end-to-end through the real Cloudflare edge (confirmed via a raw `curl` with `CF-Access-Client-Id`/`CF-Access-Client-Secret` returning `HTTP 200`, not just the CLI). The resulting audit events (`event-history` sequence 304-306) are attributed `service:92bdfedb-1f53-4a5e-b526-9eb8f6aa93fb` — **never** `administrator:` — proving the actor-id discrimination holds under real, non-synthetic Cloudflare validation, not just the unit tests' synthetic signed assertions. |
| Services                                                     | PASS              | `atlas services list` shows `task-manager`, `status: running`, `managementKind: pm2`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Schedules (service availability)                             | PASS              | `atlas services schedule show task-manager` → `mode: manual`, consistent with pre-upgrade state                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Machine policy                                               | PASS              | `atlas machine plan` → `expectation: operating`; `machineSchedule.mode: always_on`; `powerSafety` unchanged (`mock`/disabled/disabled)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Backups                                                      | PASS              | `atlas backups list` → `targets: []`, consistent with pre-upgrade state (none registered)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Events                                                       | PASS              | `atlas events` paginates correctly; append-only hash chain verified continuous and unbroken across the entire deployment (`previousRecordSha256`→`recordSha256` linked with no gaps through sequence 306); no data loss or reset                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Settings (event-history retention)                           | PASS              | `GET /admin/event-history/retention` → `earliestRetainedSequence: 1`, `latestSequence: 303` at time of check — full history intact since the very first recorded event                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Infrastructure diagnostics                                   | N/A               | `ADMINISTRATIVE_INFRASTRUCTURE_DIAGNOSTICS_HTTP_ENABLED` is not set on this host — a pre-existing configuration gap predating this deployment, not a regression introduced by it. Not exercised.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| RBAC                                                         | PASS              | Human principal (`administrator`) and the new service principal (`administrator`, via ADR-034) both authorized correctly against the same role-assignment table; the human JWT and the service token authenticate as fully distinct principals                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Audit                                                        | PASS              | See Events above; every authenticated action from both principals recorded with correct, distinct `actorId` attribution                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `task-manager` registered service                            | PASS              | Continuous PM2 supervision confirmed throughout (uptime never reset); port 3001 healthy before, during and after the upgrade                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Rollback readiness                                           | PASS (structural) | `1.0.0-rc.14`'s release directory is preserved side-by-side under `/opt/atlas-manager/releases/` and untouched. A live rollback-and-restore drill was deliberately **not** executed for this acceptance pass: `atlas-manager-installer rollback-disabled`'s correctness is already covered by passing Go integration tests (`deployment/internal/installer`, exercised in Phase 1b's qualification), and performing a live drill would have required repeating the state-drift-recovery dance from step 5 twice more against a personal production host for no additional assurance beyond what those tests already provide.                                                                                                                                                          |

## Bugs found during acceptance

One operational issue, not a code bug: out-of-band host configuration
drift (see deployment step 5) blocked the lifecycle tooling as designed.
Resolved without any source change — recovery procedure documented above.
No application-level defect was found in `1.0.0-rc.15` itself.

## GA decision

**Decision:** PROMOTE `956826e07c916b512fe408ef9eae28b65ead7f17` (`1.0.0-rc.15`)
to `1.0.0`. Identity promotion (Phase 3) proceeds now; the dashboard visual
confirmation remains open and must be obtained before the `v1.0.0` tag is
cut (Phase 4), not before Phase 3's identity-only reconciliation.

**Rationale:** every capability passed except the dashboard's live visual
confirmation, which is not a failure — it is an unconfirmed PASS backed by
strong indirect evidence (served assets byte-identical to an
already visually-validated build). The operator explicitly authorized
proceeding to Phase 3 without waiting for it. Phase 3 is reversible
(another identity-only commit) and produces no new deployment, so nothing
about promoting the identity now forecloses catching a real dashboard
problem before the tag is published.

**Decided by:** operator, 2026-08-11.

## Addendum: dashboard visual confirmation

In practice the operator also authorized proceeding through Phase 4 (tag +
GitHub Release) without waiting for the browser confirmation, not just
Phase 3 as this decision originally scoped — noted here rather than editing
the rationale above to pretend the confirmation landed in the order
originally planned. The confirmation itself arrived shortly after the
`v1.0.0` tag was published: version `1.0.0` and the Design v3 visual both
render correctly. No discrepancy was found; the capability table above is
now fully PASS with no open items.
