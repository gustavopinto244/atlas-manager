# ADR-027 implementation conformance review

Reviewed at: 2026-08-10
Baseline commit: `1d97f6c4b7fd2bb09ed9dba75c3a04e905b479de` (`main`, 1.0.0-rc.13)
Reviewed document: `docs/adr/027-operator-cli-and-dashboard.md`
Status at review time: `Proposed`

## Purpose

ADR-027 ("Operator CLI and dashboard are presentation adapters") has remained
`Proposed` while Operator Dashboard v2 Slices 1–4 and CLI slices CLI-1 through
CLI-5 shipped its decisions into the source. This review maps every normative
decision in ADR-027 to its implementation state with file-level evidence, so
that acceptance is a statement about the source rather than about intent.

Classification vocabulary:

- `IMPLEMENTED` — the decision is enforced by source and covered by tests.
- `PARTIAL` — the decision is enforced where the capability exists, but a
  capability the decision anticipates is not built yet.
- `NOT_IMPLEMENTED` — no source enforces the decision.
- `SUPERSEDED` — a later accepted ADR replaced the decision.

## Decision-by-decision conformance

### D1 — Layering: CLI is a presentation adapter over a client port

**Verdict: IMPLEMENTED**

`src/cli/` contains exactly seven modules (`main.ts`, `parser.ts`,
`command-tree.ts`, `help.ts`, `contracts.ts`, `errors.ts`,
`http-transport.ts`). Its complete import closure is `node:fs`,
`node:module`, `node:process`, `node:url` and sibling `./*.js` modules. No CLI
module imports an application use case, a domain module, an infrastructure
adapter, Express, or `node:child_process`.

Command handlers reach the backend only through the `AtlasCliTransport` port
declared in `src/cli/contracts.ts`, whose only production implementation is the
HTTP transport. `src/cli/main.ts` resolves the transport once and passes an
`AbortSignal`; it never receives a `fetch` reference.

Evidence: `src/cli/contracts.ts:16-22`, `src/cli/main.ts:54-63`,
`tests/cli/http-transport.test.ts`, `tests/cli/main.test.ts`.

### D2 — Layering: dashboard is a presentation adapter over a typed API client

**Verdict: IMPLEMENTED**

`src/dashboard/` is modularized into `api-client.ts`, `navigation.ts`,
`refresh-coordinator.ts`, `section-state.ts`, `service-operations.ts`,
`service-resources.ts`, `schedule-view.ts`, `weekly-schedule-editor.ts`,
`machine-plan-view.ts`, `power-controls.ts` and `main.ts`. All backend access
goes through `api-client.ts`. Dashboard modules hold rendering, interaction and
input normalization only.

The decision's explicit follow-up — "Keep vanilla TypeScript initially and
refactor into modules/components" — has been satisfied by Slices 1–3; the
dashboard is no longer "a single raw operational page".

### D3 — Domain rules stay in the backend

**Verdict: IMPLEMENTED**

Schedule validity, transition calculation, orchestration, readiness,
authorization, audit and concurrency have no presentation-layer duplicate:

- schedule validity/transitions: `src/service-scheduling/domain/`, reached via
  `PUT /admin/services/:serviceId/schedule` and the preview routes;
- orchestration/readiness:
  `src/service-management/application/orchestrate-registered-service-control.ts`
  and `plan-registered-service-orchestration.ts`;
- authorization/audit: `src/access-control/`, `src/event-history/`.

`src/dashboard/weekly-schedule-editor.ts` normalizes weekday/time input for
presentation; the persisted policy is still built by the backend canonical
parser. The CLI carries no schedule grammar at all.

### D4 — CLI implementation language is TypeScript/Node

**Verdict: IMPLEMENTED**

`package.json` declares `"bin": {"atlas": "dist/cli/main.js"}`; the CLI is
compiled by `tsconfig.build.json` and packaged by
`scripts/build-operator-package.mjs` into
`@atlas-manager/operator-cli`. Parser, command-tree, renderer and exit-code
tests live in the existing Node suite (`tests/cli/`).

### D5 — Command handlers may not compose unprotected mutation use cases; mutations use an authenticated administrative transport

**Verdict: IMPLEMENTED**

At baseline the decision was satisfied vacuously (no mutating command existed
and `services start|stop|restart` were `implemented: false` stubs). It is now
satisfied positively: the mutating commands added in this milestone reach
`POST /admin/services/:serviceId/actions/{start,stop,restart}` through the
authenticated administrative client defined by ADR-031, and no CLI module
imports `ControlRegisteredService` or any other use case.

### D6 — Dashboard stays vanilla TypeScript; generated assets, strict CSP and server-owned route registration remain

**Verdict: IMPLEMENTED**

No frontend framework dependency exists in `package.json`. Assets are generated
by `scripts/generate-dashboard-assets.mjs` and verified by
`scripts/verify-dashboard-assets.mjs`. A strict Content-Security-Policy is set
in `src/http/administrative-http.ts:22` and
`src/http/administrative-dashboard-route.ts:142`. Routes are registered by the
server through `registerAdministrativeRoute`, never by presentation code.

### D7 — Application API: existing administrative routes are reused; every route is cataloged with authentication, RBAC, request limits, confirmation, gate, audit and replay policies

**Verdict: IMPLEMENTED**

`src/http/administrative-route-security-catalog.ts` is the single registration
path. `AdministrativeRouteSecurityDescriptor` carries exactly the required
fields: `authenticationPolicy`, `permission`, `requestPolicy` (body kind,
`maxBodyBytes`, `maxRequestTargetBytes`, content types, content encodings,
duplicate-key and unknown-field policy), `confirmationPolicy`, `gatePolicy`,
`auditPolicy` and `replayPolicy`. The catalog holds 47 descriptors and is
regression-covered by `tests/http/administrative-route-security-catalog.test.ts`
and `tests/http/administrative-api-contract.test.ts`.

This milestone added **zero** new administrative routes: the CLI mutations
consume the pre-existing `services.start`, `services.stop` and
`services.restart` descriptors. The route count is unchanged at 47.

### D8 — Cloudflare Access assertion verification and application RBAC remain required for dashboard requests

**Verdict: IMPLEMENTED**

Every catalog descriptor is constructed with
`authenticationPolicy: "required"` and a permission derived from
`permissionForAdministrativeOperation`. There is no descriptor factory that can
produce an unauthenticated administrative route. Route handlers build a
`CloudflareAccessAssertionReader` per request and execute through
`createProtectedAdministration`, which runs
`ExecuteProtectedAdministrativeOperation`
(authenticate → authorize → audit → use case).

### D9 — The CLI does not forge Cloudflare assertion headers

**Verdict: IMPLEMENTED**

The CLI sets `Cf-Access-Jwt-Assertion` only from an externally supplied value
(`ATLAS_CLOUDFLARE_ACCESS_JWT` or the injected
`administrativeAccessToken` option) and omits the header entirely when no value
is present. It never synthesizes a principal ID, role claim, cookie or JWT.
Covered by `tests/cli/http-transport.test.ts` ("reads public health endpoints
without adding authentication headers", "forwards only a supplied real Access
assertion to protected requests") and by the transport suite added in this
milestone.

### D10 — Mutating CLI authentication requires a follow-up ADR choosing a normal Cloudflare Access flow or an explicit OS-level local identity boundary

**Verdict: IMPLEMENTED (discharged)**

ADR-028 (Accepted) fixed the identity and privilege constraints. ADR-031
(Accepted, this milestone) makes the concrete choice required here: an
operator-authenticated HTTP transport through the existing administrative
boundary, forwarding an externally issued Cloudflare Access assertion. The
OS-level local IPC alternative was evaluated and rejected in
`docs/reviews/mutating-cli-threat-model.md`.

This ADR-027 obligation is therefore discharged, not outstanding.

### D11 — Host diagnostics are read-only and report permission failures

**Verdict: PARTIAL**

No conflicting implementation exists. The runtime host-diagnostics capability
(`atlas infra status`, `atlas infra listeners`, `atlas nginx status`,
`atlas nginx test`, `atlas tunnel status`) is not built: those five nodes remain
`implemented: false` and return `command_not_implemented` with exit code 2. The
read-only constraint is preserved by the absence of any diagnostic adapter that
mutates, and by the CLI process-execution guard
(`tests/cli/no-direct-host-mutation.test.ts`) which forbids `pm2`, `docker`,
`systemctl`, `sudo` and `node:child_process` anywhere in `src/cli/`.

This is a _not-yet-built capability_, not a divergence: nothing in the source
contradicts the decision. It is tracked as the Operator Infrastructure
Diagnostics track, which remains an independent milestone.

### D12 — Power effects remain behind the existing helper, identity and activation gates; tests use mocks/fakes only

**Verdict: IMPLEMENTED**

`.env.example` pins `POWER_MANAGEMENT_BACKEND=mock`,
`MACHINE_POWER_EFFECTS_ACTIVATION=disabled` and
`MACHINE_POWER_SCHEDULER_ENABLED=false`. No power mutation command exists in
`src/cli/command-tree.ts`, and this milestone deliberately added none. The
power-helper Go suite runs against fixtures only.

### D13 — Rejected alternatives are not present in the source

**Verdict: IMPLEMENTED**

- Shell aliases: none; the CLI is a packaged executable.
- A CLI that directly executes PM2/Docker/systemctl for managed operations:
  forbidden and now regression-guarded.
- Dashboard-only schedule validation: the backend canonical parser is
  authoritative for every persisted policy.
- Anonymous dashboard APIs behind a trusted Host: impossible by construction —
  the descriptor factory hardcodes `authenticationPolicy: "required"`.
- Immediate frontend framework migration: not performed.

## Summary

| #   | Decision                                       | Verdict                  |
| --- | ---------------------------------------------- | ------------------------ |
| D1  | CLI is a presentation adapter over a port      | IMPLEMENTED              |
| D2  | Dashboard is a presentation adapter            | IMPLEMENTED              |
| D3  | Domain rules stay in the backend               | IMPLEMENTED              |
| D4  | CLI in TypeScript/Node, packaged               | IMPLEMENTED              |
| D5  | No unprotected mutation use cases from the CLI | IMPLEMENTED              |
| D6  | Vanilla dashboard, strict CSP, server routes   | IMPLEMENTED              |
| D7  | Route catalog discipline, route reuse          | IMPLEMENTED              |
| D8  | Access verification + RBAC required            | IMPLEMENTED              |
| D9  | CLI does not forge assertions                  | IMPLEMENTED              |
| D10 | Follow-up ADR for mutating CLI identity        | IMPLEMENTED (discharged) |
| D11 | Host diagnostics read-only                     | PARTIAL (not built)      |
| D12 | Power effects stay gated                       | IMPLEMENTED              |
| D13 | Rejected alternatives absent                   | IMPLEMENTED              |

Twelve of thirteen decisions are implemented. The single `PARTIAL` (D11) is a
capability that has not been started, not a source divergence: no code
contradicts the decision, and the constraint it imposes is actively enforced by
a regression guard. No decision is `NOT_IMPLEMENTED` and none is `SUPERSEDED`.

## Recommendation

**Accept ADR-027.**

There is no material divergence between ADR-027 and the source. Leaving it
`Proposed` while the whole Operator Experience has been built on its layering
misrepresents the governance state and has already produced stale downstream
claims. Acceptance is recorded in the ADR as
"Accepted based on implementation conformance review" without rewriting the
document's history.

D11 stays open as a _scope_ item under the Operator Infrastructure Diagnostics
track, and is carried forward in
`docs/milestones/operator-experience/06-infrastructure-diagnostics.md`. It does
not block acceptance.

Gate: `ADR027_GOVERNANCE=PASS`.
