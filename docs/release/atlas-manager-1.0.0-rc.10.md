# Atlas Manager 1.0.0-rc.10

`1.0.0-rc.10` aligns Cloudflare Access application-token verification with
the assertion format observed at the qualified administrative ingress.

The verifier continues to require an RS256 signature from the configured team
JWKS, the configured issuer and application audience, an application token,
canonical administrative subject, and valid temporal claims. The optional JWT
protected-header `typ` is accepted when absent and must remain exactly `JWT`
when present. Embedded or remotely selected key material remains rejected.

This fixes authenticated dashboard requests whose valid Cloudflare Access
assertion omits the optional `typ` header. It does not weaken Host, Origin,
Cloudflare Access, RBAC, audit, admission, or mutation controls.

Power remains mock-only for qualification and deployment:

- `POWER_MANAGEMENT_BACKEND=mock`
- `MACHINE_POWER_EFFECTS_ACTIVATION=disabled`
- `MACHINE_POWER_SCHEDULER_ENABLED=false`
