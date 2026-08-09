# Atlas Manager 1.0.0-rc.11

## Scope

This release candidate fixes Cloudflare Access identity readiness against the
production JWKS envelope returned by the configured Access team.

The JWKS parser accepts the required `keys` member and the official optional
metadata members `public_cert` and `public_certs`. It continues to reject
unknown envelope fields and validates every signing key as a bounded, unique
RS256 RSA key.

## Verification

- Cloudflare Access assertion verification remains fail-closed.
- Valid assertions without an optional protected-header `typ` remain supported.
- Concurrent JWKS refreshes are coalesced.
- Failed refreshes use the bounded provider cooldown.
- Dashboard and administrative routes remain protected by Cloudflare Access,
  host/origin validation and backend RBAC.
- Power remains mock-only with physical effects disabled.
- No Atlas host deployment is included in this source release candidate.
