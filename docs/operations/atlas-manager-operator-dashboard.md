# Atlas Manager operator dashboard

The canonical dashboard is served at
`https://admin.gustavopinto.dev.br/` only when
`ADMINISTRATIVE_DASHBOARD_ENABLED=true`. Its APIs remain under `/admin/*` and
assets under `/assets/*`. It is protected by the same
Cloudflare Access and application authorization boundary as the APIs. Static
files are served from a closed inventory; unknown assets and traversal are
rejected.

The dashboard reads the overview, registered services, and a bounded event
history page through same-origin APIs. It renders dynamic values as text, does
not use `innerHTML`, does not store tokens or state in browser storage, and
loads no external scripts, fonts, styles, or telemetry.

Service controls require the exact operation confirmation. The confirmation
field is never prefilled, stored, placed in a URL, or retained after a
submission. After a successful operation the dashboard rereads authoritative
service state; it never fabricates an optimistic status or retries silently.

Power safety remains mock-first. The dashboard displays the configured backend,
effects, scheduler, and helper state. When the authenticated administrative
profile enables them, it exposes mock wake-alarm scheduling/cancellation and
shutdown preparation controls through the existing protected routes. The
dashboard never enables physical effects or the machine-power scheduler.
Shutdown execution is offered only after a preparation response, with the
prepared occurrence displayed and a second explicit confirmation.

Physical deployment, Cloudflare Tunnel/DNS configuration, helper installation,
and real power-effect certification remain separately approved gates.

The Audit section also displays v2 integrity state, retained boundaries,
segment and retention summaries, and verified canonical export metadata. It
does not expose event-history paths or contents and never represents broken or
interrupted history as healthy.
