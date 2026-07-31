# ADR-003 — Separate administrative authentication, authorization, and privileged operation execution

## Status

Accepted

## Date

2026-07-31

## Context

Atlas Manager has immutable administrative events and controlled mock-first
power operations, but direct operations currently use
`administrative/unattributed-local`. That records an operation without proving
who requested it or why it was allowed. State-changing administration must be
authenticated and authorized before public exposure, while the production
identity mechanism remains undecided.

## Considered options

### Authorize only in HTTP controllers

Rejected as the complete architecture. Application use cases may later be
called through another delivery mechanism, and controller-only policy would
couple authorization to Express and permit bypasses through CLI or internal
callers.

### Authorize inside infrastructure adapters

Rejected. Adapters must not decide whether a principal may operate. This would
duplicate policy across PM2, Docker, RTC, helper, and mock adapters and mix
security decisions with operating-system behavior.

### Trust caller-provided roles or actor identifiers

Rejected. A caller could grant itself authority or forge audit attribution.

### Use a project-owned authentication and authorization boundary

Accepted. The application owns the principal model, fixed permission policy,
authorization decision, audit boundary, and protected operation composition.
The production authentication provider remains deferred; this ADR supplies a
deny-all default and deterministic mocks.

## Decision

Authentication and authorization are distinct:

```text
delivery-specific authentication provider
        ↓
project-owned authenticated principal
        ↓
project-owned fixed authorization policy
        ↓
audited authorization decision
        ↓
protected application operation
        ↓
existing controlled adapter
```

`AdministrativePrincipal` contains only a canonical lowercase UUID. The
authentication port receives no raw credentials and returns only authenticated,
unauthenticated, or unavailable results. The default authenticator returns
`credentials_absent`; no loopback, process owner, Linux username, environment
variable, development mode, or known UUID authenticates implicitly.

The project supports exactly four roles and seven permissions. The role-to-
permission mapping is fixed in reviewed code. Role assignments are read once,
unknown principals receive no implicit role, and unavailable role data fails
closed. Seven explicit administrative operations are accepted; each maps to
one permission.

Every protected operation authenticates once, authorizes once, records one
authorization event before invoking its target, and propagates the verified
`administrator:<principalId>` actor into existing administrative power events.
Unauthenticated attempts use `administrative/unauthenticated`. Authorization
audit failure prevents the target operation. Infrastructure adapters receive no
credentials, roles, permissions, sessions, or policy objects.

Destructive-operation confirmation remains independent of authorization. The
mock-first composition is not HTTP-exposed, does not validate production
credentials, does not add sessions or tokens, and does not activate the Linux
power helper.

## Consequences

Positive consequences:

- authorization cannot be bypassed by choosing a different delivery mechanism;
- audit events contain verified actors and safe allow/deny reasons;
- power and event-history capabilities share one application-owned boundary;
- tests can exercise security behavior without real credentials or effects;
- default construction is safe and deny-by-default.

Costs and limits:

- role persistence and production identity verification remain future work;
- no client identity is trustworthy merely because it is local;
- protected facades must be used for administrative execution;
- HTTP delivery, transport security, deployment validation, recovery, and rate
  limiting require a later security issue;
- real helper activation remains blocked.

## Review conditions

Before public administrative exposure or real power effects, a later reviewed
issue must select and implement the production identity mechanism, verify
transport and deployment ownership, define recovery procedures, add protected
delivery, and complete helper security review. Any change to the role-policy
mapping, principal contents, actor vocabulary, or protected operation boundary
requires a reviewed code and documentation change.
