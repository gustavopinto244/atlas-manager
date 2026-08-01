# ADR-004 — Verify Cloudflare Access application JWTs for administrative identity

## Status

Accepted

## Date

2026-07-31

## Context

Atlas Manager has a project-owned administrative principal, fixed
authorization policy, audited protected operations, and no production identity
provider. Administrative HTTP delivery is still deferred, but the next
security foundation must verify an ingress assertion without trusting unsigned
identity headers or creating an implicit local administrator.

Cloudflare Access is the expected deployment boundary. It supplies an
application JWT through `Cf-Access-Jwt-Assertion`, while the origin can verify
that assertion using the team's published signing keys.

## Considered options

### Application-managed passwords and sessions

Rejected for the initial production identity mechanism. This would introduce
password storage, hashing, recovery, session persistence, and cookie-theft
concerns outside this bounded delivery.

### Static administrative API key

Rejected because a shared bearer credential cannot establish a human identity,
weakens audit attribution, and complicates safe rotation.

### Trust identity headers without JWT verification

Rejected. Headers such as `Cf-Access-Authenticated-User-Email`,
`X-Forwarded-User`, and `X-Authenticated-User` do not prove issuer, audience,
or origin authenticity.

### Trust only Cloudflare Tunnel-side validation

Rejected as the complete application boundary. Deployment enforcement remains
defense in depth, but the application independently verifies the assertion.

### Verify Cloudflare Access application JWTs

Accepted. The application uses a fixed configured team issuer, one exact
application audience, the derived HTTPS JWKS URL, RS256 signatures, bounded
retrieval, strict temporal claims, and a canonical lowercase UUID human
subject.

## Decision

The accepted chain is:

```text
Cloudflare Access policy
        ↓
Cf-Access-Jwt-Assertion
        ↓
strict HTTP assertion reader
        ↓
bounded Cloudflare JWKS provider
        ↓
RS256 signature verification
        ↓
issuer, audience, type, and time validation
        ↓
validated human subject
        ↓
existing AdministrativePrincipal
        ↓
existing authorization and audit
```

The configuration names are `CLOUDFLARE_ACCESS_TEAM_NAME` and
`CLOUDFLARE_ACCESS_AUDIENCE`; they must be supplied together. Issuer and JWKS
URLs are derived internally. The provider is request-scoped, while the
verifier, application clock, and bounded ten-minute JWKS cache are shared.
Unknown key IDs cause one coalesced refresh. A five-second request timeout,
65,536-byte streaming response limit, and thirty-second failed-fetch cooldown
are fixed in code. Empty `sub` values reject service-token assertions.

This ADR does not authorize administrative power HTTP routes, sessions, cookie
authentication, role persistence, helper activation, or real power effects. A
later bounded read-only event-history route may consume this provider only
through the existing protected-administration facade.

## Consequences

The application can cryptographically establish a project-owned principal
from a verified Cloudflare Access application token without storing a token,
email, claims, or key material in authentication results or event history.
Provider failures fail closed as `identity_provider_unavailable`; malformed or
invalid assertions become `credentials_invalid`. Missing configuration keeps
the existing deny-all authenticator and startup behavior.

The application now depends on the `jose` runtime library and on the
availability of the configured Cloudflare JWKS endpoint when a key is not
cached. Public administrative delivery remains incomplete and must be added
through a separate security-reviewed Issue.

## Review conditions

Revisit this ADR before adding another identity mechanism, accepting service
tokens, changing the issuer or audience model, accepting algorithms other than
RS256, adding email-based role assignment, or changing cache and network
bounds. The first protected event-history HTTP route is separately bounded by
ADR-independent configuration and delivery tests: it requires exact loopback
binding, has no trusted proxy or CORS permission, and uses fixed URL, body,
rate, concurrency, and response limits. Any broader protected delivery,
deployment ownership, or recovery procedure requires a separate review.
