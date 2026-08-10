# Slice 2: visual shell and service experience

## Status

Delivered in this pass (branch `agent/operator-dashboard-v2-slice-2`):

- Retired the duplicate `backup.js`/`event-history.js` scripts that competed
  with `main.ts` for the same DOM (a Slice 1 item 5 gap); the dashboard now
  has a single script owner for every section.
- Desktop persistent sidebar (built on the existing hash-routed
  `navigation.ts`, unchanged routing model) plus a topbar showing release
  version, a global health summary derived from every section's current
  state, last-refresh time, and a manual refresh button.
- Mobile off-canvas drawer with a scrim, Escape-to-close, and close-on-navigate.
- Focus movement to `<main>` and a live-region announcement on page change.
- Design tokens (surface/border/text/status colors/spacing/radius) replacing
  hardcoded hex values; `prefers-reduced-motion` support; relative units
  throughout (no fixed-px layout that would break at 320px or 200% zoom).
- Service cards: status chip with a non-color icon prefix derived from the
  closed backend runtime-state set, explicit "not yet available" disclosure
  for readiness/uptime/next-transition/dependents/resource-usage fields the
  current `/admin/services` DTO does not provide (Slices 3-4 add the backing
  data), and a "View schedule" link alongside the existing conditional Logs
  button.
- New tests: `service-operations.test.ts` (status chip mapping), rewritten
  `navigation.test.ts` (hand-rolled fake DOM, matching the existing
  `section-state.test.ts` pattern — no jsdom dependency in this project),
  `no-unsafe-html.test.ts`.

**Not delivered — deferred, not forgotten:**

- A separate multi-section (Overview/Resources/Schedule/Logs/Events) service
  detail view with its own deep link. The plan's acceptance line asks to
  "reach detail in one click"; for now the service card itself is the detail
  view, matching the plan's own warning against "PM2/Docker implementation
  details fragmenting navigation" — there is not yet enough per-service data
  (resources, next transition) to justify a second dedicated page ahead of
  Slices 3-4. This should be revisited once those slices add real data.
- Visual verification at 320px width and 200% zoom is reasoned from the CSS
  (relative units, `min(80vw, ...)` drawer sizing, no fixed-px content
  widths) rather than screenshot-tested; this repository has no
  Playwright/Puppeteer dependency to add automated visual regression
  coverage without introducing new tooling.

## Objective

Turn the current stacked debug-like document into a responsive operator
console without adding a large frontend framework.

## Information architecture

```text
Desktop
├── persistent sidebar
│   ├── Overview
│   ├── Services
│   ├── Schedules
│   ├── Backups
│   ├── Events
│   ├── Infrastructure
│   └── Machine
├── top bar
│   ├── environment/release
│   ├── global health
│   └── last refresh / refresh action
└── page content

Mobile
├── compact header
├── accessible navigation drawer
└── single-column content
```

## Service card and detail view

Every registered service uses the same domain-oriented presentation:

- display name and stable ID;
- state badge: online, offline, degraded, transitioning or unavailable;
- adapter label used only as secondary diagnostics;
- readiness and uptime when authoritative;
- effective availability mode;
- next transition;
- CPU and memory observation or an explicit unavailable reason;
- dependencies and dependents;
- actions allowed by `supportedOperations`;
- links to Logs and Schedule.

Service detail uses tabs or sections for Overview, Resources, Schedule, Logs
and Events. PM2/Docker implementation details must not fragment the navigation.

## Visual system

- Define design tokens for surface, border, text, muted text, success, warning,
  danger, focus and spacing.
- Use a constrained content width for forms and full width for service grids and
  timelines.
- Use status chips with icon/text/pattern, never color alone.
- Use skeletons only while a bounded request is active; afterward render data,
  empty state or an error panel.
- Add compact number formatting for bytes, percentages and durations.
- Use confirmation dialogs only for mutations with meaningful effect.
- Keep all dynamic text in `textContent`/created nodes under the current CSP.

## Accessibility

- keyboard-operable navigation and dialogs;
- visible focus ring;
- heading/focus update after navigation;
- live regions for refresh and mutation results;
- labels for charts and schedule cells;
- reduced-motion support;
- usable at 320px width and 200% zoom.

## Tests

- navigation and focus management;
- desktop/mobile layouts through semantic DOM assertions and screenshot checks;
- card states and supported action filtering;
- empty, denied, unavailable, stale and retry states;
- confirmation and mutation result focus;
- no unsafe HTML or dynamic script insertion;
- generated/packaged asset equivalence.

## Acceptance

The operator can identify Task Manager state, resource use, schedule and actions
from one card, reach detail in one click, and understand every unavailable
field without opening browser developer tools.
