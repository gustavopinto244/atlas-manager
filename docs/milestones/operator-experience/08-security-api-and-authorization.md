# Security, API and authorization plan

Implementation reconciliation: the unauthenticated read exception has been
removed and covered by shell, asset and API integration tests. The current
catalog has 45 descriptors; the 40-route value below is the original baseline.

## Required request flow

```text
Browser
  -> Cloudflare Access
  -> Tunnel/Nginx
  -> Host and origin envelope
  -> Cloudflare assertion verification
  -> administrative principal
  -> RBAC
  -> admission/mutation gate
  -> application use case
  -> audit
```

The dashboard is not an authorization boundary. Cloudflare Access does not
replace application assertion verification or RBAC.

## Immediate security repair

Before milestone features, remove the current
`UNAUTHENTICATED_DASHBOARD_READ_OPERATIONS` behavior and diagnose assertion
delivery/configuration. Required regression:

- authenticated dashboard shell/assets/API succeed;
- absent/invalid assertion fails closed;
- unknown principal and missing permission are denied;
- Host/origin validation still applies;
- `/admin/event-history` satisfies lifecycle protected-route probes;
- no trusted-Host-only shortcut exists.

## CLI identity boundary

The CLI must not fabricate `Cf-Access-Jwt-Assertion`. Candidate approaches must
be evaluated in a dedicated ADR:

1. normal Cloudflare Access human/service authentication against the protected
   API;
2. a separate local OS-level administrative boundary with explicit identity
   mapping, socket/file permissions and audit source;
3. read-only local diagnostics plus protected-API mutations.

Until accepted, only read-only CLI capabilities may be implemented.

## Current API baseline

- 2 health routes outside the administrative catalog.
- 40 administrative catalog routes.
- Every catalog descriptor declares authentication required and binds an
  operation, permission, request policy, confirmation, gate, audit policy,
  replay policy and feature flag.

## Candidate API additions

These are planning identifiers, not approved routes:

- service logs;
- service schedule read/update/remove/preview;
- aggregate operator status and doctor results;
- infrastructure summary/listeners;
- service scheduler state;
- machine plan/schedule/preview/scheduler state.

Before each route is added, define:

- route ID, HTTP method and path;
- activation flag ownership;
- administrative operation and permission;
- body/target/response limits;
- confirmation and mutation gate;
- audit and replay semantics;
- DTO schema and error codes;
- CLI/dashboard consumers;
- route-count contract delta.

## Confirmation policy

Read-only operations have no confirmation. Mutations are classified by effect:

- ordinary reversible operations: authenticated action plus concise UI summary;
- disruptive/destructive operations: explicit confirmation bound to target;
- power operations: preserve existing exact confirmations and gates.

Any reduction of current service-operation confirmation requirements is a
security contract change with dedicated tests and documentation, not a UI-only
decision.

## Security regression suite

- Cloudflare JWT/JWKS/team/audience handling;
- Host and origin envelope;
- RBAC and unknown principals;
- route registration/catalog reconciliation;
- method/body/content-type/strict JSON limits;
- request and mutation gates;
- security headers/CSP/CORS/trust proxy;
- authorization and mutation audit;
- CLI credential redaction and cancellation cleanup.
