# Scheduling

Atlas scheduling is a domain concern shared by service adapters. Presentation
layers normalize input and render results; they do not define a second policy
language.

## Availability modes

Registered services use `always`, `scheduled`, `manual` or `disabled`. A
scheduled policy has an IANA timezone and validated weekly windows. A window
must have a valid weekday and `start < end`; the domain rejects malformed or
overlapping policy input.

The runtime persists availability overrides separately from the base
registered-service policy. Base policy mutations use the protected
`/admin/services/:serviceId/schedule` resource and a dedicated policy store;
the `/availability` mutation remains reserved for temporary overrides.
Both are evaluated by the application layer and consumed by the same
reconciliation scheduler.

## Reconciliation flow

At a transition the scheduler evaluates the policy, generates an occurrence,
acquires a durable claim, invokes the adapter controller, checks readiness when
configured, advances the cursor and records the audit event. Claims and cursors
prevent duplicate execution and allow recovery after interruption. Conflicts
remain explicit; the UI and CLI must not silently retry a mutation.

For example, Monday 08:00 transitions offline → online, creates a claimed
start occurrence, starts the registered PM2/container/Compose adapter, checks
readiness and records completion. Monday 18:00 creates the corresponding stop
occurrence and applies dependency-aware stop orchestration.

## Preview and dashboard

`atlas services schedule show <service-id>` reads the protected base-policy
resource, while `preview` evaluates an explicit interval through the shared
domain. The dashboard renders the same policy as a weekly timeline and writes
through the protected schedule resource. The browser does not own policy state.

## Machine policy safety

Machine schedules use the separate power-management domain. Preview,
simulation, readiness and audit are safe capabilities. Real power effects
remain behind identity, helper, activation and feature gates. Automated tests
must use fake/mock transports and must never shut down or reboot the host.
