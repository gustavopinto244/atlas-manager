# Atlas Manager 1.0.0-rc.15

## Scope

This release candidate formalizes the one tranche merged since `1.0.0-rc.14`
was cut: PR #326 (dashboard Design v3 and CLI Cloudflare Access service-token
identity, ADR-034). It is the interim candidate the 1.0.0 GA promotion
sequence deploys and accepts on the real Atlas host before that exact
accepted commit is promoted to bare `1.0.0`.

## Dashboard Design v3 (#326)

The dashboard's visual system was rebuilt: a layered dark/neon design system
(cyan/violet accents used as outlines, washes and glows rather than fills),
a restructured shell markup preserving the `main > section` and
`aria-labelledby` contracts `src/dashboard/navigation.ts` selects against,
and the four `SectionStatusRegion` async states (`loading`/`empty`/`failed`/
`stale`) made visually distinct instead of rendering identically. No portfolio
reference URL was supplied, so the palette is the documented fallback in
`docs/dashboard.md`, not an extraction from an external reference. Two
Content-Security-Policy rules already in force (`font-src 'none'`,
`img-src 'self'`) constrained the redesign to system fonts and inline SVG/CSS
icons.

## CLI Cloudflare Access service-token identity — ADR-034 (#326)

The CLI can now authenticate as a Cloudflare Access **service token**
(`CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET`) instead of only
forwarding a borrowed human assertion. `AdministrativePrincipal` gains
`kind: "human" | "service"`, defaulting to `human`; the audit actor id is
derived from the kind (`service:<uuid>` vs `administrator:<uuid>`), so a
service identity can never appear in the event history as a human operator.
`ADMINISTRATIVE_SERVICE_TOKEN_PRINCIPALS` declares which Client IDs are
accepted and which principal each acts as — an undeclared token authenticates
as nobody even when Cloudflare accepted it, and a declared one draws its
roles from the ordinary `ADMINISTRATIVE_ROLE_ASSIGNMENTS` table. The secret is
never configured in this service and never reaches this process. The
deprecated `ATLAS_CLOUDFLARE_ACCESS_JWT` fallback keeps working; a service
token takes precedence when both are present, and half a service token fails
closed rather than silently falling back to the human assertion.

## Real-host acceptance status

**Pending.** Neither #326's dashboard redesign nor its CLI service-token
authentication path has been deployed to, or exercised against, the real
Atlas host or a real Cloudflare Access application yet. The service-token
path in particular was built and unit-tested entirely against synthetic
signed assertions (`tests/access-control/cloudflare-access-service-token.test.ts`)
and has never been verified against Cloudflare's actual edge validation of a
real Client ID/secret pair. This is the first candidate for which that
real-host and real-Cloudflare verification occurs; see
`docs/release/atlas-manager-1.0.0-final-operational-acceptance-evidence.md`
for the outcome once acceptance completes.

## Release identity

`package.json`, `package-lock.json` and `tests/cli/main.test.ts` are
reconciled to `1.0.0-rc.15`. The release contract, evidence and digests
snapshots are produced by the project's own generators at qualification time
(`release:generate-contract`, `release:generate-evidence`,
`release:generate-digests`) against the real source commit, not hand-edited.

## Verification

- Cloudflare Access, Host/Origin validation, RBAC, audit and mutation gates
  for the existing human-assertion path are unchanged.
- Power remains mock-only:
  - `POWER_MANAGEMENT_BACKEND=mock`
  - `MACHINE_POWER_EFFECTS_ACTIVATION=disabled`
  - `MACHINE_POWER_SCHEDULER_ENABLED=false`
- Full Candidate A/B bundle and rehearsal reproducibility re-run against this
  commit (see the generated, non-committed evidence for this candidate).

## Deferred

Operator Dashboard v2 automatic polling scope beyond Services, and Compose
resource aggregation semantics, remain open — see
`docs/capabilities.md`'s "Known deferred items" section. Atlas host
deployment of this candidate and its acceptance are covered separately by
the operational acceptance evidence document referenced above, not by this
release-identity document.
