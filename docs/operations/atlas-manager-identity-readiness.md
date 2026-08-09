# Identity readiness

`/admin/security/status` reports bounded identity readiness. The maintenance
entrypoint supports only `inspect`, `verify-configuration`,
`verify-route-catalog`, and `verify-identity`.

The Cloudflare Access provider fetches:

```text
https://<team>.cloudflareaccess.com/cdn-cgi/access/certs
```

The response must contain a non-empty `keys` array with at most 16 strict
RS256 RSA keys. Cloudflare may also return the metadata fields `public_cert`
and `public_certs`; they are accepted but are not used for JWT verification.
All other top-level fields are rejected. Each key must have a unique bounded
`kid`, RSA `kty`, base64url `n` and `e`, and `alg=RS256`.

JWKS checks are bounded by a five-second request timeout and a 64 KiB response
limit. A successful refresh is cached for ten minutes. Concurrent refreshes
share one in-flight request. A failed refresh enters a thirty-second cooldown
to avoid repeated network work while the identity provider is unavailable.

Readiness outcomes are:

- `ready`: a fresh JWKS refresh succeeded;
- `ready_with_cached_keys`: the existing bounded cache is still usable;
- `unavailable`: the provider could not supply valid signing keys;
- `misconfigured`: Cloudflare Access configuration is absent.

Authentication remains fail-closed. A valid cache can be used during a
temporary provider outage, but an expired or unusable cache fails closed. JWTs,
assertions, certificates, and principal identifiers are not included in
readiness responses or operational logs.
