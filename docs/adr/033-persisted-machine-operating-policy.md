# ADR-033 — Persisted machine operating policy

Status: Accepted

## Context

ADR-012 made `MACHINE_OPERATING_POLICY` a strict, immutable, environment-owned
startup input: it is parsed once, fed into `createPowerManagement`, and from
there into the machine power scheduler's confirmation reader and the plan
evaluator. No runtime setter exists, and that remains correct for anything
that actually governs the (currently disabled) scheduler or a real power
effect.

Operators still have no way to declare or preview a candidate shutdown/wake
schedule without editing `.env` and restarting. ADR-029 solved the equivalent
problem for registered services: `ServiceAvailabilityPolicyStore` persists a
base policy that overlays the environment catalog, with a dedicated schedule
resource, a candidate preview and startup-independent precedence, while
leaving the environment catalog authoritative for whatever the store does not
cover. This ADR applies the same shape to the machine's logical operating
policy, deliberately narrower in scope: it only ever changes what an operator
can read, preview and declare. It does not change what the scheduler,
confirmation reader or any physical effect consumes.

## Decision

A new `MachineOperatingPolicyStore` port persists at most one machine
operating policy — the same `MachineOperatingPolicy` domain object ADR-012
already validates via `createMachineOperatingPolicy`. `FileMachineOperatingPolicyStore`
is a single-record, file-backed implementation using the same atomic
temp-file-then-rename pattern as `FileServiceAvailabilityPolicyStore`
(`open("wx")` → `writeFile` → `fsync` → `close` → `rename`), gated behind a new
optional `MACHINE_OPERATING_POLICY_FILE` path, independent from every other
persistence path already in use (`SERVICE_AVAILABILITY_POLICY_FILE`,
`MACHINE_SHUTDOWN_OCCURRENCE_CLAIM_FILE`, `MACHINE_POWER_SCHEDULER_CURSOR_FILE`,
etc.), with the same pairwise-distinctness checks in `parseEnvironment`.

### Ownership and precedence

The store is authoritative for the *declared* policy that operators read and
edit; `MACHINE_OPERATING_POLICY` remains the environment-owned default. A new
`GetMachineOperatingPolicy` use case resolves the effective policy on every
read: the persisted policy when the store holds one, otherwise the
environment default, exactly as `PolicyAwareRegisteredServiceCatalog` overlays
a persisted service policy onto its environment source. `machine schedule
show` (CLI, dashboard and the `/admin/overview` `machineSchedule` field) is
repointed at this resolved value, so the "read-only" surface described in the
prior gap audit now reflects a policy an operator can actually change.

### What this explicitly does not change

`createPowerManagement`, the machine power scheduler, its confirmation
reader, and `evaluateMachinePowerPlan` as invoked by the scheduler tick
continue to receive only the ADR-012 environment-parsed `MachineOperatingPolicy`,
captured once at startup. This decision does not wire the persisted store into
that path. A future ADR is required before a persisted policy can influence
scheduler behavior, and that ADR will have to reconcile ADR-012's "no runtime
setter" rule with a live-reloadable source — not a change to make casually
alongside a plain CRUD feature. Until then, editing and removing the
persisted policy is a purely logical/declarative action: it changes what
`machine schedule show` and the new schedule resource report and preview, and
nothing a physical backend, scheduler tick or helper process ever observes.
`POWER_MANAGEMENT_BACKEND`, `MACHINE_POWER_EFFECTS_ACTIVATION` and
`MACHINE_POWER_SCHEDULER_ENABLED` are untouched by this delivery.

### Candidate preview

`PreviewMachineOperatingPolicy` validates a candidate policy through the same
`createMachineOperatingPolicy` factory and evaluates it with the existing
`evaluateMachinePowerPlan`, tagged `source: "candidate_preview"` — mirroring
`PreviewRegisteredServiceAvailabilityPolicy`'s reuse of the domain validator
and evaluator so the browser and CLI never compute a plan themselves. Unlike
the service preview, there is no override store or interval to combine: the
machine has one policy and the plan evaluator already reports the next
transition from "now", so the preview needs no `startsAt`/`endsAt` interval.

### Mutation, HTTP surface and RBAC

`SetMachineOperatingPolicy` and `RemoveMachineOperatingPolicy` persist or
delete the stored policy, exposed at `GET/PUT/DELETE /admin/machine/schedule`
and `GET /admin/machine/schedule/preview`, registered in
`administrative-route-security-catalog.ts` exactly like the service schedule
routes: `PUT`/`DELETE` require an exact confirmation token
(`confirm_machine_operating_policy_update` /
`confirm_machine_operating_policy_removal`), go through the shared mutation
gate, and are audited start-to-terminal. A new RBAC permission pair,
`power.schedule.read` / `power.schedule.write`, is added — distinct from the
existing `power.wake.*` and `power.shutdown.*` permissions, which govern wake
alarms and shutdown occurrences, not the declared policy. `power_operator`
and `administrator` gain the new permissions; no other role's permission set
changes, and no new privilege tier is introduced.

### CLI and dashboard

`machine schedule set`, `machine schedule remove` and `machine schedule
preview` are added to the CLI over the existing ADR-031 authenticated HTTP
transport — no new transport, no local privilege escalation. The dashboard
gains a machine schedule editor beside the existing read-only machine plan
view, built from the same weekly-window editing primitives
(`weekly-schedule-editor.ts`'s day/time-window helpers) already used for
service schedules, adapted to the machine policy's three modes (`always_on`,
`manual`, `scheduled`) and its `weeklySchedule.windows` shape. Both the CLI
and the dashboard re-read the authoritative resolved policy after a mutation
rather than trusting the request payload, matching every other mutation path
in this codebase.

### Rollback

Because the store holds at most one record and the environment default is
always available as a fallback, rollback of a bad persisted policy is
`machine schedule remove` (or `DELETE /admin/machine/schedule`): it deletes
the stored override and the effective policy reverts to
`MACHINE_OPERATING_POLICY` on the very next read, with no restart required.
There is no policy history or versioning in this delivery; an operator who
needs to restore a specific prior policy re-issues `machine schedule set`
with that policy's JSON.

### Audit

Every mutation is recorded through the existing `AdministrativeAuditTrail`
(`operationAudit.begin`/`complete`/`fail`), the same instance service schedule
mutations already use, with `target: {kind: "machine", id: "atlas"}` and
`operation` set to `update_machine_operating_policy` or
`remove_machine_operating_policy`. Reads are audited `authorization_only`,
identically to every other administrative read route.

### Concurrency

`FileMachineOperatingPolicyStore` serializes every read and write through the
same single in-process operation queue `FileServiceAvailabilityPolicyStore`
uses (`#enqueue`), so concurrent HTTP requests within one process cannot
interleave a read with a write or race two writes against each other. As with
the service policy store, cross-process concurrency is not addressed by this
ADR: `atlas-manager` runs as a single administrative process, matching every
other file-backed store in this codebase (occurrence claims, scheduler
cursor, service availability policy).

## Boundaries

- Dashboard and CLI are presentation adapters only; the domain factory
  (`createMachineOperatingPolicy`) remains the only validator.
- No physical power effect, scheduler activation, RTC operation, or helper
  invocation is part of this decision. `MACHINE_POWER_SCHEDULER_ENABLED`,
  `MACHINE_POWER_EFFECTS_ACTIVATION` and `POWER_MANAGEMENT_BACKEND` are
  unchanged.
- `.env` is never written to. The persisted policy lives only in the file
  named by `MACHINE_OPERATING_POLICY_FILE`.
- No new authentication mechanism and no new privilege tier: the new RBAC
  permissions are scoped to this one resource and granted only to the two
  roles that already handle machine power operations.

## Consequences

Deployments without `MACHINE_OPERATING_POLICY_FILE` configured keep
`MACHINE_OPERATING_POLICY` as the only source of truth and do not expose the
`/admin/machine/schedule` mutation routes, exactly as the service schedule
routes stay unregistered without `SERVICE_AVAILABILITY_POLICY_FILE` — this
prevents an apparently successful edit from being silently lost. A later ADR
is required before the persisted policy can flow into
`createPowerManagement`, the scheduler, or any physical-effect path.
