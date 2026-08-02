# Identity readiness

`/admin/security/status` reports bounded identity readiness. The maintenance
entrypoint supports only `inspect`, `verify-configuration`,
`verify-route-catalog`, and `verify-identity`. JWKS checks are bounded and use
the existing RS256-only verifier. A temporary outage may use a valid controlled
cache; an expired or unusable cache fails closed.
