# Atlas Manager 1.0.0-rc.12

## Scope

This release candidate closes deployability and authentication-hardening gates
identified by the pre-deployment audit and the 2026-08-09 Cloudflare Access
authentication-loop incident.

## Internal authentication failure classes

JWT verification failures are now distinguishable by internal reason code without
leaking verification details to the HTTP response:

- `signature_invalid`: JWT signature verification failed.
- `issuer_mismatch`: Token issuer does not match configured value.
- `audience_mismatch`: Token audience does not match configured value.
- `claims_invalid`: JWT claims validation failed (temporal validity, required fields).
- `key_unavailable`: Signing key not found in cached JWKS.

These reason codes flow into the protected administrative audit trail, enabling
future authentication failures to be self-diagnosing without temporary diagnostic
routes.

## Process-level error handling

The application now registers handlers for unhandled promise rejections and
uncaught exceptions, ensuring they trigger graceful shutdown with a failure exit
code instead of an orphaned process.

## Infrastructure security templates

Two reference templates document operational security boundaries:

- `deployment/nginx/atlas-manager-admin.conf`: Nginx administrative server block,
  invariants from the 2026-08-09 incident (assertion forwarding, `/health/` deny).
- `deployment/sudoers/atlas-manager-operator`: Scoped `NOPASSWD` entries for
  systemctl/journalctl commands, replaces plaintext sudo password (CRIT-01).

Regression tests ensure the Nginx invariants remain checked into the repository.

## Safety invariants

Power remains mock-only for qualification and deployment:

- `POWER_MANAGEMENT_BACKEND=mock`
- `MACHINE_POWER_EFFECTS_ACTIVATION=disabled`
- `MACHINE_POWER_SCHEDULER_ENABLED=false`
- `ADMINISTRATIVE_WAKE_ALARM_HTTP_ENABLED=false`
- `ADMINISTRATIVE_SHUTDOWN_HTTP_ENABLED=false`

No Atlas host deployment or real power effects are included in this source release candidate.

## Deferred work

Operator Dashboard v2 Slice 1 (Task Manager PM2 registration) is deferred to rc.13
to keep this release focused on deployability gates.

A Cloudflare API-based pre-deployment AUD verification tool is deferred; internal
failure-class audit trail covers the immediate risk.

PM2 sudoers entries and Docker container-access decisions remain operator choices
pending host configuration feedback.
