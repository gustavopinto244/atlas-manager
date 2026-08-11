# Atlas Manager 1.0.0-rc.14

## Scope

This release candidate formalizes four tranches merged since `1.0.0-rc.13`
was cut (Operator Experience gap closure, Settings contracts, machine
operating policy persistence with ADR-033, and the remaining product gaps)
and reconciles the release identity — version, lockfile, release contract,
snapshots, requirements traceability and evidence — against the current
source commit, following the pattern established by
`docs/reviews/rc13-release-identity-audit.md`.

## Operator Experience gap closure (#321)

Four items from `docs/reviews/operator-experience-final-gap-audit.md` were
re-verified as small and additive over already-existing backend/domain code
and closed: following transitions on service availability, active-override +
expiry reporting, a dashboard "Run now" button for backups, and events
pagination. Scheduler health/cursor visibility was re-confirmed as not small
and deferred to a later tranche.

## Settings contracts (#322)

Event-history retention policy (`GET`/`PUT /admin/event-history/retention`)
was already a fully backed `SUPPORTED_MUTATION` with no dashboard exposure.
`src/dashboard/settings-view.ts` now renders it as a typed form, reusing the
existing RBAC scope (`event_history.retention.write`), confirmation gate and
audit logging. Backup and service schedule/retention remain on their own
pages, not duplicated onto Settings.

## Machine operating policy persistence — ADR-033 (#323)

A new file-backed `MachineOperatingPolicyStore` overlays the ADR-012
environment-owned `MACHINE_OPERATING_POLICY` default, mirroring the ADR-029
`ServiceAvailabilityPolicyStore` pattern. New `GET/PUT/DELETE
/admin/machine/schedule` and preview routes, `power.schedule.read`/
`power.schedule.write` RBAC permissions, `atlas machine schedule
set|remove|preview` CLI commands, and a dashboard editor let operators read,
preview and declare a machine schedule. The machine power scheduler and its
confirmation reader are unchanged: they still consume only the ADR-012
environment-parsed policy captured once at startup. `.env` is never
rewritten by this feature.

## Remaining product gaps (#324)

Closes the last two open items from the gap audit: a new
`scheduler.service_availability` `CHECK_ID` for scheduler cursor visibility
in infrastructure diagnostics (which also fixed a pre-existing bug where
`readLastTick()` didn't recognize the `completedThrough` key, silently
hiding the already-shipped `scheduler.power` check's real last-tick time),
and `atlas events --after <sequence>` for CLI events pagination.

## Release identity

`package.json`, `package-lock.json`, `tests/cli/main.test.ts`, the release
contract snapshot, the requirements-traceability snapshot and the release
evidence snapshot are all reconciled to `1.0.0-rc.14` using the project's own
generators (`release:generate-contract`, `release:generate-traceability`,
`release:generate-evidence`), not hand-edited digests. The traceability
generator continues to derive its release-candidate label from
`package.json` (fixed in the rc.13 audit), so no manual literal needed
updating.

## Verification

- Cloudflare Access, Host/Origin validation, RBAC, audit and mutation gates
  are unchanged across all four merged tranches.
- Power remains mock-only:
  - `POWER_MANAGEMENT_BACKEND=mock`
  - `MACHINE_POWER_EFFECTS_ACTIVATION=disabled`
  - `MACHINE_POWER_SCHEDULER_ENABLED=false`
- No Atlas host deployment is included in this source release candidate;
  this phase produces build artifacts only.

## Deferred

Operator Dashboard v2 automatic polling scope (item 5) and compose resource
aggregation (item 7) remain open, re-examined and left unimplemented with
specific rationale recorded in the gap audit. Atlas host deployment and
power activation remain separate, not-yet-authorized phases.
