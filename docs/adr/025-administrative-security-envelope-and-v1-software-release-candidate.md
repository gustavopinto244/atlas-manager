# ADR-025 — Close the administrative security envelope and qualify a software-only v1.0 release candidate

Status: Accepted

## Decision

Atlas Manager continues to bind administrative HTTP only to `127.0.0.1`. A
public HTTPS origin describes the operator-facing origin, but it does not make
the application an ingress proxy. Cloudflare Access remains the external
identity gate and the application performs its own stateless authentication,
role resolution, authorization, and audit-before-effect checks.

The administrative route-security catalog is the closed inventory for every
`/admin` route. Composition validates that each route has one activation owner,
one operation, one permission, bounded parsing, an explicit gate, audit policy,
and replay classification. Express `trust proxy` remains false and forwarded
headers are never security inputs. Browser-origin and Fetch Metadata checks are
defense in depth; they do not replace Access assertion verification.

The dashboard has no login session and stores no assertion, role, or identity
data in browser storage. Mutations continue to use strict JSON and exact,
operation-specific confirmations. A narrow maintenance entrypoint remains for
deployment and security verification; a general administrative CLI is deferred.
The release candidate produced after remediation was `1.0.0-rc.2`; it is now
historical and was superseded by `1.0.0-rc.3` after the physical runtime-identity
inspection exposed a clean-absent password precondition defect. `rc.3` is also
historical and was superseded by `1.0.0-rc.4` after account-tool compatibility
inspection. `rc.1` remains
superseded because its release evidence was not reproducible.

## Boundaries

This decision distinguishes loopback binding, public origin, Cloudflare Tunnel
or equivalent ingress, Cloudflare identity, application authorization, browser
same-origin protection, the route catalog, the API contract, and release
qualification. A `1.0.0-rc.4` software candidate is not proof of physical Atlas
deployment, real RTC or shutdown effects, helper activation, or a stable
physical release. The earlier `rc.2` and `rc.3` candidates remain historical
and are superseded for new qualification by the runtime-identity corrections;
`rc.1` was superseded by audit remediation.

The current candidate explicitly rejects generic proxy trust, source-IP
authentication, JWT role assignment, cookies, wildcard CORS, unregistered
routes, automatic lockout repair, automatic physical deployment, helper
activation, and public unauthenticated API-contract delivery.

The administrative API contract is packaged with the application. The release
contract is a detached qualification artifact: it records the digest of the
final bundle and the release evidence without being placed inside that bundle.
This avoids the circular dependency in which the bundle would need to contain
the digest of an archive that changes when its embedded release contract is
updated.

## Security limits

The candidate does not claim cryptographic authenticity, non-repudiation,
external attestation, or physical certification merely because its event
history is hashed and its evidence is deterministic. Real Cloudflare ingress,
helper installation, RTC observation, wake scheduling, systemd-logind shutdown,
and physical recovery remain separately approved gates.
