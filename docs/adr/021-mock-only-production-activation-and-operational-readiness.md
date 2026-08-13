# ADR-021 — Activate Atlas Manager first through a reversible mock-only systemd lifecycle

Status: Accepted

## Decision

Atlas Manager's first service activation profile is deliberately mock-only. A
separate operator-run runtime-configuration executable installs one canonical
environment file, and a separate service-lifecycle executable reloads, enables,
starts, verifies, stops, and disables the fixed systemd unit.

The profile is fixed to loopback, the mock power backend, disabled Linux power
effects, an always-on machine policy, an empty registered-service catalog, and
disabled administrative HTTP routes. It cannot activate the scheduler or any
power effect.

The lifecycle is guarded by fixed paths, exact confirmations, root-owned
metadata, nonblocking locks, synchronized journals, bounded reports, and
same-process rollback. Activation failure never uninstalls deployment,
configuration, identities, or application state. An incomplete rollback leaves
the journal for operator review and blocks later mutation.

## Boundaries

This decision separates:

- disabled application installation from runtime configuration installation;
- configuration installation from systemd daemon reload;
- daemon reload from service enablement and startup;
- service startup from loopback health and runtime-identity verification;
- service activation from administrative API activation;
- service activation from machine-power scheduler activation;
- application readiness from Linux helper installation and power-effects
  activation;
- software rehearsal from physical host certification.

The service unit continues to use `Restart=no`. The lifecycle tool has no
restart, repair, force, custom-command, or power-activation action. The helper
is absent and unused in this profile. ADR-035 further hardens this exact mock
profile with `NoNewPrivileges=true`, `RestrictSUIDSGID=true`, and no
`atlas-manager-power` supplementary group; a separately inventoried future
power-enabled template is never selected by this lifecycle.

## Rehearsal

The sandbox rehearsal uses injected account, systemd, filesystem, Node.js, and
HTTP observations. It runs configuration installation, activation, loopback
health checks, route-absence checks, deactivation, configuration removal, and
disabled-deployment verification without invoking real systemd or touching
production paths. Canonical evidence contains only bounded classifications and
SHA-256 report digests.

## Consequences

The software can be prepared for a later physical mock-only deployment drill.
Authentication, Cloudflare Access, administrative routes, service scheduling,
helper installation, Linux power activation, and real-effect certification
remain independent operator-approved gates.
