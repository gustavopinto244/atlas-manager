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

Three structural contracts in the shell markup are load-bearing, because
`navigation.ts` selects against them:

- every page container is a **direct child of `<main>`** (`main > section`);
- each section's `aria-labelledby` names its own `<h2>` id, which is the key
  pages are matched on;
- element ids consumed by `src/dashboard/*.ts` are part of the shell contract.

## Design system (v3)

### Palette provenance

No portfolio reference URL was supplied when this theme was built, so the
palette below is the **documented fallback**, not an extraction from an
external reference. It is a deep blue-tinted dark base with layered elevation
and neon accents. Replacing it with a portfolio-derived palette means changing
the token values in `src/dashboard/styles.css`; nothing outside that `:root`
block encodes a specific colour.

| Role             | Token                         | Value                 |
| ---------------- | ----------------------------- | --------------------- |
| Page base        | `--bg-base`                   | `#070b12`             |
| Surface (raised) | `--surface-1` … `--surface-3` | `#0d131f` → `#1a2437` |
| Primary accent   | `--accent`                    | `#22d3ee` (cyan)      |
| Secondary accent | `--accent-secondary`          | `#a78bfa` (violet)    |
| Success          | `--success`                   | `#4ade80`             |
| Warning          | `--warning`                   | `#fbbf24`             |
| Danger           | `--danger`                    | `#fb7185`             |
| Info             | `--info`                      | `#60a5fa`             |

Accents are used as **outlines, washes and glows rather than large fills**: at
this saturation a solid neon fill competes with every status colour on the
page, which is the opposite of what an operations console needs.

### Contrast

Text tokens are chosen to clear WCAG 2.1 AA against `--surface-1`, the darkest
surface they sit on: `--text` 16.1:1, `--text-muted` 7.5:1, `--text-faint`
5.4:1. `--text-faint` carries 12px labels (card titles, table headers, `dl`
terms) which never qualify as "large text", so it must clear 4.5:1 unaided —
it does, and lowering it below that threshold is a regression even if it looks
better.

### CSP constraints on styling

Two rules in the dashboard route's Content-Security-Policy directly constrain
what the stylesheet may do, and are enforced by the browser at runtime rather
than by the build:

- `font-src 'none'` — **no web fonts.** The system font stack is the entire
  typography story.
- `img-src 'self'` — **no `data:` URI imagery.** Icons are inline `<svg>` in
  the served markup (the nav toggle) or drawn in CSS (the brand mark, status
  chip glyphs, the loading spinner).

## Pages

The navigation shell exposes Overview, Services, Schedules, Machine, Backups,
Events, Infrastructure and Settings. All eight pages are backed by current
API payloads. Settings exposes the one server-owned policy that is currently
administrable independent of any other page: event-history retention
(`GET`/`PUT /admin/event-history/retention`), with the same RBAC,
confirmation and audit contract as every other administrative mutation. Other
configuration an operator can change (backup schedules/retention, service
schedules/availability) is rendered on the page that owns the data it
governs rather than being duplicated onto Settings; see
`docs/reviews/operator-experience-settings-audit.md` for the full
classification of what was and was not judged administrable.

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
formatted in the policy's own timezone, the active override and its expiry
when one is set, and a bounded list of following transitions alongside the
preview's "First required at" value. It uses the server-provided weekday,
time and timezone values. It does not validate or persist a new base policy
in the browser. The Logs action performs a protected read and renders the
returned payload as text without interpreting it as markup.

The Backups page has a "Run now" action per target, alongside the existing
schedule/retention forms and "Prune retention" button, using the same
confirmation-form pattern and the already-existing, RBAC- and confirmation-
gated run route.

The Events page fetches one page of history at a time and offers a "Load
more" button that appends the next page (via the response's
`nextAfterSequence` cursor) rather than replacing what is already rendered.

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
