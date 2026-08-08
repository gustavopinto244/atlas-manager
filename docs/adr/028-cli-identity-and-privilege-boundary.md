# ADR-028 — CLI identity and privilege boundary

Status: Accepted

## Context

The `atlas` executable is a presentation adapter. It must expose useful
read-only information without inventing a second authorization system, while
mutating operations must retain administrative authentication, RBAC, mutation
admission, concurrency control and event history.

The dashboard already runs behind the administrative HTTP security envelope.
The CLI may be used locally on Atlas or remotely, but it cannot safely assume
that a shell user is equivalent to a Cloudflare Access identity.

## Decision

### Read-only commands

Read-only CLI commands use the administrative HTTP API through the configured
`ATLAS_BASE_URL`. Public health endpoints remain public only where their
existing route contract permits it. Administrative reads continue to require
the server's normal authentication and RBAC checks.

The CLI never manufactures Cloudflare Access assertion headers, principal IDs,
cookies or role claims. A `401` or `403` is reported as an authorization error
or partial status, not treated as success.

### Mutating commands

Mutating CLI commands remain unavailable until a separate implementation
provides an explicit authenticated transport. The transport must identify the
operator, be auditable, enforce RBAC and use the same application use cases as
the dashboard. Direct calls to PM2, Docker, systemd, power helpers or stores
are prohibited.

The first acceptable implementation may be either:

1. an operator-authenticated HTTP session established through the existing
   access boundary; or
2. a deliberately scoped local IPC/OS identity boundary with documented
   permissions, replay protection and audit identity mapping.

The choice requires a new ADR and end-to-end security tests before any
mutating command is marked implemented.

### Privilege and power

The CLI does not elevate with `sudo` implicitly and does not accept passwords
or secrets as command-line arguments. Power commands are not added as a side
effect of this ADR. Existing mock/disabled power gates remain authoritative;
tests use fake transports only.

## Consequences

- Read-only CLI progress can continue independently of mutation identity.
- Operators must authenticate through the existing administrative boundary for
  protected reads.
- Service start/stop/restart and schedule mutations remain explicitly
  unavailable in the CLI until their identity contract is implemented.
- A future local transport must not silently become a privilege-escalation
  mechanism.

## Rejected alternatives

- Treating the Unix username as the administrative principal: it loses the
  application identity and audit contract.
- Forging Cloudflare headers from environment variables: it bypasses the
  assertion verifier and makes credential handling unsafe.
- Calling PM2/Docker/systemd directly: it bypasses domain orchestration,
  authorization, audit and concurrency gates.
- Embedding sudo passwords in CLI arguments or files: it exposes secrets to
  process inspection or accidental persistence.
