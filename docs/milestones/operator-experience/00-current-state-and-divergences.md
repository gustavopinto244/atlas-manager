# Historical baseline and resolved divergences

> This file records the 2026-08-08 planning baseline. The current source state
> is maintained in
> [`docs/reviews/operator-experience-current-state.md`](../../reviews/operator-experience-current-state.md)
> (source-derived, 2026-08-10) and the [capability matrix](../../capabilities.md).
> The authentication exception, CLI absence and 40-route baseline described
> below have since been resolved or superseded; the current catalog has 47
> descriptors, verified by `tests/http/administrative-api-contract.test.ts`
> rather than a static number in any document.

## Verified local source state

| Item                                   | Observed value                                         |
| -------------------------------------- | ------------------------------------------------------ |
| Repository                             | `/home/gustavo/Desktop/Projects/atlas-manager`         |
| Branch                                 | `fix/administrative-lifecycle-state-contract`          |
| HEAD                                   | `79235a215f8416eee179c0beb905fa5f3a6c7f9c`             |
| Working tree before this planning pass | clean                                                  |
| Package version                        | `1.0.0-rc.7`                                           |
| Administrative route count             | 40                                                     |
| Node test files                        | 204                                                    |
| Deployment Go test files               | 18                                                     |
| Power-helper Go test files             | 14                                                     |
| Official `atlas` CLI                   | absent                                                 |
| Package `bin` declaration              | absent                                                 |
| Dashboard source                       | `src/dashboard/main.ts`, `src/dashboard/styles.css`    |
| Dashboard architecture                 | one generated HTML shell with sections; no page router |

## Differences from the milestone prompt

1. The prompt names `d6d2e7c` as the latest deployed commit, but the local source
   has two later commits: `a8cf968` and `79235a2`. The operator transcript for
   the immediately preceding migration reports `79235a2` as deployed. Phase 38
   must verify this on Atlas read-only rather than trusting either statement.
2. The repository has no top-level `dashboard/` directory. Dashboard source is
   under `src/dashboard/`; generated assets are under `dist/dashboard-assets/`.
3. There is no consolidated operator runbook. Operational documentation is
   split across `docs/operations/`.
4. There is no official CLI. Existing Go commands are deployment, lifecycle,
   qualification and power-helper tools, not an operator command tree.
5. Service schedule policy is loaded from `REGISTERED_SERVICES_JSON`. Runtime
   mutation currently targets availability overrides, not the registered
   service's base weekly policy.
6. Machine operating policy is loaded from `MACHINE_OPERATING_POLICY`; no
   runtime policy store or administrative schedule-edit use case exists.
7. The API already contains 40 protected administrative routes, so route
   additions must be justified and contract-bound.

## Decisive security divergence

The route catalog declares every administrative route as authentication
`required`, but the current HEAD bypasses failed authentication for a set of
read operations in `create-protected-administration.ts`. The exception covers
the dashboard, overview, service reads, availability reads and backup reads.

That behavior conflicts with the milestone rule that no administrative route
may work anonymously. It also creates a mismatch between the published route
security catalog and runtime behavior.

The first implementation boundary must therefore:

1. remove the unauthenticated read exception;
2. verify that Cloudflare Access injects `Cf-Access-Jwt-Assertion` for the admin
   application;
3. verify that Tunnel and Nginx preserve the assertion header;
4. verify team name, audience and JWKS configuration at the application;
5. prove authenticated dashboard reads succeed and unauthenticated reads fail;
6. preserve the lifecycle probe contract for `/admin/event-history`.

Do not solve this by adding trusted Host-only access or by making the dashboard
API public.

## Current dashboard

The dashboard is generated from a server-owned HTML template plus assets. It
already reads overview, services, availability, event history and backup data,
and exposes primitive service and backup forms. Current limitations include:

- no navigation or page model;
- raw JSON-heavy presentation;
- confirmation strings exposed as text fields;
- no schedule editor or timeline;
- no service logs view;
- no infrastructure summary;
- no machine-plan page;
- weak loading/error granularity;
- no dedicated browser component tests.

Vanilla TypeScript remains viable if split into modules and components. A
framework migration is not justified by the current source alone.

## Existing architectural strengths

- Feature-first domain/application/infrastructure layering.
- Mature service adapters for mock, PM2, Docker and Docker Compose.
- Shared service availability policy domain with strict timezone/window
  validation and next-transition calculation.
- File-backed cursor, claim and override stores with recovery tests.
- Backup target, run, schedule, retention and scheduler capabilities.
- Segmented event history with integrity, retention, rotation and export.
- Mock-first machine power domain and explicit Linux-helper privilege boundary.
- Administrative route catalog binding operation, permission, confirmation,
  gate, audit and replay policies.
- Reproducible bundle and release-evidence toolchain.

## Current operational architecture to preserve

```text
admin.gustavopinto.dev.br
  -> Cloudflare Access
  -> Cloudflare Tunnel
  -> Nginx 127.0.0.1:80
  -> Atlas Manager 127.0.0.1:3000

gustavopinto.dev.br
  -> Cloudflare Tunnel
  -> Nginx 127.0.0.1:80
  -> Task Manager 127.0.0.1:3001
```

No milestone track requires exposing ports 3000 or 3001 publicly.
