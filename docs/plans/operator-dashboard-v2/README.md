# Operator dashboard v2 plan

Planning source binding:

```text
origin/main=928697c782e1c68bffba389d10a48b96aee74ba8
release=1.0.0-rc.11
```

This plan responds to the first successful authenticated dashboard acceptance
on Atlas. The shell loads, but it is visually primitive, can remain stuck on
`Loading...`, and does not show the running Task Manager.

## Verified Atlas baseline

```text
registered services: 0
Task Manager: running under PM2 but absent from REGISTERED_SERVICES_JSON
Docker containers: 1 old stopped container
Nginx: active
cloudflared: active
```

The empty service catalog, not merely CSS, prevents Task Manager from appearing.
The dashboard refresh also couples core reads in one `Promise.all`; one failed
read prevents all successful sections from rendering. Docker CPU and memory
domain types/readers exist, but their data is not exposed by the current
administrative service DTO. PM2 CPU and memory are not yet represented by a
technology-neutral resource observation contract.

## Delivery slices

1. [Reliability and service registration](01-reliability-and-registration.md)
2. [Visual shell and service experience](02-visual-shell-and-services.md)
3. [Resource observability](03-resource-observability.md)
4. [Scheduling UX and adapter boundaries](04-scheduling-and-adapters.md)

Each slice must have its own implementation commit(s), targeted tests and a
green source gate before the next slice. Deployment occurs only after all four
slices pass full qualification and reproducible bundle generation.

## Architectural rule

```text
Dashboard component
  -> typed administrative API client
  -> protected administrative route
  -> application use case
  -> domain
  -> adapter/store
```

The browser may format observations and collect candidate input. It must not
own service policy evaluation, authorization, mutation admission, audit or
scheduler reconciliation.

## Critical control-plane boundary

Nginx and cloudflared are on the access path to the dashboard. Atlas Manager is
the control plane itself. Scheduling any of these off from the same dashboard
can make recovery impossible.

For this milestone:

- Nginx and cloudflared are read-only infrastructure dependencies.
- Task Manager, PM2 applications, Docker containers and Compose services may be
  registered and scheduled through their supported adapters.
- A future generic systemd adapter requires a separate ADR, an explicit denylist
  for Atlas/Nginx/cloudflared and an out-of-band recovery design.

## Global acceptance gates

```text
DASHBOARD_PARTIAL_FAILURE_ISOLATION=PASS
TASK_MANAGER_REGISTERED=PASS
SERVICES_READ_MODEL=PASS
SERVICE_RESOURCE_OBSERVATIONS=PASS
DOCKER_RESOURCE_USAGE=PASS
PM2_RESOURCE_USAGE=PASS
WEEKLY_SCHEDULE_EDITOR=PASS
SCHEDULE_PREVIEW=PASS
SCHEDULE_TIMELINE=PASS
NGINX_CONTROL_PLANE_PROTECTED=PASS
AUTHENTICATION_AND_RBAC=PASS
AUDIT_AND_MUTATION_GATES=PASS
POWER_MOCK_ONLY=PASS
FULL_SOURCE_QUALIFICATION=PASS
BUNDLE_REPRODUCIBILITY=PASS
ATLAS_OPERATOR_ACCEPTANCE=PASS
```
