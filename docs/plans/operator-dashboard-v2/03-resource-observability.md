# Slice 3: resource observability

## Objective

Expose authoritative CPU, memory and uptime observations through a
technology-neutral service read model.

## Existing capability and gap

- Docker inspection and stats readers already model container runtime, health,
  uptime and resource usage.
- These Docker details are not wired into the administrative service response.
- PM2 status currently exposes service state but not a normalized CPU/memory
  observation.
- The dashboard must not execute `docker stats`, `pm2 jlist` or host commands
  directly.

## Domain/API design

Add a read-only observation model with explicit availability:

```text
ServiceResourceObservation
├── outcome: available | unavailable
├── observedAt
├── cpu
│   ├── usagePercent
│   └── unavailableReason
├── memory
│   ├── usageBytes
│   ├── limitBytes (optional)
│   ├── usagePercent (optional)
│   └── unavailableReason
└── uptimeSeconds (optional)
```

Numbers must have bounded, finite domain validation. Missing limits must not be
reported as zero. Adapter errors become stable, non-sensitive unavailable
reasons.

## Adapter work

1. Wire the existing Docker container details reader into a read-only
   application use case.
2. Add a PM2 resource reader based on structured PM2 output, with output size,
   timeout and schema limits equivalent to the existing status reader.
3. For Docker Compose, define whether metrics are per registered Compose
   service, per container, or aggregated. Prefer a list of member observations
   plus a documented aggregate; do not silently sum percentages with different
   denominators.
4. Return `unsupported` for adapters without resource support rather than
   fabricating values.

## Administrative API

Prefer extending service detail or adding:

```text
GET /admin/services/:serviceId/resources
```

If a route is added, update the administrative route catalog, permission,
request limits, contracts, route-count gates and authenticated integration
tests. This is read-only and requires no confirmation or mutation gate.

Do not poll every card aggressively. Use a bounded refresh interval, pause when
the page is hidden and retain the last observation as visibly stale after a
failure.

## Dashboard presentation

- compact CPU and RAM values on service cards;
- resource panel with current value, limit and observation time;
- optional short in-memory sparkline only after a fresh observation arrives;
- no persisted telemetry history in this slice;
- clear `unavailable`, `unsupported`, `timeout` and `permission denied` states.

## Tests

- Docker available/unavailable stats;
- PM2 structured output, timeout, oversized output and malformed numbers;
- no command details leak through API errors;
- finite/range validation;
- hidden-page polling pause and stale rendering;
- RBAC and host/origin/authentication envelope;
- Docker/PM2 executors replaced by fakes in automated tests.

## Acceptance

Task Manager shows PM2 CPU and memory. Registered Docker containers show CPU,
memory, limit, health and uptime. A metrics failure never hides basic service
status or scheduling controls.
