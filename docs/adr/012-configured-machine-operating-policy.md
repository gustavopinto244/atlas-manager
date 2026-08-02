# ADR-012 — Configure the machine operating policy through strict immutable startup input

Status: Accepted

Date: 2026-08-01

## Context

The power-management domain already supports `always_on`, `manual`, and
scheduled weekly operation in the fixed `America/Sao_Paulo` timezone. The
composition still used a hard-coded always-on policy unless a direct caller
provided a test override. Production startup needs one bounded, strict input
without adding runtime mutation or silently enabling power work.

The authoritative merged PR #259 baseline for this delivery is
`884f6afa724570f07f3cb1a6dda9e3e3fa659817`.

## Decision

Add `MACHINE_OPERATING_POLICY` as one strict JSON object. When absent, the
value is exactly `{"mode":"always_on"}`. The only accepted modes are
`always_on`, `manual`, and `scheduled`. Scheduled policies must use exactly
`America/Sao_Paulo` and the existing immutable weekly-window domain model.

The raw value is bounded to 16,384 UTF-8 bytes, rejects surrounding
whitespace, BOM, NUL, malformed JSON, trailing data, duplicate fields,
unknown fields, primitive roots, and array roots. A project-owned strict JSON
decoder detects duplicate object keys before the existing
`createMachineOperatingPolicy` validator runs. No second policy validator is
introduced.

The parsed domain policy is exposed through immutable `EnvironmentConfig` and
passed once to `createPowerManagement`. Planning and explicit scheduler ticks
therefore use the same canonical policy. Configuration is parsed once at
startup and cannot be changed by HTTP input, reload, scheduler intervals, or
runtime setters.

## Gate separation

This delivery completes only:

```text
machine operating policy configuration
```

It remains independent from:

```text
power infrastructure backend selection
administrative HTTP activation
machine-power scheduler activation
application-user enrollment
helper installation
real-effect certification
```

A scheduled policy does not select `linux_helper`, enable HTTP routes, or
start a scheduler. Startup performs no plan evaluation, scheduler tick, RTC
operation, helper request, D-Bus request, lock creation, occurrence claim,
service preparation, backup, or filesystem synchronization.

## Rejected alternatives

The application does not accept hard-coded production schedules, separate
weekday variables, arbitrary timezones, runtime policy mutation, HTTP-selected
policies, automatic reload, caller-selected scheduler intervals, implicit
scheduled mode, malformed-policy repair, duplicate JSON fields, oversized
input, or a fallback to always-on after an explicitly supplied invalid value.

## Consequences

`always_on` and `manual` remain safe non-planning policies. `scheduled` enables
only policy evaluation and explicitly invoked planning or scheduler ticks;
the scheduler lifecycle remains a later disabled-by-default Issue. Backend,
HTTP, and deployment gates remain independent, and no Atlas host or VM drill
is part of this delivery.
