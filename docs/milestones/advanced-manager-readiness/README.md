# Atlas Manager access and distribution planning

## Naming and scope

The operator request used the names “iOS Manager” and “Advanced Manager”. This
planning set treats both names as references to Atlas Manager because the
inspected repository, administrative hostname, Cloudflare Access boundary and
dashboard all belong to Atlas Manager. A product rename is explicitly outside
this plan.

This planning pass is documentation-only. It does not change application code,
feature flags, Cloudflare, Nginx, systemd, deployment state or power settings.
It records what the current source can expose, what remains partial, and how to
deliver a safe, reinstallable package for server and operator-client use.

## Source context

| Item                    | Observed value                                                                    |
| ----------------------- | --------------------------------------------------------------------------------- |
| Branch                  | `main`                                                                            |
| Planning baseline       | `9c8aee92af2777803431a6618d0325b92257e8b8`                                        |
| Version                 | `1.0.0-rc.7`                                                                      |
| Administrative routes   | 45, closed catalog                                                                |
| Dashboard navigation    | Overview, Services, Schedules, Machine, Backups, Events, Infrastructure, Settings |
| CLI                     | TypeScript/Node `atlas`, read-oriented subset implemented                         |
| Existing server package | Reproducible Linux amd64 deployment bundle                                        |
| Existing installer      | Disabled-first, fixed-path, side-by-side release installer                        |

The operator reports that the milestone is deployed. That statement is useful
context but is not treated as runtime evidence here. Deployment binding,
feature flags, Cloudflare assertion forwarding, RBAC assignments and page-level
acceptance must be collected read-only in the execution phase.

## Documents

1. [Administrative capability exposure](01-administrative-capability-exposure.md)
   defines what “open” means and inventories the protected surfaces.
2. [Cloudflare Access dashboard acceptance](02-cloudflare-access-dashboard.md)
   defines the authenticated browser flow and page-level checks.
3. [Reinstallable package design](03-reinstallable-package.md) separates the
   server deployment package from the portable operator client.
4. [Execution and qualification roadmap](04-execution-roadmap.md) provides
   phased delivery, tests, release gates and definition of done.
5. [Execution report](05-execution-report.md) binds the implementation slices
   and their deliberate security boundaries.

## Governing decisions

- “Open” means enabled for an authenticated and authorized operator, never
  anonymous or publicly exposed.
- Cloudflare Access authenticates the edge session; Atlas RBAC remains the
  application authorization boundary.
- Feature completeness and feature enablement are separate. A feature is not
  enabled merely because its route exists in source.
- Physical power effects remain outside the “enable everything” goal until a
  separate explicit power activation and host-safety milestone passes.
- The server package and the operator-client package have different privilege,
  runtime and portability requirements and must not be conflated.
