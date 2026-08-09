# ADR-029: Persisted service availability policy

Status: Accepted

## Context

The registered service catalog currently loads each service's base availability
policy from `REGISTERED_SERVICES_JSON`. Runtime availability overrides are a
separate, temporary mechanism and must not be reused for editing the weekly
policy. The operator experience needs to edit the base policy without creating
an incompatible override payload.

## Decision

The base policy is persisted through a dedicated
`ServiceAvailabilityPolicyStore`. A policy-aware catalog overlays a persisted
policy on the immutable environment catalog. All existing service-management
use cases continue to depend on the catalog port, so reconciliation, preview,
status and orchestration observe the same effective base policy.

The policy store accepts only policies created by the existing domain factory.
It is keyed by registered service ID, uses an atomic file format in production,
and is independent from the availability override store.

The HTTP API for editing this policy will be a separate schedule resource. The
existing `/availability` mutation remains reserved for temporary availability
overrides. The dashboard must not send weekly policy fields to that endpoint.

## Boundaries

- Dashboard and CLI are presentation adapters only.
- Application use cases validate and persist policies.
- The domain remains authoritative for modes, timezone, weekdays, windows and
  transition evaluation.
- Reconciliation continues to combine the persisted base policy with the
  temporary override at evaluation time.
- Every policy mutation will be authenticated, authorized, admitted through the
  administrative mutation gate and recorded in event history.
- No power effect, scheduler activation or host architecture change is part of
  this decision.

## Consequences

The deployment configuration must provide a dedicated persistence path through
`SERVICE_AVAILABILITY_POLICY_FILE` before the schedule mutation resource is
enabled. Deployments without that path keep the environment catalog as their
base source and do not expose schedule mutations; this prevents an apparently
successful in-memory edit from being lost on restart.
