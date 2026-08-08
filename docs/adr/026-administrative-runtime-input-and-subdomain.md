# ADR-026 — External administrative input and dedicated dashboard origin

## Status

Accepted

## Context

The administrative runtime configuration is operator input, while a release
bundle is immutable and its manifest verifies an exact inventory. The previous
implementation looked for a real operator input beside the bundle executable,
which made adding that input invalidate the bundle.

Cloudflare Access also emits UUID v5 subjects in valid deployments. Restricting
administrative principals to UUID v4 rejected the verified JWT `sub` before RBAC
could compare it with the configured assignment.

## Decision

The operator input is read only from the fixed root-managed path
`/etc/atlas-manager/administrative-runtime.input.json`. It must be a regular,
root-owned `0600` file. No CLI argument selects an alternative path. The
example remains inside the bundle as
`atlas-manager.mock-admin.input.example.json`; strict manifest and checksum
verification remains unchanged.

Administrative principals use canonical lowercase RFC 4122 UUID syntax with
versions 1–5 and variants `8`, `9`, `a`, or `b`. This includes UUID v4 and v5;
the verified JWT `sub` is preserved byte-for-byte and must exactly equal the
configured `principalId`.

The canonical dashboard origin is
`https://admin.gustavopinto.dev.br/`. The dashboard shell is served at `/`,
assets at `/assets/*`, and administrative APIs remain under `/admin/*`. The
existing origin, host, Cloudflare authentication, RBAC, CSP, and no-store
security envelope protects both route families. The service continues to bind
only to `127.0.0.1:3000` with mock power and disabled machine effects.

## Consequences

Operators create the external input before running the administrative
configuration command. `inspect-bundle` and `verify-disabled` ignore it because
it is outside the bundle, while the configuration command validates its file
metadata and contents. The old `/admin` dashboard URL is no longer canonical;
API paths under `/admin/*` are intentionally retained.
