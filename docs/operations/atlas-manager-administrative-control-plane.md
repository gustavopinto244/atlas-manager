# Atlas Manager administrative control plane

The administrative control plane is loopback-only and protected by Cloudflare
Access followed by Atlas Manager role authorization. A verified Cloudflare
principal does not receive a role automatically. The browser dashboard is only
a same-origin client; the server authorizes every request independently.

The fixed service routes are:

- `GET /admin/services`
- `GET /admin/services/:serviceId`
- `POST /admin/services/:serviceId/actions/start`
- `POST /admin/services/:serviceId/actions/stop`
- `POST /admin/services/:serviceId/actions/restart`
- `GET|PUT|DELETE /admin/services/:serviceId/availability`
- `GET /admin/overview`
- `GET /admin/event-history`

Service IDs are resolved only from the trusted registered-service catalog. No
route accepts a command, Docker resource, Compose path, PM2 process, or
external identifier.

Mutations require exact operation confirmations and are persistently audited.
Authorization is audited before the effect; started and terminal operation
events bound the existing service capability. A terminal audit failure after a
completed effect is reported as a state-recheck condition, never silently
reversed or retried.

The fixed roles are `service_operator`, `auditor`, `power_operator`,
`scheduler_operator`, and `administrator`. Service mutation permissions are not
added to existing power or scheduler roles. `administrator` receives the
complete fixed permission set.

The first profile exposes no wake or shutdown controls. Its backend is mock,
power effects are disabled, the machine-power scheduler is disabled, and the
Linux helper is unused. No physical host or VM was used for development or
automated validation.

Operational event-history maintenance is a separate v0.8 boundary. Its routes
are disabled unless explicitly configured, use the fixed segmented store, and
fail closed on broken integrity, interrupted transactions, unknown files, or
unsafe locks. Rotation, retention, and export use operation-specific
confirmations and are audited before effects.
