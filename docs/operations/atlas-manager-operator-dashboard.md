# Atlas Manager operator dashboard

The dashboard is served at `/admin` and `/admin/` only when
`ADMINISTRATIVE_DASHBOARD_ENABLED=true`. It is protected by the same
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

Power safety is informational only. The dashboard states that the backend is
mock, effects and the machine-power scheduler are disabled, and the Linux
helper is unused. Wake-alarm and shutdown controls are intentionally absent.

Physical deployment, Cloudflare Tunnel/DNS configuration, helper installation,
and real power-effect certification remain separately approved gates.
