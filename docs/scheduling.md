# Scheduling

Atlas scheduling is a domain concern shared by service adapters. Presentation
layers normalize input and render results; they do not define a second policy
language.

## Availability modes

Registered services use `always`, `scheduled`, `manual` or `disabled`. A
scheduled policy has an IANA timezone and validated weekly windows. A window
must have a valid weekday and `start < end`; the domain rejects malformed or
overlapping policy input.

The current runtime persists availability overrides separately from the base
registered-service policy. Overrides are evaluated by the application layer
and consumed by the reconciliation scheduler.

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

`atlas services schedule show <service-id>` and `preview` expose the existing
protected availability response. The dashboard renders the same response as a
weekly timeline. A writable weekly editor requires a backend policy store and
application use case; it must not be implemented as browser-only state.

## Machine policy safety

Machine schedules use the separate power-management domain. Preview,
simulation, readiness and audit are safe capabilities. Real power effects
remain behind identity, helper, activation and feature gates. Automated tests
must use fake/mock transports and must never shut down or reboot the host.
