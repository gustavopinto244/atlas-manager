# Security policy

Atlas Manager administrative HTTP is loopback-only and requires Cloudflare
Access verification followed by application RBAC. The software also enforces
public-origin and same-origin browser checks, a closed route catalog, bounded
inputs, and fail-closed managed persistence. Reports and browser code never
contain assertions, credentials, or private paths.

The `1.0.0` acceptance record provides deployment-specific evidence for the
real Atlas host and Cloudflare ingress; it is not a universal software
guarantee. Physical power is a separate gate and remains mock-only, effects-
disabled, scheduler-disabled, and unqualified. See the
[final operational acceptance evidence](docs/release/atlas-manager-1.0.0-final-operational-acceptance-evidence.md).

Please report security issues privately to the project owner; do not include
secrets or production event data in an issue.
