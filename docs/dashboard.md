# Administrative dashboard

The dashboard is a server-owned HTML shell with vanilla TypeScript assets. It
is served only through the protected administrative route and uses the existing
administrative API; it does not contain domain or authorization rules.

## Shell

A persistent sidebar (desktop) / off-canvas drawer (mobile, opened by a topbar
toggle button with a scrim and Escape-to-close) drives hash-routed navigation
across the pages below. The topbar also shows the release version, a global
health summary derived from every section's current load state, the last
refresh time and a manual refresh button. Design tokens (surface, border,
text, status colors, spacing, radius) back the visual system; status uses an
icon prefix plus text, never color alone. Focus moves to the page heading and
a live region announces the page on navigation.

## Pages

The navigation shell exposes Overview, Services, Schedules, Machine, Backups,
Events, Infrastructure and Settings. Overview, Services, Schedules, Backups
and Infrastructure are backed by current API payloads. Settings remains an
explicit placeholder until its read API is delivered.

Overview presents cards for registered services, power safety, machine
expectation, backup activity and observation time. These cards are projections
of the protected overview response; the dashboard does not derive operational
state independently.

Infrastructure is read-only and shows the protected security posture, route
catalog reconciliation, host-boundary flags and the runtime diagnostics
(status, PM2/Docker, Nginx and tunnel checks) added by ADR-032. It does not
offer a repair button.

Machine shows the authoritative operating policy, next shutdown/wake
transitions and a simulation preview. The preview identifies the backend,
effects and scheduler state; when the profile is mock with effects disabled it
explicitly reports that no physical power effect is armed. Machine modes such
as always-on and manual are described instead of being inferred from empty
windows.

## Services and schedules

Services render their registered adapter (a diagnostic label, not the
primary identity), a status chip derived from the closed set of backend
runtime states, current availability, dependencies and a compact CPU/memory/
uptime line (`ServiceResourceObservation`, PM2/Docker; `mock`/
`docker-compose` report "unavailable" honestly rather than a fabricated
value). Resources refresh on a bounded 30-second poll of the Services
section, paused while the tab is hidden; a resource-read failure for one
service degrades only that service's card, never the section. Start, stop
and restart buttons are derived from each service's `supportedOperations`
rather than a fixed list, and are mutation actions protected by the backend
route policy; the browser shows a confirmation dialog and sends the exact
backend confirmation token. The result is reread after the operation. Fields
the plan asks for but the current API doesn't provide yet (readiness, next
transition, dependents) are stated as not yet available rather than omitted
silently.

The Schedules page renders the current availability response as a weekly
timeline, including the current effective state and current local time
formatted in the policy's own timezone. It uses the server-provided weekday,
time and timezone values. It does not validate or persist a new base policy
in the browser. The Logs action performs a protected read and renders the
returned payload as text without interpreting it as markup.

Each service timeline also includes the reusable weekly schedule editor:
mode, IANA timezone, seven day rows with an explicit enable checkbox
(replacing the earlier implicit "empty inputs mean disabled" convention),
copy-one-day-to-selected-days, clear day, clear week, and dirty-state
tracking with a `beforeunload` warning. Save, Preview and Remove are three
distinct actions: Save persists through the protected schedule route; Remove
deletes the persisted policy through the same route; Preview sends the
current draft to a read-only candidate-policy preview endpoint and renders
the result without persisting anything or being treated as a mutation. The
backend remains responsible for complete validation, authorization, mutation
admission and audit in every case.

## State and errors

Each API read uses same-origin credentials and rejects redirects. A failed
request leaves the authoritative state unknown and reports that condition to
the operator. Power controls distinguish loading, unauthorized, busy/conflict,
failed and malformed-response states. Mutation buttons are disabled while an
operation is in flight. Power preparation and execution use separate explicit
checkbox confirmations; execution is not offered until a bounded backend
response returns a valid prepared occurrence.

The power-control component imports the canonical shutdown confirmation values
from the power domain. It does not implement shutdown validity, authorization,
admission or effect activation: those rules remain authoritative in the domain,
application and HTTP layers.

## Security and accessibility

Cloudflare Access, the administrative host/origin envelope, RBAC, request
admission, mutation gates and audit trail remain server-owned. The dashboard
does not bypass authentication. Navigation uses links, visible labels,
keyboard focus styles and text labels such as Offline and Scheduled rather
than color alone. Responsive rules support narrow screens.

## Asset contract

The build generates exactly three files: `index.html`, `app.js` and
`styles.css`. `app.js` is bundled as a browser IIFE so internal TypeScript
component imports cannot escape the three-file asset contract. Earlier
builds also served `backup.js` and `event-history.js` as separate scripts
duplicating logic the consolidated `app.js` refresh coordinator already
owns (both scripts wrote into the same DOM concurrently); Operator Dashboard
v2 Slice 2 retired them, and every asset-inventory check (generation script,
verification script, Go bundle builder, release rehearsal fixtures, CI) was
updated to the real three-file set. The generated manifest and bundle
verifier require the generated and packaged bytes to be identical.
