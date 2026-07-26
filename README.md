# Atlas Manager

Atlas Manager is a self-hosted Node.js and TypeScript application for
monitoring, managing, and automating the Atlas homelab server.

The project is also an educational environment for learning backend
development, software architecture, testing, Linux automation, security, and
deployment through practical implementation.

## Project status

Atlas Manager is currently implementing the server-health and registered-
service foundations.

The repository currently includes:

- product vision and initial requirements;
- the architectural decision to use Express.js;
- Node.js and TypeScript configuration;
- ESLint and Prettier configuration;
- coding-agent instructions;
- an initial Express application with liveness and server-health endpoints;
- host uptime, memory, CPU, temperature, and disk monitoring;
- a validated registered-service model and controlled in-memory catalog;
- deterministic mock and read-only PM2 service-status adapters;
- HTTP integration testing with Vitest and Supertest.

Service control and the administrative API have not been implemented yet. The
current health endpoints do not report Docker, PM2, systemd, database, or
managed-service health.

## Planned capabilities

The planned initial release includes:

- server health monitoring;
- registered service status and control;
- service availability schedules;
- Docker resource monitoring and control;
- dependency-aware service startup and shutdown;
- server power scheduling;
- backup orchestration;
- event history;
- an administrative API;
- an administrative dashboard.

Database engines are treated as Docker-managed services in the initial release.

Logical PostgreSQL or MongoDB administration, backup, and restoration are
outside the initial scope.

### Service availability modes

Work on `v0.4 — Service availability scheduling` has started with the domain
vocabulary for the approved modes: `always`, `scheduled`, `manual`, and
`disabled`. The model provides exact runtime validation only.

The immutable weekly schedule model uses the lowercase weekday identifiers
`monday`, `tuesday`, `wednesday`, `thursday`, `friday`, `saturday`, and
`sunday`, plus canonical minute-precision local times in `HH:mm` format. Its
availability windows use half-open `[start, end)` semantics. Zero-length,
overnight, and overlapping windows are rejected, while adjacent windows are
accepted. Schedules contain between 1 and 64 windows and return them in
canonical weekday and time order.

The scheduling domain also approves exactly one explicit timezone identifier:
`America/Sao_Paulo`. Validation is exact and case-sensitive, accepts no aliases,
does not infer the host timezone, and provides no implicit default.

An immutable availability-policy model combines these existing validators.
`always`, `manual`, and `disabled` policies contain no timezone or weekly
schedule. A `scheduled` policy requires the approved `America/Sao_Paulo`
timezone and a valid non-empty weekly schedule.

Policies can be evaluated at an explicit instant. `always` produces the
`available` expectation, while `manual` and `disabled` preserve those explicit
states. A `scheduled` policy produces `available` or `unavailable` by evaluating
its half-open, minute-precision windows in `America/Sao_Paulo`. Conversion uses
the Node.js runtime timezone database rather than a fixed UTC offset.

The scheduling domain also defines immutable temporary overrides with the
canonical kinds `keep_available` and `suspend_schedule`. Every override requires
a canonical millisecond-precision UTC expiration timestamp later than an
explicit reference instant.

Policies can be evaluated with a validated override or `null` when none exists.
Overrides are active strictly before expiration; expired overrides delegate to
normal policy evaluation. For non-disabled policies, active `keep_available`
produces `available`, while active `suspend_schedule` produces `manual`.
`disabled` always has higher precedence. Override evaluation introduces no
storage, cancellation, scheduler, or automatic service control.

Service management defines an application port for associating at most one
active override with each exact registered-service identifier. Its initial
adapter stores only in process memory: saving replaces the existing association,
and removing a missing association is an idempotent success. Expired overrides
are not removed or evaluated automatically. The store is not connected to
production composition, HTTP creation or cancellation flows, and all stored
state is lost with the adapter instance or process.

An application use case can set or replace an override after resolving the
service through the registered-service catalog. It obtains the reference
instant from the injected application clock, delegates construction to the
scheduling-domain factory, saves under the catalog-owned service ID, and returns
the exact canonical override. Setting an override performs no immediate service
operation or policy-compatibility check.

A separate cancellation use case resolves the service through the catalog and
removes its stored override association using the catalog-owned ID. Removal is
idempotent for known services, including repeated cancellation when no override
is stored, and returns no domain result. Cancellation uses no clock, performs no
availability evaluation or immediate service operation.

Service-management composition exposes both set and cancel commands backed by
one private override store per composition instance. The default store is in
memory, and a custom implementation can be injected through the composition
seam. Setting uses the existing composition clock; cancellation does not. The
temporary state is isolated between composition instances and is lost when its
instance or process is discarded.

A file-backed availability override-store adapter implements the same
application port using a strictly validated version-one JSON file. A missing
file represents no overrides. Persisted entries are reconstructed through the
canonical override factory, contain at most one override per service, and must
already be ordered by service ID. Reads, replacements, and cancellations are
serialized within one adapter instance, and every state-changing operation
writes the complete state through an owner-restricted temporary file in the
target directory before atomic replacement. Reconstructing an adapter from the
same file preserves overrides across normal process restarts.

The adapter does not interpret expiration or automatically prune expired
overrides; effective-availability application logic remains responsible for
that behavior. Public errors expose neither paths nor override contents. It
provides no cross-process locking, so independent adapter instances writing the
same file may race.

Override persistence is independently opt-in through
`SERVICE_AVAILABILITY_OVERRIDE_FILE`. Its value must be an absolute path with no
surrounding whitespace. When absent, composition keeps its isolated
process-local in-memory store. When present, startup injects one file-backed
store through the existing override-store port, so override commands, effective
availability, reconciliation planning, and scheduler execution share persisted
state across normal process reconstruction. A missing target file represents no
overrides. The parent directory must already exist and be writable; Atlas
Manager does not create it. Invalid files and filesystem failures are not
repaired and do not fall back to memory. Expiration remains owned by existing
application behavior, so expired entries are not pruned automatically. Paths
and override contents are not logged.

The override-store port also supports atomic conditional removal by canonical
override value. It compares only `kind` and `expiresAt`; a matching current
value returns frozen `removed`, while both absence and mismatch return the same
frozen `not_removed` result without exposing current state. The file-backed
adapter performs its authoritative read, comparison, and optional atomic
replacement inside the existing per-instance operation queue. A stale expected
value therefore cannot remove a later replacement made through that instance.
Conditional removal does not evaluate expiration, and expired-override pruning
is not executed automatically. Independent adapter instances still have no
cross-process compare-and-remove guarantee.

An application use case can prune expired overrides for the services returned
by the registered-service catalog. After listing succeeds, one clock instant is
captured and validated for the complete execution. Services are processed
sequentially in catalog order using the same inclusive expiration boundary as
effective-availability evaluation. Missing and active overrides cause no write;
expired overrides are removed only through atomic conditional removal. A
concurrent replacement produces `not_removed` and remains preserved. Read and
removal failures are retained in frozen per-service results without preventing
later services from being processed, while results expose no override contents.
Persisted entries for unregistered service IDs are not inspected.

The pruning use case is not yet integrated into scheduler execution, startup,
HTTP delivery, or any background cleanup. It introduces no logging or metrics.
For the file-backed store, compare-and-remove remains coordinated only within
one adapter instance and provides no cross-process guarantee.

An application query resolves a registered service through the catalog, reads
its stored override, obtains one instant from the injected clock, and delegates
effective availability calculation to the existing domain evaluator. It returns
only `available`, `unavailable`, `manual`, or `disabled`. Missing and expired
overrides fall back to the base policy without deleting stored state. The query
does not retrieve actual service status or execute a service operation, and is
exposed through service-management composition. It shares the same catalog,
private override store, and clock used by the existing capabilities, so set,
cancel, and query observe one consistent override state. Independent composition
instances remain isolated. No active-override data query, scheduler, automatic
service operation, or HTTP override endpoint exists yet.

A pure reconciliation decision model compares an effective availability
expectation with an observed runtime state. Only `available + stopped` selects
`start`, and only `unavailable + running` selects `stop`. Already satisfied
states, `manual`, `disabled`, `failed`, and `unknown` produce an explicit
no-operation decision; reconciliation never selects `restart`. The model
retrieves no status and executes no control. Scheduler execution and duplicate
execution prevention are not implemented yet.

A read-only application use case plans availability reconciliation for one
catalog-owned service. It reads the stored override and current runtime state,
then obtains one instant from the application clock and delegates effective
availability and reconciliation rules to the existing domain functions. The
result is `execute start`, `execute stop`, or `none`. Planning does not inspect
supported operations, mutate override state, execute service control, or prevent
duplicate execution. It is not connected to a scheduler or HTTP delivery.

Service-management composition exposes reconciliation planning as an on-demand
internal capability. It shares the catalog, private override store, dispatching
status reader, and application clock with the existing capabilities, so set,
replacement, cancellation, status, effective availability, and planning observe
consistent dependencies. Planning still only returns `execute start`, `execute
stop`, or `none`; it does not inspect supported operations or execute control.
No scheduler, duplicate-execution protection, or HTTP endpoint exists yet.

Service-management composition exposes an explicit reconciliation execution
use case as an on-demand internal capability. It reuses the exact planning and
manual-control capabilities exposed by the same composition instance, so
planning and execution share catalog, override, status, and clock behavior,
while manual control and reconciliation execution share allowlist and controller
behavior. A `none` decision performs no service operation; `execute start` and
`execute stop` delegate through existing control and return its canonical
result. Reconciliation never selects `restart`, and failures propagate without
retries. Repeated explicit calls are not deduplicated. Execution must not be
scheduled automatically until duplicate-execution protection exists; no
scheduler or HTTP endpoint exists yet.

A canonical immutable reconciliation occurrence identifies scheduled intent by
the exact tuple of registered-service ID, `start` or `stop`, and canonical UTC
`scheduledFor` instant. Equality compares all three fields exactly, so scheduled
time remains distinct from processing or control-completion time. The model
does not generate transitions, execute operations, or provide occurrence
storage, claims, locks, or leases. Duplicate-execution prevention is therefore
not complete, no scheduler loop exists, and reconciliation execution remains
explicitly invoked.

An occurrence-claim application port defines one atomic `claim` operation, with
a deterministic in-memory adapter. The first claim for an exact service ID,
`start` or `stop` operation, and scheduled instant tuple returns `claimed`;
equivalent later claims return `duplicate`. Claims are atomic and private within
one store instance, process-local, and have no release or expiration. The store
executes no service operation, and duplicate-execution protection is not yet
connected to reconciliation execution. No scheduler loop exists.

Service-management composition exposes claim-aware occurrence execution as an
explicit internal capability. It reuses the exact composed planning and control
instances and one private claim store per composition instance; callers may
inject the existing claim-store port, while the default is process-local and in
memory. Non-applicable occurrences return `none` without a claim, equivalent
occurrences are suppressed within that composition, and successful claims
delegate through existing control. Claims remain consumed after control
failures, without retry or release. Separate compositions remain isolated, and
the service-ID-only explicit reconciliation capability remains unchanged. The
default store does not survive restarts, coordinate multiple processes,
guarantee successful execution, or provide distributed exactly-once behavior.
No scheduler, occurrence generation, HTTP endpoint, or persistence exists.

A file-backed occurrence claim-store adapter can persist the same claim-only
semantics in a strictly validated version-one JSON file. A missing file
represents no claims. Existing entries are reconstructed through the canonical
occurrence model and must already be unique and ordered by scheduled instant,
service ID, then operation. New claims rewrite the complete ordered set through
an owner-restricted temporary file in the target directory followed by atomic
replacement. Claim operations are serialized within one adapter instance,
equivalent later occurrences return `duplicate`, and reconstructing an adapter
from the same file preserves claims across normal process restarts. Public
errors expose neither paths nor occurrence contents.

Claims are persisted before service control, providing at-most-once claim
semantics rather than exactly-once service execution. A process exit after a
claim is persisted but before control completes can therefore suppress a later
retry. Version-one claims are permanent: there is no release, expiration,
pruning, compaction, or rotation, so the file may grow over time. The adapter
does not provide cross-process locking or distributed claim guarantees; two
adapter instances writing the same file may race.

Occurrence-claim persistence is independently opt-in through
`SERVICE_AVAILABILITY_RECONCILIATION_OCCURRENCE_CLAIM_FILE`. Its value must be
an absolute path with no surrounding whitespace. When absent, composition keeps
its isolated process-local in-memory claim store. When present, startup injects
one file-backed store through the existing application port, so direct and
scheduler-driven occurrence execution share persisted claims across normal
process reconstruction. A missing target file represents no claims. The parent
directory must already exist and be writable; Atlas Manager does not create it.
Invalid files and filesystem failures terminate reconciliation through existing
failure handling rather than being repaired or falling back to memory. Claim
paths and occurrence contents are not logged.

The scheduling domain can calculate actual policy expectation changes over a
bounded UTC interval with `(fromExclusive, toInclusive]` semantics. Results are
immutable `became_available` and `became_unavailable` transitions with canonical
UTC timestamps. Calculation follows the existing evaluator minute by minute, so
the configured policy timezone and runtime timezone database remain
authoritative, including daylight-saving gaps and repeated local times.
Adjacent windows do not create synthetic transitions, and each calculation is
limited to eight days. The scheduling-domain calculator itself does not generate
reconciliation occurrences or introduce scheduler or execution behavior.

The service-management application can generate ordered, immutable
reconciliation occurrences for one catalog-owned registered service over the
same bounded `(fromExclusive, toInclusive]` interval. Actual
`became_available` transitions map to canonical `start` occurrences and
`became_unavailable` transitions map to `stop`, preserving each UTC transition
timestamp exactly. Generation uses only the registered service's base policy:
it does not inspect runtime status or temporary overrides, claim or execute
occurrences, iterate the catalog, or run a scheduler loop.

Service-management composition exposes this generator as an explicitly invoked
per-service capability. Each composition creates one stable generator using its
existing private registered-service catalog, so environment-owned base policies
remain the source of truth and results stay ordered and immutable. Generation
does not evaluate temporary overrides or runtime status, claim or execute
occurrences, or introduce catalog-wide iteration, timers, HTTP delivery, or
persistence.

An explicit application tick can coordinate one caller-supplied bounded interval
across the registered-service catalog. It lists services once, then processes
services and their generated occurrences sequentially in catalog and occurrence
order. Generation failures are isolated per service, while execution failures
are isolated per occurrence; `none`, `duplicate`, and `executed` remain
successful processing outcomes. Claim behavior stays inside claim-aware
occurrence execution. The application tick itself has no clock, cursor, timer,
automatic loop, HTTP endpoint, logging, retry, or persistence.

Service-management composition exposes that tick as an explicit internal
capability and constructs it once per composition from the exact exposed
listing, occurrence-generation, and occurrence-execution instances. Direct and
tick-driven occurrence execution therefore share the same private claim state.
Callers still provide the bounded interval explicitly; service and occurrence
processing stays sequential and failure isolation is unchanged. No clock,
cursor, timer, automatic loop, HTTP endpoint, logging, retry, or persistence is
introduced.

A canonical immutable scheduler cursor records the latest successfully covered
UTC minute. Its process-local in-memory store starts empty and advances through
an atomic compare-and-set operation: equivalent expected values may move the
cursor strictly forward, while stale writers receive frozen `conflict` results.
Concurrent stale writers cannot all succeed within one store instance, and
separate stores remain isolated. No tick coordination, current-time clock,
automatic loop, composition integration, HTTP endpoint, retry, or persistence
is connected to this cursor boundary yet.

A file-backed scheduler cursor-store adapter can persist the same canonical
cursor in a strictly validated version-one JSON file. A missing file represents
empty state; malformed, unsupported, or non-canonical files fail safely without
automatic repair. Successful advancement writes an owner-restricted temporary
file in the target directory, flushes and closes it, then atomically renames it
over the target. Reads and compare-and-set advances are serialized within one
adapter instance, and reconstructing an adapter from the same file preserves
cursor progress across normal process restarts. Public errors expose neither
paths nor cursor contents. The adapter provides no cross-process locking or
distributed compare-and-set guarantee and is not yet selected by default
composition. No environment configuration, startup migration, HTTP endpoint,
or logging is introduced by the adapter itself.

Cursor persistence is opt-in through the exact environment variable
`SERVICE_AVAILABILITY_RECONCILIATION_SCHEDULER_CURSOR_FILE`. When absent,
service-management composition retains its isolated process-local in-memory
cursor. When present, the value must be an absolute path with no surrounding
whitespace; runtime startup constructs one file-backed store and injects it
through the existing cursor-store composition port. The target file may be
missing and then represents empty scheduler state, but its parent directory
must already exist and be writable because Atlas Manager creates no directories
automatically. For example:

```bash
export SERVICE_AVAILABILITY_RECONCILIATION_SCHEDULER_CURSOR_FILE="/var/lib/atlas-manager/reconciliation-scheduler-cursor.json"
export SERVICE_AVAILABILITY_RECONCILIATION_OCCURRENCE_CLAIM_FILE="/var/lib/atlas-manager/reconciliation-occurrence-claims.json"
export SERVICE_AVAILABILITY_OVERRIDE_FILE="/var/lib/atlas-manager/service-availability-overrides.json"
npm start
```

Persisted progress survives normal process reconstruction. Invalid cursor files
or filesystem failures terminate scheduling through the existing safe lifecycle
instead of falling back to memory or repairing state. Cursor paths and contents
are not logged. Cursor, occurrence-claim, and availability-override persistence
are independently configurable. Every configured path must differ because the
three files use incompatible versioned schemas.

The occurrence claim-store port also supports explicit pruning through a
canonical reconciliation scheduler cursor. Claims scheduled at or before
`completedThrough` are eligible through an inclusive canonical UTC boundary;
future claims are preserved. Missing, empty, and future-only state return frozen
`unchanged` without writing. Changed file-backed state returns frozen `pruned`
only after the existing owner-restricted same-directory atomic replacement
completes. Repeated pruning is idempotent and shares the same per-instance
operation queue as claiming.

Pruning uses no system clock, configurable retention duration, or persisted
watermark. A direct caller may claim an older occurrence again after it has
been pruned. Claim-and-prune ordering is not coordinated across independent
file-store instances or processes.

An application use case can coordinate completed occurrence-claim pruning with
the authoritative scheduler cursor store. Each execution reads the cursor once.
Missing cursor state returns frozen `no_cursor` without accessing the claim
store. When a cursor exists, the exact canonical object is passed unchanged to
the claim store, and its exact frozen `pruned` or `unchanged` result is returned.
Cursor-store and claim-store failures propagate unchanged.

The orchestration use case does not create claims, advance the cursor, use a
system clock or configurable retention duration, or cache cursor state. Cursor
reading and claim pruning remain separate port operations without a cross-store
transaction or cross-process guarantee.

Persistent occurrence claims are written before service control, so a crash
after claim persistence can suppress a later retry. This provides at-most-once
claiming, not exactly-once service execution. Deployments using persistence
must retain one scheduler-owning process.

File-backed overrides likewise provide no cross-process locking or distributed
coordination guarantee. Deployments using any of these process-local atomic
adapters must retain one scheduler-owning process.

An explicit cursor-aware scheduler cycle reads one cursor and one clock value,
floors the clock to a canonical UTC minute, and runs at most one bounded tick.
Empty state bootstraps one minute; existing state catches up from the cursor
with an eight-day maximum per cycle. Every non-idle cycle runs reconciliation
first, expired-override pruning second, and completed occurrence-claim pruning
third. Its internal result carries the exact reconciliation report, override
pruning report, and claim-pruning result. Idle cycles run none of these
operations. A resolved incomplete override-pruning report stops maintenance
immediately: the incomplete cycle preserves both reports, carries a null
claim-pruning result to represent that it was not executed, and does not
advance the cursor. A resolved incomplete reconciliation report still allows
completed claim pruning through the previously authoritative cursor when
override pruning completes. Rejected reconciliation prevents both maintenance
operations; rejected override pruning prevents claim pruning; rejected claim
pruning prevents cursor advancement.

Cursor advancement requires both reports to contain no failures and completed
claim pruning to resolve. `no_cursor`, `pruned`, and `unchanged` are all
successful claim-pruning outcomes. A first cycle therefore retains claims from
its current interval: claim pruning independently reads the still-missing
authoritative cursor, returns `no_cursor`, and the candidate cursor advances
only afterward. Newly completed claims become eligible during a later non-idle
cycle. No candidate cursor or interval timestamp is passed into pruning.
Successful maintenance is not rolled back after a cursor conflict.

Service-management composition exposes the cursor-aware cycle as an explicit
internal capability. It constructs and exposes exactly one use case for each
pruning operation, then injects those exact instances into the cycle alongside
the shared application clock and reconciliation tick. Completed claim pruning
shares the exact cursor store used for scheduler progress and the exact
occurrence claim store used for duplicate protection. Callers may inject the
existing store ports, while defaults remain process-local and isolated.

The v0.4 scheduling persistence chain has a multi-reconstruction integration
scenario using the file-backed override, occurrence-claim, and scheduler-cursor
stores together with newly created composition instances. It verifies persisted
cursor continuity, duplicate protection, expired-override removal, and completed
claim pruning across scheduler cycles. Claims from the current cycle remain
protected until a later cycle can prune through the previously authoritative
cursor, demonstrating that recovery does not depend on process-local adapter or
composition state.

Retry-safety integration coverage also exercises a service effect that
completes before scheduler cursor advancement fails. After reconstructing every
file-backed store and the service-management composition, the same interval
regenerates the canonical occurrence and its persisted duplicate claim prevents
the effect from running again. A successful retry establishes the authoritative
cursor, and a later cycle prunes that completed claim while preserving claims
after the pruning boundary. This validates retry coordination through the
persisted claim and cursor contracts; it does not provide transactional
exactly-once execution across independent processes.

Cursor-conflict integration coverage uses independent file-backed cursor-store
instances to advance the same candidate before the original scheduler
advancement. It verifies that the resulting conflict preserves the competing
authoritative cursor after reconciliation and maintenance have completed,
without rerunning effects or rolling back removed overrides and persisted
claims. A reconstructed cycle at the same target is idle, while a later cycle
continues from that cursor and prunes only completed claims through its
boundary. This exercises the existing compare-and-set and persistence
contracts; it does not globally serialize independent scheduler processes.

Completed claim-pruning failure recovery is covered with an authoritative
cursor and claims persisted through the file-backed stores. The scenario
completes a reconciliation effect and expired-override pruning before claim
pruning rejects, then verifies that the error prevents cursor advancement and
leaves both completed and current-interval claims intact. After complete
composition and adapter reconstruction, the same interval is duplicate
protected, pruning succeeds through the previous cursor, the current claim
remains protected, and the cursor advances. These operations are coordinated by
their existing contracts and do not form one atomic transaction.

Expired override-pruning failure recovery is also covered through reconstructed
file-backed stores and compositions. A resolved failed override-pruning entry
returns an incomplete cycle with claim pruning represented as null, preserving
the expired override, historical claim, current claim, and cursor. A retry then
observes the duplicate current occurrence, removes the override, prunes only
through the previous cursor, preserves the current claim, and advances the
cursor without repeating the service effect.

Resolved incomplete reconciliation recovery is covered through the same
file-backed reconstruction chain. A controlled service-control failure after
claim acquisition produces a failed occurrence report, while override pruning
and conservative claim pruning still complete and the cursor remains at its
previous boundary. On reconstruction, the persisted claim produces the
existing duplicate result, maintenance remains safe, and the cursor advances.
This validates the current at-most-once claim behavior and does not promise
automatic replay or transactional recovery of an external effect.

A separate controlled scheduler-loop boundary can repeatedly invoke that cycle
after an explicit `start`. Its first cycle runs immediately; `advanced` and
`idle` results schedule one non-overlapping follow-up cycle after a fixed
one-minute delay. `incomplete`, `conflict`, unexpected cycle failures, and timer
failures terminate the lifecycle without retry. Explicit `stop` cancels a
pending timer or waits for in-flight work, and exposes one immutable terminal
completion. The Node.js timer adapter uses cancellable one-shot timeouts. This
loop is exposed through service-management composition as one stable,
non-restartable lifecycle capability. It reuses the exact composed scheduler
cycle and one private timer selected per composition. Callers may inject the
timer port; otherwise composition uses a private Node.js one-shot timer adapter.
Direct and loop-driven cycles share scheduler cursor state, occurrence claims,
and availability overrides through the existing dependency graph, while
default composition instances remain isolated. Composition does not start the
loop or schedule a timer. Composition construction, startup outside scheduler
execution, and shutdown do not directly prune; no separate pruning cadence,
timer, flag, retention duration, configuration, logging, metrics, or HTTP
endpoint exists.

The application runtime now creates service-management composition and starts
its scheduler loop exactly once after the HTTP server reports that it is
listening. The first cycle therefore runs immediately after HTTP readiness.
Graceful shutdown promptly requests both scheduler stop and HTTP server close,
then waits for both operations, including any in-flight scheduler cycle.
Incomplete reports, cursor conflicts, and scheduler failures request safe
application shutdown and a non-zero exit code. Lifecycle logs contain only
structured outcome and error-type metadata. No scheduler retry, automatic
restart, HTTP scheduler endpoint, enablement flag, persistent state, distributed
lock, or leader election exists.

File-backed pruning retains the override store's existing process boundary:
conditional removal is atomic only for operations coordinated through one
adapter instance. Scheduler integration adds no cross-process locking or
distributed cleanup guarantee.

Implicit current-time acquisition, environment or registered-service
configuration integration, automatic reconciliation, default policies, scheduler
execution, override execution, and automatic service control are not implemented
yet.

## Technology context

Currently configured:

- Node.js 24 LTS;
- npm;
- TypeScript;
- ESLint;
- Prettier;
- Express.js;
- Vitest;
- Supertest.

Approved for upcoming implementation:

- Zod;
- Pino.

Relevant infrastructure technologies include:

- PM2;
- Nginx;
- systemd;
- Docker;
- Cloudflare Tunnel.

## Requirements

For local development, install:

- Node.js 24;
- npm;
- Git.

Using NVM is recommended because the repository includes a `.nvmrc` file.

## Local development

Clone the repository and enter the project directory:

```bash
git clone https://github.com/gustavopinto244/atlas-manager.git
cd atlas-manager
```

Select the expected Node.js version:

```bash
nvm install
nvm use
```

Install the dependencies:

```bash
npm install
```

Run the development entry point:

```bash
npm run dev
```

### Health endpoints

While the application is running, access `GET /health/live` at
`http://127.0.0.1:3000/health/live` to verify that the HTTP process is alive. A
successful response has HTTP status 200 and the following JSON body:

```json
{
  "status": "ok"
}
```

This endpoint reports only whether the Atlas Manager HTTP process is alive. It
does not collect or expose health information about the Atlas host.

Access `GET /health/server` at
`http://127.0.0.1:3000/health/server` to retrieve the approved operational
metrics collected from the host. A successful response has HTTP status 200 and
the following structure:

```json
{
  "capturedAt": "2026-07-20T12:00:00.000Z",
  "uptimeSeconds": 7200,
  "memory": {
    "totalBytes": 8000000000,
    "freeBytes": 2000000000,
    "usedBytes": 6000000000,
    "usagePercentage": 75
  },
  "cpu": {
    "usagePercentage": 23.5,
    "temperatureCelsius": 47.25
  },
  "cpuLoadAverage": {
    "oneMinute": 0.42,
    "fiveMinutes": 0.31,
    "fifteenMinutes": 0.24
  },
  "disk": {
    "totalBytes": 240000000000,
    "availableBytes": 90000000000,
    "usedBytes": 150000000000,
    "usagePercentage": 62.5
  }
}
```

The timestamp uses ISO 8601, uptime uses seconds, memory values use bytes,
memory usage is a percentage from 0 through 100, CPU utilization is a
percentage from 0 through 100, and CPU load averages are dimensionless values
for their stated time windows. `cpu.temperatureCelsius` reports the approved
CPU package sensor in degrees Celsius, or `null` when that optional sensor is
unavailable. The disk object
represents the root filesystem: `totalBytes` is its total capacity,
`availableBytes` is the capacity available to the unprivileged Atlas Manager
process, `usedBytes` is total capacity minus available capacity, and
`usagePercentage` is the used proportion from 0 through 100. The monitored
path is an infrastructure detail and is not returned. This endpoint does not
expose hostnames, usernames, network configuration, process listings,
environment variables, credentials, filesystem paths, mount information, or
device identifiers.

Neither health endpoint represents Docker, PM2, systemd, database, or managed-
service health.

### Registered-service status infrastructure

The service-management feature can retrieve project-defined runtime states
through isolated adapters. PM2 is the first production status integration. It
uses the registered service's catalog-owned external resource identifier only
inside the infrastructure boundary and translates PM2 statuses into
`running`, `stopped`, `failed`, or `unknown`.

The PM2 integration executes only the fixed read-only `pm2 jlist` operation
without a shell. Its execution time and output size are bounded. Raw PM2
statuses, process metadata, paths, environment values, and complete process
list output are not part of the application contract.

A narrow infrastructure dispatcher selects the explicitly injected `mock` or
`pm2` status reader using only the registered service's validated management
adapter. The application use case remains independent of concrete readers.
Reader mappings cannot be registered or replaced dynamically, and failures
continue to originate from the selected reader without fallback. No HTTP
endpoint or production service catalog is configured for this capability.

### Registered-service control infrastructure

Service control is separate from status retrieval. The application control
flow resolves a catalog-owned service by its stable identifier and permits only
the `start`, `stop`, or `restart` operations explicitly included in that
service's supported-operation allowlist before delegating to infrastructure.
The safe completion result contains only the stable service identifier,
approved operation, and completion timestamp.

The deterministic mock controller changes no host or simulated status state.
PM2 is the first real service-control adapter. It resolves the registered
external resource identifier through an exact `pm2 jlist` name match, validates
the selected internal PM2 ID, and executes only `start`, `stop`, or `restart`
against that ID. Both PM2 process boundaries use direct execution without a
shell, a fixed five-second timeout, and a bounded 1 MiB output buffer.

Successful delegation means only that the adapter operation completed without
reporting a failure; it does not imply service health, readiness, reachability,
or a resulting runtime state. Raw PM2 data and internal IDs are not part of the
application result.

A narrow infrastructure dispatcher selects the explicitly injected `mock` or
`pm2` controller using only the registered service's validated management
adapter. Controller mappings are fixed after construction and cannot be
registered or replaced dynamically. The application use case remains
independent of concrete controllers, continues to enforce supported operations
before dispatch, and receives controller-specific failures unchanged without
fallback. No HTTP endpoint, production service configuration, or production
control composition is introduced.

### Service-management composition

A feature-level composition factory assembles `ListRegisteredServices`,
`GetRegisteredServiceStatus`, and `ControlRegisteredService` behind a frozen
capability bundle. All three use cases share one environment-created catalog.
Status and control share one application clock, while PM2 status and control
share one bounded process-list executor.

The factory explicitly assembles the mock and PM2 adapters with their status
and controller dispatchers. Construction performs only bounded configuration
parsing and object creation: it does not execute PM2, retrieve status, control a
service, start HTTP, or register signal handlers. The capability bundle exposes
only the three application use cases.

This feature composition is not connected to `main.ts`, `createApp`, or HTTP
delivery. Production startup integration remains a separate future Issue.

Stop the development process with `Ctrl+C`.

## Environment configuration

Atlas Manager validates its environment configuration before starting the HTTP
server. The supported variables are optional:

| Variable                   | Default     | Purpose                            |
| -------------------------- | ----------- | ---------------------------------- |
| `HOST`                     | `127.0.0.1` | Address used by the HTTP listener  |
| `PORT`                     | `3000`      | TCP port used by the HTTP listener |
| `LOG_LEVEL`                | `info`      | Minimum structured logging level   |
| `REGISTERED_SERVICES_JSON` | `[]`        | Deployment-owned service allowlist |

The repository includes a safe `.env.example` documenting these variables. The
application reads variables from the process environment; it does not load
`.env` files automatically.

Start the development process with custom values:

```bash
HOST=0.0.0.0 PORT=8080 npm run dev
```

Or configure the compiled production entry point:

```bash
npm run build
HOST=0.0.0.0 PORT=8080 npm start
```

`PORT` must be an integer from `1` through `65535`. Invalid configuration stops
startup before the server begins listening.

### Registered-service catalog configuration

`REGISTERED_SERVICES_JSON` is a deployment-owned JSON array used to construct a
validated, immutable registered-service catalog. An absent variable or explicit
`[]` produces an empty catalog; an empty string is invalid. Each entry must
contain exactly `id`, `displayName`, `managementAdapter`,
`externalResourceId`, `supportedOperations`, and `availabilityPolicy`. The
previous five-field entry shape is no longer valid, and no policy default is
selected.

```json
[
  {
    "id": "example-service",
    "displayName": "Example Service",
    "managementAdapter": "mock",
    "externalResourceId": "example-service-target",
    "supportedOperations": ["readStatus", "start", "stop", "restart"],
    "availabilityPolicy": {
      "mode": "manual"
    }
  }
]
```

Non-scheduled policies use exactly one of the modes `always`, `manual`, or
`disabled` and contain no scheduling fields. A scheduled entry has this nested
policy shape:

```json
{
  "availabilityPolicy": {
    "mode": "scheduled",
    "timezone": "America/Sao_Paulo",
    "windows": [
      {
        "weekday": "monday",
        "start": "09:00",
        "end": "17:00"
      }
    ]
  }
}
```

Every scheduled policy requires the explicit `America/Sao_Paulo` timezone and
at least one valid weekly window. Policy association does not create a
scheduler or automatic start and stop behavior; existing manual status and
control flows remain unchanged.

Approved adapters are `mock` and `pm2`. Approved operations are `readStatus`,
`start`, `stop`, and `restart`, and every service must include `readStatus`.
Duplicate stable IDs and duplicate external resources under the same adapter
are rejected. The configuration is limited to 100 services and 65,536 UTF-8
bytes.

Configuration is loaded only through the explicit feature loader and cannot be
registered or reloaded through HTTP at runtime. Changes will require an
application restart after a future startup-composition Issue connects the
feature capability bundle to the running application. No production services
are configured, and service management remains absent from `main.ts`.

### Structured logging

Atlas Manager writes application lifecycle events as newline-delimited JSON
using Pino. The initial supported levels are `trace`, `debug`, `info`, `warn`,
`error`, `fatal`, and `silent`. The default level is `info`.

For example, start the application with debug-level logging:

```bash
LOG_LEVEL=debug npm start
```

Successful startup writes an `http_server_started` event containing the
configured host and port. Startup logging does not include the complete process
environment. HTTP request logging is not configured.

## HTTP error responses

HTTP errors use a stable JSON envelope:

```json
{
  "error": {
    "code": "route_not_found",
    "message": "Route not found"
  }
}
```

Unknown routes return status `404` with code `route_not_found`. Unexpected
failures return status `500` with code `internal_error` and the message
`Internal server error`. Responses never include raw errors, stack traces, or
internal paths.

Unexpected HTTP failures produce a structured `http_request_failed` log event
containing only the request method, path, and error type. Request bodies,
headers, cookies, query contents, and complete error stacks are not logged.

## Graceful shutdown

The production process handles `SIGINT` and `SIGTERM`. When either signal is
received, Atlas Manager stops accepting new HTTP connections, waits for the
listener to close, and then allows the process to terminate naturally.

Use `Ctrl+C` to send `SIGINT` during local development. Process managers and
operating systems may send `SIGTERM`.

A successful shutdown emits the structured lifecycle events
`application_shutdown_started` and `application_shutdown_completed`. A closure
failure emits `application_shutdown_failed` and sets a non-zero process exit
code. Repeated termination signals share the shutdown already in progress and
do not close the server more than once.

## Continuous integration

GitHub Actions automatically validates Pull Requests targeting `main` and
pushes merged into `main`. The CI workflow installs dependencies with `npm ci`
on Node.js 24, then checks formatting, linting, types, tests, and the production
build. A failure in any step fails the workflow.

The same validation commands remain available locally in the following
sections.

## Available scripts

### Development

```bash
npm run dev
```

Runs the TypeScript entry point in watch mode using `tsx`.

### Type checking

```bash
npm run typecheck
```

Checks the TypeScript code without generating build files.

### Build

```bash
npm run build
```

Compiles the TypeScript source code from `src/` into `dist/`.

### Production entry point

```bash
npm start
```

Runs the compiled JavaScript entry point from `dist/`.

Run `npm run build` before using this command.

### Lint

```bash
npm run lint
```

Checks the project using ESLint.

```bash
npm run lint:fix
```

Automatically fixes supported ESLint issues.

### Formatting

```bash
npm run format
```

Formats supported project files using Prettier.

```bash
npm run format:check
```

Checks formatting without modifying files.

### Tests

```bash
npm test
```

Runs the test suite once using Vitest.

```bash
npm run test:watch
```

Runs Vitest in watch mode and executes affected tests again when project files
change.

## Repository structure

```text
atlas-manager/
├── docs/
│   ├── adr/
│   ├── product-vision.md
│   └── requirements.md
├── src/
│   ├── config/
│   │   └── environment.ts
│   ├── http/
│   │   ├── errors/
│   │   ├── middleware/
│   │   └── create-app.ts
│   ├── logging/
│   │   └── logger.ts
│   ├── lifecycle/
│   │   └── graceful-shutdown.ts
│   └── main.ts
├── tests/
│   ├── config/
│   │   └── environment.test.ts
│   ├── http/
│   │   └── app.test.ts
│   ├── logging/
│   │   └── logger.test.ts
│   ├── lifecycle/
│   │   └── graceful-shutdown.test.ts
│   └── test-infrastructure.test.ts
├── AGENTS.md
├── eslint.config.js
├── package.json
├── tsconfig.json
└── README.md
```

Generated directories such as `node_modules/` and `dist/` are not versioned.

## Documentation

Detailed project context is available in:

- [Product vision](docs/product-vision.md)
- [Initial requirements](docs/requirements.md)
- [High-level architecture](docs/architecture.md)
- [Project glossary](docs/glossary.md)
- [Project roadmap](docs/roadmap.md)
- [Security model](docs/security-model.md)
- [Architecture Decision Records](docs/adr/)
- [Coding-agent instructions](AGENTS.md)

## Development workflow

The project follows this workflow:

1. GitHub Issue;
2. short-lived branch;
3. scoped implementation;
4. automated validation;
5. Pull Request;
6. review;
7. squash merge.

Commit messages follow the Conventional Commits convention.
