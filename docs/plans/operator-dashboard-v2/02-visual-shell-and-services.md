# Slice 2: visual shell and service experience

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
