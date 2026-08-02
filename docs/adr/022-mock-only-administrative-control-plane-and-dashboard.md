# ADR-022 — Deliver the first operator control plane through a loopback, Cloudflare-authenticated, mock-only dashboard

Status: Accepted

## Decision

Atlas Manager exposes its first operator-facing control plane through protected
same-origin HTTP routes and a small static dashboard. The application binds to
loopback, verifies the Cloudflare Access assertion on every protected request,
then applies the project-owned role and permission policy. Successful and
failed administrative mutations are persistently audited before and after the
effect.

The initial managed profile enables service management, service availability,
overview, event history, and the dashboard. It keeps the power backend at
`mock`, keeps Linux power effects and the machine-power scheduler disabled, and
keeps wake and shutdown routes disabled. The Linux helper is not installed or
used.

## Boundaries

Application health endpoints are public liveness/readiness observations. The
administrative API is a separate protected delivery boundary. The dashboard is
only a browser presentation of that API; it is not an authentication session
or an authorization source. Cloudflare identity verification establishes a
verified principal, but fixed local role assignments establish permissions.
Administrative audit is part of the operation contract, not a best-effort log.

Service targets are resolved only through the trusted registered-service
catalog. HTTP cannot select Docker, Compose, PM2, systemd, executable paths,
commands, or external resource identifiers. Existing service-management and
availability capabilities remain the authoritative domain boundaries.

## Rejected alternatives

- Direct browser access to infrastructure adapters, arbitrary commands, or
  caller-selected external resource IDs.
- Assigning roles from JWT claims alone or accepting a caller-selected audit
  actor.
- Returning optimistic mutation state, unaudited effects, or automatic retries.
- A frontend-managed login session, browser storage for JWT assertions, role
  data, confirmations, service state, or event history.
- Enabling real wake/shutdown controls, Linux effects, or a background
  machine-power scheduler as part of dashboard delivery.
- External CDNs for scripts, fonts, styles, analytics, or telemetry.

The dashboard uses a closed same-origin asset inventory, restrictive CSP, safe
DOM text rendering, no CORS permission, and no credential persistence.

## Operational consequences

The service-management and availability routes are disabled by default and
require complete Cloudflare, role-assignment, event-history, catalog, and
loopback configuration before startup. Mutations require operation-specific
confirmations, a shared fail-fast gate, one authorization event, started and
terminal operation events, and an authoritative state reread when the final
audit result is uncertain.

The managed administrative profile is installed and removed by a separate
operator tool. Service activation and deactivation remain separate lifecycle
operations. Interrupted journals and partial effects require operator review;
there is no general force, repair, or adoption action.

This ADR does not authorize physical deployment, Cloudflare Tunnel or DNS
configuration, helper installation, RTC/D-Bus access, machine scheduling,
real wake, or shutdown certification.
