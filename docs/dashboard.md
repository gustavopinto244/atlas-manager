# Administrative dashboard

The dashboard is a server-owned HTML shell with vanilla TypeScript assets. It
is served only through the protected administrative route and uses the existing
administrative API; it does not contain domain or authorization rules.

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
catalog reconciliation and host-boundary flags. It does not offer a repair
button.

Machine shows the authoritative operating policy, next shutdown/wake
transitions and a simulation preview. The preview identifies the backend,
effects and scheduler state; when the profile is mock with effects disabled it
explicitly reports that no physical power effect is armed. Machine modes such
as always-on and manual are described instead of being inferred from empty
windows.

## Services and schedules

Services render their registered adapter, current status, availability and
dependencies. Start, stop and restart are mutation actions protected by the
backend route policy; the browser shows a confirmation dialog and sends the
exact backend confirmation token. The result is reread after the operation.

The Schedules page renders the current availability response as a weekly
timeline. It uses the server-provided weekday, time and timezone values. It
does not validate or persist a new base policy in the browser. The Logs action
performs a protected read and renders the returned payload as text without
interpreting it as markup.

Each service timeline also includes the reusable weekly schedule editor. It
supports mode, timezone and weekday windows, performs basic client-side
validation, and submits the authoritative policy to the protected API. The
backend remains responsible for complete validation, authorization, mutation
admission and audit.

## State and errors

Each API read uses same-origin credentials and rejects redirects. A failed
request leaves the authoritative state unknown and reports that condition to
the operator. Mutation buttons are disabled while an operation is in flight.
Power preparation and execution use separate explicit checkbox confirmations;
execution is not offered until the backend returns a prepared occurrence.

## Security and accessibility

Cloudflare Access, the administrative host/origin envelope, RBAC, request
admission, mutation gates and audit trail remain server-owned. The dashboard
does not bypass authentication. Navigation uses links, visible labels,
keyboard focus styles and text labels such as Offline and Scheduled rather
than color alone. Responsive rules support narrow screens.

## Asset contract

The build generates `index.html`, `app.js`, `styles.css`, `backup.js` and
`event-history.js`. The generated manifest and bundle verifier require the
source and packaged bytes to be identical.
