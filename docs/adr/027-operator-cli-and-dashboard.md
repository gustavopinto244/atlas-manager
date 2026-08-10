# ADR-027 — Operator CLI and dashboard are presentation adapters

Status: Accepted

Accepted based on implementation conformance review
(`docs/reviews/adr-027-implementation-conformance.md`, 2026-08-10): twelve of
the thirteen normative decisions below are implemented and regression-covered
in the source, and the thirteenth (read-only host diagnostics) is an unbuilt
capability rather than a divergence. The follow-up mutating-CLI identity ADR
required by "Privilege boundaries" was discharged by ADR-028 (identity and
privilege constraints) and ADR-031 (concrete authenticated mutation
transport). The text below is preserved as originally proposed.

## Context

Atlas Manager has mature application/domain capabilities but exposes them
through protected HTTP routes, generated dashboard assets and specialized
deployment binaries. Operators still need long shell procedures, and the
dashboard is a single raw operational page.

The milestone adds an official `atlas` CLI and a multi-page dashboard without
duplicating domain rules or weakening administrative security.

## Decision

### Layering

```text
CLI
  -> command/application client port
  -> protected administrative API or read-only diagnostic use case
  -> application use case
  -> domain
  -> infrastructure adapter

Dashboard
  -> typed administrative API client
  -> protected administrative HTTP API
  -> application use case
  -> domain
  -> infrastructure adapter
```

CLI and dashboard contain formatting, interaction and input-normalization logic
only. Schedule validity, transition calculation, orchestration, readiness,
authorization, audit and concurrency remain backend concerns.

### CLI implementation language

Use TypeScript/Node for the official CLI, subject to acceptance of the CLI
identity ADR. Reasons:

- application/domain contracts and validators are TypeScript;
- the application bundle already carries the Node runtime and dependencies;
- typed DTOs can be shared without reimplementing schedule/error semantics;
- command parser/output tests fit the existing Node test suite.

This does not authorize command handlers to compose unprotected mutation use
cases directly. Mutations use an authenticated administrative transport.

### Dashboard implementation

Keep vanilla TypeScript initially and refactor into modules/components. Adopt a
framework only through a separate ADR after measured complexity justifies it.
Generated assets, strict CSP and server-owned route registration remain.

### Application API

Existing administrative routes are reused. New routes are added only for
missing application capabilities such as logs, schedule persistence/preview,
operator diagnostics and machine-plan views. Every route is cataloged with
authentication, RBAC, request limits, confirmation, gate, audit and replay
policies.

### Privilege boundaries

- Cloudflare Access assertion verification and application RBAC remain required
  for dashboard requests.
- The CLI does not forge Cloudflare assertion headers.
- Mutating CLI authentication requires a follow-up ADR choosing a normal
  Cloudflare Access flow or an explicit OS-level local identity boundary.
- Host diagnostics are read-only and report permission failures.
- Power effects remain behind the existing helper, identity and activation
  gates; tests use mocks/fakes only.

## Consequences

- Some CLI commands are blocked until the identity ADR is accepted.
- Shared DTO modules must avoid coupling presentation code to Express.
- API additions increase the route count and therefore require explicit
  contract/snapshot updates.
- Vanilla dashboard code must be modularized before feature growth.
- Domain and scheduler regressions remain authoritative over UI convenience.

## Rejected alternatives

- Shell aliases: not packageable, testable or contract-stable.
- A CLI that directly executes PM2/Docker/systemctl for managed operations:
  bypasses application orchestration, RBAC and audit.
- Dashboard-only schedule validation: duplicates domain rules.
- Anonymous dashboard APIs behind a trusted Host: weakens the security envelope
  and contradicts route policy.
- Immediate frontend framework migration: no current evidence justifies the
  additional dependency and CSP/tooling cost.
