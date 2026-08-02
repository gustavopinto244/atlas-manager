# Atlas Manager

Atlas Manager is a self-hosted Node.js and TypeScript application for
monitoring, managing, and automating the Atlas homelab server.

The project is also an educational environment for learning backend
development, software architecture, testing, Linux automation, security, and
deployment through practical implementation.

## Project status

The repository has completed the functional scope of `v0.5 — Docker
management` on `main` through Pull Request #215. It now includes registered
service status and direct control, Docker containers, whole-project Docker
Compose management, bounded controlled logs, availability scheduling with
file-backed recovery, dependency graphs, runtime and Docker/Compose health
readiness, deterministic dependency-aware orchestration, and scheduler
integration.

The canonical acceptance matrix below is the source of truth for the final
v0.5 readiness audit. The older capability narrative later in this document
contains historical design detail; statements about an earlier milestone do
not override the current implementation or matrix.

The broader administrative API and dashboard remain future delivery work. The
health endpoints remain unauthenticated, and the administrative routes are
explicitly protected and gated; no administrative Docker endpoint has been
added.

The first protected administrative HTTP slice is now available behind an
explicit deployment gate: `GET /admin/event-history`. It is disabled unless
`ADMINISTRATIVE_EVENT_HISTORY_HTTP_ENABLED=true`, and enabled delivery requires
`HOST=127.0.0.1`, Cloudflare Access configuration, a persistent event-history
file, and trusted JSON role assignments containing at least an `auditor` or
`administrator`. The route uses the request-scoped
`Cf-Access-Jwt-Assertion` provider and the existing protected administration
facade; it never reads the event-history store directly.

The query supports bounded cursor pagination (`afterSequence`, `limit`) and
the existing source, operation, status, attempt, and UTC time filters. Each
authorized read records its authorization event in the same persistent store
before querying, so that event may appear in the returned page. Responses are
explicitly mapped, limited to 1 MiB, non-cacheable, and protected by
restrictive security headers. The route admits at most 60 requests per
60-second process-local window and four concurrently, without IP or proxy
headers, and grants no CORS permission.

The mock-first shutdown workflow is available separately behind
`ADMINISTRATIVE_SHUTDOWN_HTTP_ENABLED=true`. It requires the same shared
administrative configuration plus distinct persistent occurrence-claim and
scheduler-cursor files, and at least a `power_operator` or `administrator`.
The exact routes are `POST /admin/power/shutdown/preparations` and `POST
/admin/power/shutdown/executions`. Preparation and execution require different
exact confirmations; execution never performs automatic preparation and never
infers confirmation from authentication, roles, loopback access, or a previous
request. Preparation may stop registered services through the existing
dependency-aware service-management composition. Execution performs fresh
readiness, permanently claims the occurrence, schedules the mock wake alarm,
and requests simulated shutdown in that order. Claims and completed effects are
not released, retried, rolled back, or compensated after partial failures.

All protected administrative routes share the 60-per-60-second process-local
admission limit, four-request concurrency limit, and one active power-operation
gate. Shutdown remains simulated: no helper, real RTC mutation, or real machine
power effect is enabled.

The mock-first wake-alarm lifecycle is separately available behind
`ADMINISTRATIVE_WAKE_ALARM_HTTP_ENABLED=true`. It requires the same loopback,
Cloudflare Access, persistent event-history, and trusted role configuration,
with at least a `power_operator` or `administrator`. The exact resource is
`/admin/power/wake-alarm` with `GET`, `PUT`, and `DELETE`; `GET` observes the
mock alarm, `PUT` sets a future canonical `scheduledFor`, and `DELETE` is
idempotent. Wake requests share the administrative rate and concurrency limits,
while PUT and DELETE share one fail-fast mutation slot. There is no CORS,
helper activation, real RTC access, or real machine power effect.

Issue #248 adds read-only Linux RTC observation to the standalone helper
source, not to the application composition. The production helper uses only
fixed `rtc0` sysfs attributes, verifies `/sys` is sysfs, bounds each read to
128 bytes, and checks RTC time against the system clock within 300 seconds
before labeling values as UTC. Missing support is reported as unsupported and
uncertain or malformed state fails closed. Wake scheduling, cancellation, and
shutdown remain unsupported; the helper is not installed, setuid-enabled, or
invoked by Atlas Manager. CI uses a separately named deterministic fixture and
does not require RTC hardware.

Issue #250 adds real wake-alarm scheduling and cancellation to the standalone
helper source. It writes only absolute epoch values to the fixed
`/sys/class/rtc/rtc0/wakealarm` attribute, uses `0\n` for cancellation, and
performs RTC validation, read-before-write capture, bounded writes, and
read-after-write verification under a fixed nonblocking lock at
`/run/atlas-manager-power-helper.lock`. Replacements cancel before scheduling
the new value and are intentionally non-atomic; failures preserve the actual
state without retry or rollback. `request_shutdown` remains unsupported.

The helper is still not installed, setuid-enabled, or connected to Atlas
Manager. Existing HTTP routes remain mock-first and unchanged; CI uses
deterministic lock/filesystem fixtures and never mutates host RTC hardware.

Issue #252 adds the real standalone-helper shutdown backend through the fixed
systemd-logind call `org.freedesktop.login1.Manager.PowerOff(false)`. The
helper validates `/run/dbus/system_bus_socket`, uses one private
EXTERNAL-authenticated connection, holds the exclusive operation lock, and
enforces a three-second deadline. Inhibitors are not bypassed; no shell,
subprocess, syscall, retry, fallback, or RTC access is used. A successful
reply means logind accepted the request, not that power-off is complete.
The helper remains uninstalled and Atlas Manager remains mock-first.

Issue #254 adds a reproducible, operator-controlled `linux/amd64` installation
bundle. The build requires an explicit package version, source commit, and
`SOURCE_DATE_EPOCH`; it uses `CGO_ENABLED=0`, `GOOS=linux`, `GOARCH=amd64`,
`GOAMD64=v1`, `-trimpath`, and
`-buildvcs=false`. The archive contains the helper, a separate installer,
strict manifest, checksums, licenses, and the installation runbook. Checksums
verify integrity but do not prove authenticity.

The installer accepts only `inspect-bundle`, `install`, `verify`, and
`uninstall`, discovers the bundle beside its own executable, and has no
configurable destination. Only install and uninstall require root. The local
`atlas-manager-power` group must already exist and be empty; no user is added
to it. Installation is atomic and sets the fixed helper state to root-owned,
group `atlas-manager-power`, mode `04750` at
`/usr/local/libexec/atlas-manager-power-helper`. npm, Atlas Manager startup,
CI, and the application composition never install or invoke the helper.
Host qualification, signatures/provenance, user enrollment, and production
activation remain separate gates.

## v0.6 — Power management (active)

The first three power-management vertical slices are mock-first. They provide
project-owned RTC information with the wake-alarm states `unsupported`,
`not_scheduled`, and `scheduled`, an independent next-wake-alarm query, a
validated future-time schedule request, replacement and unchanged outcomes,
cancellation, and a narrow simulated machine-shutdown request. All
capabilities use an injected power-management clock and return immutable
project-owned results.

The default composition starts with no scheduled alarm. A schedule must contain
only a canonical future `scheduledFor` timestamp. Scheduling with no current
alarm returns `scheduled`; scheduling a different instant returns `replaced`;
scheduling the same instant returns `unchanged`. Cancellation returns
`cancelled` when an alarm exists and `not_scheduled` when repeated or already
empty. Unsupported alarm mutations are rejected as a project-owned error.

The next-alarm query and RTC information query observe one shared process-local
mock state, so successful scheduling and cancellation are visible through both
capabilities. The mock state is deterministic and is recreated with each
composition; it is not persisted.

The current RTC reader and shutdown controller are deterministic mock adapters.
They do not access an RTC device, kernel file, system bus, child process,
privileged executable, filesystem, or real machine power interface. No HTTP
endpoint, scheduler integration, persistence, real RTC mutation, or real
shutdown exists. Simulated shutdown and wake-alarm results describe mock state;
they do not mean that the machine powered off or that hardware was configured.

The third mock-first slice adds a project-owned machine operating policy with
the modes `always_on`, `scheduled`, and `manual`. Scheduled policies require
the exact explicit timezone `America/Sao_Paulo` and an immutable weekly
schedule containing one to 64 lowercase weekday windows. Machine windows use
canonical minute-precision `HH:mm` values and half-open `[start, end)`
semantics: the start is operating and the end is offline. Zero-length,
reversed, overnight, duplicate, and overlapping windows are rejected.
Adjacent windows are accepted and remain one continuous operating period for
planning; they do not create a synthetic transition.

The machine schedule evaluator returns the schedule expectation `operating`,
`offline`, or `manual`, together with immutable next-shutdown and next-wake
plans. It evaluates an explicit instant using the Node.js runtime timezone
database, searches across weekly boundaries with a bounded interval, and
returns canonical UTC timestamps. The default policy is `always_on`, which
expects the machine to be operating and plans no transitions.

This capability describes schedule intent only. It does not inspect real
machine state, configure RTC hardware, schedule a wake alarm, request
shutdown, create timers, persist data, or coordinate with registered-service
schedules. Machine and service schedules remain separate domains; their
interaction before a future power operation still requires a dedicated
design.

The fourth mock-first slice adds immutable machine-shutdown occurrences with
tuple identity `(operation, scheduledFor, wakeScheduledFor)`. Explicit callers
can execute due occurrences; future, stale, and duplicate attempts produce
read-only outcomes. Claims are process-local and permanent for the composition
lifetime, providing at-most-once attempts rather than exactly-once effects.

Execution schedules the exact next wake alarm before simulated shutdown, using
one application timestamp for both. Wake failure prevents shutdown but consumes
the claim. Shutdown failure leaves the wake alarm scheduled; there is no retry,
rollback, compensation, automatic scheduler, timer, persistence, real RTC
operation, or real shutdown.

Future v0.6 work includes persistent claims, process reconstruction, an
explicit bounded scheduler tick, confirmation and authorization design, and a
separate reviewed privileged adapter.

The fifth mock-first slice adds an explicitly invoked machine-power scheduler
tick. A first tick safely initializes an absent cursor without replaying
history. Later ticks process `(completedThrough, tickedThrough]`, with a
maximum duration of eight days, generate shutdown occurrences chronologically,
execute them through the existing occurrence executor, prune only claims
completed through the old cursor, and advance the cursor with compare-and-set.

Claims and cursors can use versioned file-backed stores. Files are canonical,
validated, newline-terminated JSON and are written through same-directory
temporary files with mode `0600`, synchronization, close, and atomic rename.
Missing files mean empty claims or no cursor. Reconstruction preserves
duplicate protection, but file-backed stores do not provide cross-process
locking or exactly-once effects.

Ticks return initialized, idle, blocked, incomplete, advanced, or conflict
results. Regressions and intervals larger than eight days are blocked; failed
execution leaves the cursor unchanged; cursor conflicts never overwrite the
authoritative cursor. Current-interval claims survive cursor failure and can
suppress replay after reconstruction.

Crash windows remain at-most-once: a persisted claim may prevent a later wake
or shutdown replay even when the process stopped before the effect began. Mock
wake-alarm state remains process-local and is not reconstructed from files.
Equivalent machine policy configuration is assumed during reconstruction.

The next readiness slice adds a fail-closed safe-shutdown boundary. A machine
offline interval is `[scheduledFor, wakeScheduledFor)`. Before an occurrence
can be claimed, the application requires explicit mock confirmation, evaluates
registered-service availability and runtime status through public
service-management capabilities, and reads active-task, backup, filesystem,
and event-recording readiness.

The safe default is `not_confirmed`; service readiness also fails closed unless
an explicit reader or public service-management adapter is supplied. A running,
failed, unknown, or interval-required service blocks shutdown. Active tasks,
backup activity, filesystem state, unavailable event recording, and dependency
failures produce project-owned blockers. Readiness checks are sequential,
bounded, immutable, and expose no raw dependency errors.

Rejected readiness decisions do not claim occurrences and do not mutate wake
alarms or request simulated shutdown. They remain retryable. The scheduler
reports a rejected occurrence as incomplete and keeps its cursor unchanged, so
a later explicit tick can retry after confirmation or readiness changes. No
service is stopped, task is cancelled, backup is run, filesystem is synced, or
event is persisted by this slice.

The first v0.8 event-history slice adds project-owned administrative events for
the six state-changing power operations. Each top-level operation receives an
internally generated attempt ID and produces a durable `started` event before
its first effect, followed by one safe terminal event. Events use the strict
Atlas machine target, trusted internal source vocabulary, operation-specific
details, contiguous store-assigned sequences, and no raw errors, paths,
credentials, tokens, or helper diagnostics.

Event history is separate from application logs and preparation progress
events. The default composition uses one in-memory store. Explicitly supplied
file history uses version-one canonical JSON Lines, one event per line, 8 KiB
line and 16 MiB file bounds, owner-restricted `0600` files, safe parent
directories, append-only writes, reconstruction, and bounded cursor queries
with filters. Missing files are empty for read-only queries; no implicit path,
retention, rotation, repair, cross-process locking, or HTTP endpoint exists.

Power readiness reads the same event-history instance used for recording. An
unavailable or corrupted history rejects shutdown before preparation, claims,
wake changes, or shutdown requests. If terminal recording fails after an
effect, the effect remains applied and a safe partial-effect error is returned;
there is no retry, rollback, or compensation. Direct calls are recorded as
`administrative/unattributed-local`; scheduler calls use the trusted
`automated/machine-power-scheduler` source. Issue #236 adds a mock-first
access-control boundary: authentication establishes an immutable UUID-only
administrative principal, while authorization independently evaluates one
explicit operation against the fixed roles `power_operator`,
`scheduler_operator`, `auditor`, and `administrator`. The default authenticator
denies all requests, role lookup fails closed, and callers cannot choose roles,
permissions, or audit actors.

Protected administration records an authorization decision before invoking the
underlying power or event-history capability. Authenticated events use the
verified actor `administrator:<canonical-principal-uuid>`; unauthenticated
attempts use `administrative/unauthenticated`. Authorization does not replace
explicit shutdown confirmation. The Issue #236 mock-first feature had no HTTP
routes, credentials, sessions, tokens, production identity provider, real
helper activation, or real machine effects; Issues #238 and #240 now add the
Cloudflare identity foundation, protected event-history delivery, and the
mock-first wake-alarm route.

## v0.7 — Backup orchestration (completed)

Backup orchestration uses registered mock or approved filesystem-tree targets,
atomic local artifacts, persistent checksummed run metadata, scheduled
occurrence claims, bounded retention, protected APIs, dashboard visibility,
and authoritative shutdown readiness. Restore, remote replication, logical
database backup, and physical execution remain future scope.

## Capability history and planned work

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

The pruning use case is integrated into the scheduler cycle; it introduces no
separate cleanup endpoint, cadence, logging, or metrics.
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
instances remain isolated. There is no public HTTP override endpoint.

A pure reconciliation decision model compares an effective availability
expectation with an observed runtime state. Only `available + stopped` selects
`start`, and only `unavailable + running` selects `stop`. Already satisfied
states, `manual`, `disabled`, `failed`, and `unknown` produce an explicit
no-operation decision; reconciliation never selects `restart`. The model
retrieves no status and executes no control. Scheduler execution and duplicate
execution prevention are provided by the occurrence and scheduler use cases.

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

Multi-service partial reconciliation recovery is covered through two
deterministic registered services in one scheduler interval. The integration
scenario preserves a mixed successful-and-failed report, removes both expired
overrides, prunes historical claims through the previous authoritative cursor,
and leaves both current claims protected while the cursor remains unchanged.
After complete reconstruction, duplicate protection prevents either service
operation from running again, maintenance remains idempotent, and the cursor
advances through the existing duplicate result contract. This demonstrates
the at-most-once limitation after claim acquisition; it does not promise
automatic replay, cross-service atomicity, or transactional exactly-once
execution.

A post-advance claim-cleanup integration scenario covers two consecutive
successful scheduler intervals with reconstructed file-backed stores. Claims
created while processing `T0` to `T1` are pruned only during the later cycle
that begins with `T1` authoritative; claims created during `T1` to `T2` remain
protected while that cycle advances the cursor to `T2`. The scenario verifies
one controlled effect per occurrence and final cursor/claim continuity. Claim
pruning and cursor advancement remain separate persistence operations and do
not provide a global exactly-once transaction.

Post-advance claim-pruning failure recovery is covered by a subsequent
file-backed reconstruction scenario. It creates a first-interval claim,
advances to `T1`, then creates a second-interval claim and fails completed
claim pruning through a test-local wrapper. The failure leaves `T1` and both
claims authoritative; a reconstructed retry observes the second claim as a
duplicate, does not repeat its effect, prunes the first claim through `T1`,
preserves the current claim, and advances to `T2`. This confirms that effects
and claims may commit before maintenance fails and does not claim an atomic or
globally exactly-once transaction.

Post-advance override-pruning failure recovery is also covered through a
file-backed reconstruction scenario. After a first interval advances the
cursor to `T1`, the next interval creates a claim and completes its controlled
effect before an expired override removal reports a failure. The scheduler
returns an incomplete result with claim pruning skipped, preserving `T1`, the
expired override, and both generations of claims. A reconstructed retry uses
the duplicate second occurrence, removes the override, prunes the first claim
through authoritative `T1`, preserves the current claim, and advances to `T2`.
This confirms that maintenance failure is not transactional rollback or global
exactly-once execution.

Post-advance cursor-advancement failure recovery is covered through a
file-backed reconstruction scenario that establishes the historical claim
through a real earlier successful interval. After a first interval creates a
first-interval claim and advances the cursor to `T1`, the next interval creates
a second-interval claim, completes its controlled effect, removes an expired
override, and prunes the first-interval claim through authoritative `T1` before
cursor advancement rejects with a controlled error. The authoritative cursor
remains `T1`; the committed maintenance mutations are not rolled back. A
complete reconstruction retries the same `T1` to `T2` interval; the persisted
second-interval claim produces the existing duplicate occurrence behavior, the
second controlled effect is not repeated, override pruning observes the absent
override, completed claim pruning returns `unchanged`, and the cursor advances
to `T2`. This confirms that service effects, claims, and maintenance may commit
before cursor advancement fails; successful maintenance is not rolled back; the
scheduler cycle is not transactional across all stages; retry relies on
persisted duplicate protection; candidate cursor `T2` does not become
authoritative after failed advancement; and the scheduler does not provide
globally exactly-once execution.

Post-advance cursor-conflict recovery is covered through a file-backed
reconstruction scenario that validates compare-and-set conflict behavior after
post-advance maintenance has committed. After a first interval creates a
first-interval claim and advances the cursor to `T1`, the next interval creates
a second-interval claim, completes its controlled effect, removes an expired
override, and prunes the first-interval claim through authoritative `T1` before
a competing real file-backed cursor operation advances the cursor to `T2`. The
local compare-and-set returns the existing conflict result rather than
rejecting. The scheduler returns a frozen `conflict` result that preserves the
existing reconciliation and maintenance results; the authoritative cursor is
`T2`; and the committed maintenance remains persisted. A complete
reconstruction reads `T2` as authoritative and returns `idle` because the
canonical target already equals the cursor. No occurrence is regenerated, no
controlled service effect is repeated, and no maintenance operation executes
during the idle cycle. This confirms that another scheduler process may make
the candidate cursor authoritative first; a cursor conflict is a resolved
scheduler result rather than a rejected operation; successful local maintenance
is not rolled back; the reconstructed scheduler must not retry an interval
already made authoritative by the competitor; compare-and-set advancement
protects against stale cursor writes; the scheduler cycle is not transactional
across all stages; and the scheduler does not provide globally exactly-once
execution.

Post-conflict next-interval continuation is covered through a file-backed
reconstruction scenario that validates future scheduler progress after a cursor
conflict. After a first interval creates a first-interval claim and advances
the cursor to `T1`, the next interval creates a second-interval claim,
completes its controlled effect, removes an expired override, and prunes the
first-interval claim through authoritative `T1` before a competing real
file-backed cursor operation advances the cursor to `T2`. The local
compare-and-set returns the existing conflict result. A complete reconstruction
at a later canonical target `T3` reads `T2` as authoritative and processes
only the `T2` to `T3` interval. The third cycle creates a third-interval
claim, executes its controlled effect, observes the absent override, prunes
the second-interval claim through authoritative `T2`, preserves the
third-interval claim, and advances the cursor to `T3`. This confirms that a
cursor conflict does not prevent future scheduler progress; a reconstructed
process at a later target continues from the competing cursor; the conflicted
interval is not replayed; successful maintenance remains committed; claim
pruning uses only authoritative cursor boundaries; the scheduler cycle is not
transactional across all stages; and the scheduler does not provide globally
exactly-once execution.

Post-conflict next-interval incomplete reconciliation recovery is covered
through a file-backed reconstruction scenario that validates scheduler behavior
when a future interval encounters a controlled service failure after claim
acquisition. After a first interval creates a first-interval claim and advances
the cursor to `T1`, the next interval creates a second-interval claim,
completes its controlled effect, removes an expired override, and prunes the
first-interval claim through authoritative `T1` before a competing real
file-backed cursor operation advances the cursor to `T2`. The local
compare-and-set returns the existing conflict result. A complete reconstruction
at canonical target `T3` reads `T2` as authoritative and processes only the
`T2` to `T3` interval. The third cycle acquires a third-interval claim through
the real occurrence executor, but the controlled service operation fails after
claim acquisition. The reconciliation tick resolves with the existing failed
occurrence result. Conservative maintenance still executes: expired override
pruning observes the absent override, and completed claim pruning through
authoritative `T2` removes the second-interval claim while preserving the
third-interval claim. The scheduler returns a frozen `incomplete` result with
the cursor remaining at `T2`. A complete reconstruction at the same target
retries the `T2` to `T3` interval; the persisted third-interval claim produces
the existing duplicate occurrence behavior, the failed controlled operation is
not invoked again, maintenance remains idempotent, and the cursor advances to
`T3`. This confirms that occurrence claims are acquired before controlled
operations complete; retry does not automatically replay an operation after
claim acquisition; the at-most-once limitation applies; successful maintenance
remains committed; the scheduler cycle is not transactional across all stages;
and the scheduler does not provide globally exactly-once execution.

Post-conflict next-interval override-pruning failure recovery is covered
through a file-backed reconstruction scenario that validates scheduler behavior
when a future interval encounters a controlled override-pruning failure after
successful reconciliation. After a first interval creates a first-interval
claim and advances the cursor to `T1`, the next interval creates a
second-interval claim, completes its controlled effect, removes an expired
override, and prunes the first-interval claim through authoritative `T1` before
a competing real file-backed cursor operation advances the cursor to `T2`. The
local compare-and-set returns the existing conflict result. A new override
expired at `T3` is persisted through the public store API. A complete
reconstruction at canonical target `T3` reads `T2` as authoritative and
processes only the `T2` to `T3` interval. The third cycle acquires a
third-interval claim through the real occurrence executor and completes the
controlled service effect successfully. Expired override pruning then attempts
conditional removal of the `T3`-expired override, but the first eligible
removal fails through the existing resolved per-service pruning result. The
scheduler returns a frozen `incomplete` result with
`occurrenceClaimPruningResult: null`; completed claim pruning does not execute;
cursor advancement does not execute; the authoritative cursor remains `T2`; the
expired override remains persisted; the second-interval claim remains
persisted; and the third-interval claim remains persisted. A complete
reconstruction at the same target retries the `T2` to `T3` interval; the
persisted third-interval claim produces the existing duplicate occurrence
behavior, the third controlled effect is not invoked again, expired override
removal succeeds, completed claim pruning through authoritative `T2` removes
the second-interval claim while preserving the third-interval claim, and the
cursor advances to `T3`. This confirms that successful `T2` to `T3` effects may
commit before override pruning fails; incomplete override pruning skips
completed claim pruning; the incomplete cycle does not make `T3` authoritative;
the retry does not repeat an already claimed occurrence; completed claim
pruning uses authoritative `T2`; the scheduler cycle is not transactional
across all stages; and the scheduler does not provide globally exactly-once
execution.

Post-conflict next-interval claim-pruning failure recovery is covered through
a file-backed reconstruction scenario that validates scheduler behavior when a
future interval encounters a controlled completed claim-pruning rejection after
successful reconciliation and override pruning. After a first interval creates
a first-interval claim and advances the cursor to `T1`, the next interval
creates a second-interval claim, completes its controlled effect, removes an
expired override, and prunes the first-interval claim through authoritative
`T1` before a competing real file-backed cursor operation advances the cursor
to `T2`. The local compare-and-set returns the existing conflict result. A new
override expired at `T3` is persisted through the public store API. A complete
reconstruction at canonical target `T3` reads `T2` as authoritative and
processes only the `T2` to `T3` interval. The third cycle acquires a
third-interval claim through the real occurrence executor and completes the
controlled service effect successfully. Expired override pruning then removes
the `T3`-expired override successfully. Completed occurrence claim pruning
begins through authoritative `T2`, but the first targeted pruning operation
rejects with a controlled error. The scheduler cycle rejects with the exact
sentinel error; no scheduler-cycle result is returned; cursor advancement does
not execute; the authoritative cursor remains `T2`; the future expired override
remains absent because its removal committed before claim pruning failed; the
second-interval claim remains persisted because the rejected pruning operation
performed no mutation; and the third-interval claim remains persisted. A
complete reconstruction at the same target retries the `T2` to `T3` interval;
the persisted third-interval claim produces the existing duplicate occurrence
behavior, the third controlled effect is not invoked again, override pruning
observes the already absent override, completed claim pruning through
authoritative `T2` removes the second-interval claim while preserving the
third-interval claim, and the cursor advances to `T3`. This confirms that
successful `T2` to `T3` effects and override removal may commit before claim
pruning fails; a claim-pruning rejection causes the scheduler cycle to reject;
the failed cycle does not make `T3` authoritative; retry does not repeat an
already claimed occurrence; completed claim pruning uses authoritative cursor
`T2`; successful override removal is not rolled back; the scheduler cycle is
not transactional across all stages; and the scheduler does not provide
globally exactly-once execution.

Post-conflict next-interval cursor-advancement failure recovery is covered
through a file-backed reconstruction scenario that validates scheduler behavior
when a future interval encounters a controlled cursor-advancement rejection
after successful reconciliation and all maintenance. After a first interval
creates a first-interval claim and advances the cursor to `T1`, the next
interval creates a second-interval claim, completes its controlled effect,
removes an expired override, and prunes the first-interval claim through
authoritative `T1` before a competing real file-backed cursor operation
advances the cursor to `T2`. The local compare-and-set returns the existing
conflict result. A new override expired at `T3` is persisted through the
public store API. A complete reconstruction at canonical target `T3` reads
`T2` as authoritative and processes only the `T2` to `T3` interval. The third
cycle acquires a third-interval claim through the real occurrence executor and
completes the controlled service effect successfully. Expired override pruning
then removes the `T3`-expired override successfully. Completed occurrence
claim pruning executes through authoritative `T2` and removes the
second-interval claim while preserving the third-interval claim. Cursor
advancement from `T2` to `T3` then rejects with a controlled error. The
scheduler cycle rejects with the exact sentinel error; no scheduler-cycle
result is returned; the authoritative cursor remains `T2`; successful override
removal remains committed; successful completed claim pruning remains
committed; and the third-interval claim remains persisted. A complete
reconstruction at the same target retries the `T2` to `T3` interval; the
persisted third-interval claim produces the existing duplicate occurrence
behavior, the third controlled effect is not invoked again, override pruning
observes the already absent override, completed claim pruning through
authoritative `T2` returns `unchanged`, and the cursor advances to `T3`. This
confirms that successful `T2` to `T3` effects and maintenance may commit
before cursor advancement fails; cursor-advancement rejection does not make
`T3` authoritative; successful maintenance is not rolled back; retry does not
repeat an already claimed occurrence; completed claim pruning uses
authoritative cursor `T2`; the scheduler cycle is not transactional across all
stages; and the scheduler does not provide globally exactly-once execution.

Post-conflict next-interval cursor-conflict recovery is covered through a
file-backed reconstruction scenario that validates scheduler behavior when two
consecutive intervals encounter resolved compare-and-set cursor conflicts. After
a first interval creates a first-interval claim and advances the cursor to
`T1`, the next interval creates a second-interval claim, completes its
controlled effect, removes an expired override, and prunes the first-interval
claim through authoritative `T1` before a first competing real file-backed
cursor operation advances the cursor to `T2`. The local compare-and-set
returns the existing conflict result. A new override expired at `T3` is
persisted through the public store API. A complete reconstruction at canonical
target `T3` reads `T2` as authoritative and processes only the `T2` to `T3`
interval. The third cycle acquires a third-interval claim through the real
occurrence executor and completes the controlled service effect successfully.
Expired override pruning then removes the `T3`-expired override successfully.
Completed occurrence claim pruning executes through authoritative `T2` and
removes the second-interval claim while preserving the third-interval claim. A
second competing real file-backed cursor operation then advances the cursor
from `T2` to `T3`. The local compare-and-set returns the existing conflict
result. The third scheduler cycle returns a frozen `conflict` result; the
authoritative cursor is `T3`; successful override removal remains committed;
successful completed claim pruning remains committed; and the third-interval
claim remains persisted. A complete reconstruction at the same target `T3`
reads authoritative cursor `T3`, derives canonical target `T3`, and returns a
frozen `idle` result. No occurrence is regenerated, no controlled service
effect is repeated, no maintenance operation executes, and no additional
cursor advancement is attempted. This confirms that consecutive cursor
conflicts do not prevent scheduler progress; a cursor conflict is a resolved
scheduler result rather than an exception; intervals made authoritative by
competing processes are not replayed; successful local maintenance is not
rolled back; a process reconstructed at the same authoritative target returns
`idle`; compare-and-set semantics prevent stale cursor writes; the scheduler
cycle is not transactional across all stages; and the scheduler does not
provide globally exactly-once execution.

Post-consecutive-conflict next-interval continuation is covered through a
file-backed reconstruction scenario that validates scheduler behavior when a
later interval continues after two consecutive resolved compare-and-set cursor
conflicts. After a first interval creates a first-interval claim and advances
the cursor to `T1`, the next interval creates a second-interval claim,
completes its controlled effect, removes an expired override, and prunes the
first-interval claim through authoritative `T1` before a first competing real
file-backed cursor operation advances the cursor to `T2`. The local
compare-and-set returns the existing conflict result. A second override
expired at `T3` is persisted through the public store API. A complete
reconstruction at canonical target `T3` reads `T2` as authoritative and
processes only the `T2` to `T3` interval. The third cycle acquires a
third-interval claim through the real occurrence executor and completes the
controlled service effect successfully. Expired override pruning then removes
the `T3`-expired override successfully. Completed occurrence claim pruning
executes through authoritative `T2` and removes the second-interval claim
while preserving the third-interval claim. A second competing real file-backed
cursor operation then advances the cursor from `T2` to `T3`. The local
compare-and-set returns the existing conflict result. The third scheduler
cycle returns a frozen `conflict` result; the authoritative cursor is `T3`;
successful override removal remains committed; successful completed claim
pruning remains committed; and the third-interval claim remains persisted. A
third override expired at `T4` is persisted through the public store API. A
complete reconstruction at canonical target `T4` reads `T3` as authoritative
and processes only the `T3` to `T4` interval. The fourth cycle acquires a
fourth-interval claim through the real occurrence executor and completes the
controlled service effect successfully. Expired override pruning then removes
the `T4`-expired override successfully. Completed occurrence claim pruning
executes through authoritative `T3` and removes the third-interval claim while
preserving the fourth-interval claim. Cursor advancement from `T3` to `T4`
succeeds. The fourth scheduler cycle returns a frozen `advanced` result; the
authoritative cursor is `T4`; all three expired overrides are absent; the
first, second, and third claims are absent; and the fourth-interval claim
remains persisted. This confirms that repeated resolved cursor conflicts do
not block future progress; each reconstructed process begins from the latest
authoritative cursor; intervals already made authoritative by competing
processes are not replayed; the claim retained by the latest conflicted
interval is removed only after a later cycle begins from that authoritative
cursor; completed claim pruning uses the authoritative cursor rather than the
candidate cursor; successful maintenance is not rolled back by cursor
conflicts; the scheduler cycle is not transactional across all stages; and the
scheduler does not provide globally exactly-once execution.

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

The historical planning examples above intentionally describe pure planning
boundaries. Current composition integrates configuration, scheduler execution,
override execution, and controlled service operations through those boundaries.

### Docker-managed registered containers

Atlas Manager supports Docker containers as registered services through the
`docker` management adapter. A configured Docker container is manageable through
the same project-level service-management contracts already used by mock and PM2
services.

The Docker integration is allowlist-based and restricted to approved container
targets defined in `REGISTERED_SERVICES_JSON`. Atlas Manager does not become a
generic Docker administration interface. External callers and application use
cases operate through the registered-service identifier, while the configured
Docker container name or identifier remains an infrastructure detail owned by
the registered-service configuration and Docker adapter.

A registered Docker service configuration uses the following structure:

```json
{
  "id": "atlas-api",
  "displayName": "Atlas API",
  "managementAdapter": "docker",
  "externalResourceId": "atlas-api",
  "supportedOperations": ["readStatus", "start", "stop", "restart"],
  "availabilityPolicy": {
    "mode": "always"
  }
}
```

The `externalResourceId` must be a non-empty canonical string containing no
control characters or surrounding whitespace. It is passed as a single argument
to Docker CLI commands and never interpolated into shell commands or treated as
executable syntax.

Docker commands use the approved `docker` executable with `shell: false`,
`encoding: utf8`, finite timeouts, and bounded output buffers. The implementation
does not use `exec`, `spawn` with shell enabled, or command concatenation.

#### Docker runtime state mapping

Docker container states are mapped to the existing project runtime states:

- `running` → `running`
- `created`, `exited` → `stopped`
- `dead` → `failed`
- `paused`, `restarting`, `removing`, unknown states → `unknown`

Runtime state and Docker health state remain separate concepts. A running
container with an unhealthy Docker health check remains `running` with a
`unhealthy` health state.

#### Docker health states

The Docker health state vocabulary includes:

- `not_configured` — no Docker health configuration
- `starting` — Docker health starting
- `healthy` — Docker health healthy
- `unhealthy` — Docker health unhealthy
- `unknown` — unsupported health value

An absent health object is not an error. An invalid structural value in a
present health object fails safely rather than being treated as trusted data.

#### Docker container details

The Docker details capability returns approved fields only:

- `serviceId` — the registered-service identifier
- `runtimeState` — the mapped runtime state
- `healthState` — the Docker health state
- `observedAt` — the observation timestamp
- `startedAt` — the container start timestamp (null when unavailable)
- `uptimeSeconds` — calculated uptime using the injected application clock (null when not running)
- `image` — the approved image reference
- `resourceUsage` — the resource usage snapshot

The details result does not include container environment variables, labels,
bind mounts, volume source paths, command or entrypoint values, host
configuration, network addresses, exposed ports, Docker socket information,
restart policy internals, registry credentials, raw inspect output, or raw
stats output.

#### Docker resource usage

Resource usage is retrieved through a narrow stats command with a fixed
project-owned format. The resource snapshot contains:

- `cpuPercent` — CPU percentage (may exceed 100 on multi-core systems)
- `memoryUsageBytes` — memory usage in bytes
- `memoryLimitBytes` — memory limit in bytes
- `networkReceiveBytes` — network receive in bytes
- `networkTransmitBytes` — network transmit in bytes
- `blockReadBytes` — block read in bytes
- `blockWriteBytes` — block write in bytes
- `pids` — process count

All values are finite, non-negative, and validated before model construction.
Docker CLI resource output quantities are parsed through a strict project-owned
parser supporting SI units (B, kB, MB, GB, TB) and IEC units (KiB, MiB, GiB, TiB).

Stopped containers do not execute the stats command. For a stopped, failed, or
unknown runtime state, the details result represents resource usage as
unavailable with reason `container_not_running`.

#### Docker service control

The Docker service controller supports only `start`, `stop`, and `restart`
operations. All options are fixed by production code. No caller may provide
arbitrary Docker flags, signal values, stop durations, command names, executable
paths, or container targets.

The process timeout applied by Node.js is longer than the fixed Docker
graceful-stop timeout so that expected Docker shutdown behavior is not
terminated prematurely.

Control operations perform no automatic retry or compensation. The Docker CLI
result remains authoritative for the requested operation. Hidden operation
substitution is not implemented.

#### Docker scheduling integration

Docker-managed services support the existing availability policies without
Docker-specific scheduling rules:

- `always`
- `scheduled`
- `manual`
- `disabled`

The scheduling domain remains infrastructure-independent. Docker-specific
behavior belongs only behind status and control ports.

The existing planning rules determine:

- `available + stopped` → `start`
- `unavailable + running` → `stop`

Docker services participate in the existing reconciliation scheduler using the
same occurrence claims and cursor persistence mechanisms as mock and PM2
services.

#### Docker daemon availability

The implementation fails safely when:

- the Docker executable is missing
- the Docker daemon is unavailable
- access to the Docker daemon is denied
- the command times out
- the configured container does not exist

The implementation does not fall back to mock behavior or reinterpret
infrastructure failure as `stopped`. Infrastructure failure remains an error.

#### Docker security restrictions

The Docker integration preserves the project's restricted-target model:

- callers provide the registered-service identifier
- the catalog resolves the configured Docker target
- the adapter executes fixed Docker commands with fixed project-owned options
  and the configured target as one argument

The implementation does not allow arbitrary Docker commands, subcommands,
command flags, container names from request input, shell command fragments,
Compose file paths from request input, host filesystem paths, Docker socket
selection from request input, environment-variable injection into Docker
commands, privileged container creation, image pulls, image removal, container
creation, container deletion, volume operations, network operations, registry
authentication, or secret inspection.

#### Docker logging restrictions

The implementation does not log raw Docker inspect output, raw Docker stats
output, container environment variables, labels, mount paths, configured
external resource identifiers, Docker daemon connection information, stderr, or
command arguments containing infrastructure targets.

#### Docker intentional limitations

The Docker vertical slice is container-focused and does not claim:

- generic Docker administration
- container creation
- container deletion
- image pulls
- image updates
- image deletion
- volume management
- network management
- registry management
- secret management
- parallel orchestration
- distributed Docker coordination
- globally exactly-once control
- transactional Docker operation and scheduler persistence
- automatic rollback
- automatic compensation

A Docker control operation may complete before a later scheduler persistence
stage fails. The existing persisted claim model provides at-most-once-oriented
duplicate protection, not globally exactly-once Docker execution.

### Docker Compose managed services

Atlas Manager supports Docker Compose projects as registered services through
the `docker-compose` management adapter. A configured Compose project is
treated as one whole-project resource and is not manageable at the individual
Compose service level.

Compose projects require adapter-specific management configuration:

```json
{
  "id": "atlas-stack",
  "displayName": "Atlas Stack",
  "managementAdapter": "docker-compose",
  "externalResourceId": "atlas-stack",
  "supportedOperations": ["readStatus", "readLogs", "start", "stop", "restart"],
  "managementConfiguration": {
    "composeFile": "/srv/atlas/compose.yaml",
    "projectDirectory": "/srv/atlas"
  },
  "availabilityPolicy": {
    "mode": "manual"
  }
}
```

The `composeFile` must be an absolute path and must be inside the configured
`projectDirectory` according to normalized lexical path comparison. Path
traversal using `..` is rejected. Control operations use `start`, `stop`, and
`restart` only; `up`, `down`, `build`, and `pull` are not supported. Compose
project-level status is aggregated from individual container states.

#### Compose project runtime state mapping

The aggregate project runtime state is calculated from its service states:

- All services running → `running`
- All services stopped → `stopped`
- Any dead service or non-zero exit → `failed`
- Mixed running/stopped → `unknown`

#### Compose intentional limitations

The Compose vertical slice does not claim:

- Compose `up`, `down`, `build`, `pull`
- service-level control inside a project
- scaling individual Compose services
- resource creation or deletion
- image management
- Docker contexts
- profile selection or profile discovery

Registered-service dependency orchestration is supported above the adapter
boundary. Compose profiles remain a future consideration only: they require a
concrete deployment use case, exact configuration ownership and validation,
fixed command construction, supported status/control/log/scheduling semantics,
a separate security review, and a dedicated Issue before implementation.

### Controlled service logs

The `readLogs` supported operation enables bounded log retrieval for registered
Docker containers and Docker Compose projects. The generic
`GetRegisteredServiceLogs` use case validates that `readLogs` is configured and
delegates to adapter-specific log readers.

Log retrieval is bounded by `tailLines` (1 to 500, default 100). Results are
returned as an immutable batch with separate `stdoutLines` and `stderrLines`,
plus a `truncated` indicator.

Log content is normalized: ANSI escape sequences and control characters are
removed, line lengths are capped, and total lines are bounded.

#### Log safety

Logs may contain application-generated sensitive content. The implementation:

- does not expose raw Docker stdout/stderr through public errors
- does not claim secret redaction
- does not write raw logs to application logs
- does not provide streaming or follow mode
- does not expose an HTTP log endpoint

#### Log intentional limitations

The log capability does not provide:

- streaming or follow mode
- HTTP delivery
- regex or search filtering
- guaranteed secret redaction
- historical log persistence
- service selection inside a Compose project

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

| Variable                                    | Default     | Purpose                                                      |
| ------------------------------------------- | ----------- | ------------------------------------------------------------ |
| `HOST`                                      | `127.0.0.1` | Address used by the HTTP listener                            |
| `PORT`                                      | `3000`      | TCP port used by the HTTP listener                           |
| `LOG_LEVEL`                                 | `info`      | Minimum structured logging level                             |
| `REGISTERED_SERVICES_JSON`                  | `[]`        | Deployment-owned service allowlist                           |
| `ADMINISTRATIVE_EVENT_HISTORY_HTTP_ENABLED` | `false`     | Explicitly enables the protected event-history route         |
| `ADMINISTRATIVE_EVENT_HISTORY_FILE`         | —           | Absolute persistent event-history file required when enabled |
| `ADMINISTRATIVE_ROLE_ASSIGNMENTS`           | —           | Strict JSON role assignments required when enabled           |

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

When the administrative event-history route is enabled, `HOST` must be exactly
`127.0.0.1`; IPv6, LAN, and public bindings are rejected. The Cloudflare Access
team and audience must be configured as a pair, and role assignments must use
canonical lowercase UUID subjects with one to four fixed roles. At least one
assignment must provide `event_history.read` through `auditor` or
`administrator`. The application does not create the event-history parent
directory while parsing configuration and does not fall back to in-memory
history for enabled HTTP delivery.

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

## v0.5 Milestone Readiness Audit

### Acceptance Matrix

The matrix maps the v0.5 contract to production boundaries and inspected test
assertions. `Evidence gap` means the implementation exists but Issue #216's
required focused assertion is not present; it is not silently treated as a
passing guarantee.

| Area                            | Contract or guarantee                                                                                                                                                                     | Primary implementation boundary                                                                                                                    | Test evidence                                                                                                                                                                                                                       | Result    | Notes or limitation                                                                                                  |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------- |
| Registered Docker configuration | `docker` adapter, registered-service identity, catalog-owned target, allowlisted operations, optional logs/dependencies/readiness, strict environment limits and sanitized startup errors | `src/service-management/domain/registered-service.ts`; `src/service-management/infrastructure/environment-registered-service-catalog.ts`           | `tests/service-management/domain/registered-service.test.ts`; `tests/service-management/infrastructure/environment-registered-service-catalog.test.ts`                                                                              | ✅ Tested | Dependency-free legacy entries remain valid.                                                                         |
| Docker status                   | Fixed inspect call, strict JSON parsing, runtime/health separation, running/stopped/failed/unknown mapping, infrastructure failures remain errors                                         | `src/service-management/infrastructure/docker-container-inspect-executor.ts`; `docker-inspect-output-parser.ts`; `docker-service-status-reader.ts` | `tests/service-management/infrastructure/docker-inspect-output-parser.test.ts`; `docker-service-status-reader.test.ts`; `node-docker-container-inspect-executor.test.ts`                                                            | ✅ Tested | Results expose generic registered-service status only.                                                               |
| Docker details                  | Controlled timestamps, uptime, image, health and validated resource fields; stopped resources unavailable; raw inspect/stats data excluded                                                | `src/service-management/infrastructure/docker-container-details-reader.ts`; `src/service-management/domain/docker-container-details.ts`            | `tests/service-management/infrastructure/docker-inspect-output-parser.test.ts`; `docker-stats-output-parser.test.ts`; `tests/service-management/domain/docker-container-details.test.ts`; `docker-container-resource-usage.test.ts` | ✅ Tested | No environment, labels, mounts, commands or daemon details.                                                          |
| Docker control                  | One fixed start/stop/restart call; configured target as one argument; no retry, substitution or compensation                                                                              | `src/service-management/infrastructure/docker-service-controller.ts`; `node-docker-container-control-executor.ts`                                  | `tests/service-management/infrastructure/docker-service-controller.test.ts`; `node-docker-container-control-executor.test.ts`                                                                                                       | ✅ Tested | Restart remains one Docker operation.                                                                                |
| Compose configuration           | Exact `composeFile`/`projectDirectory` shape, absolute contained POSIX paths, no filesystem or Docker work during parsing                                                                 | `src/service-management/domain/management-configuration.ts`; `environment-registered-service-catalog.ts`                                           | `tests/service-management/domain/management-configuration.test.ts`; `tests/service-management/infrastructure/environment-registered-service-catalog.test.ts`                                                                        | ✅ Tested | Compose project identity is configuration-owned.                                                                     |
| Compose status and details      | Fixed `compose ps` JSON, strict service summaries, aggregate runtime/health, immutable approved fields, malformed output rejection                                                        | `src/service-management/infrastructure/compose-status-parser.ts`; `compose-service-status-reader.ts`                                               | `tests/service-management/infrastructure/compose-status-parser.test.ts`; `compose-service-reader-controller.test.ts`; `tests/service-management/composition/compose-and-logs-vertical-slice.test.ts`                                | ✅ Tested | Raw Compose output, paths and container metadata are excluded.                                                       |
| Compose control                 | Whole-project start/stop/restart only; no `up`, `down`, build, pull, scaling, service selection or fallback                                                                               | `src/service-management/infrastructure/compose-service-controller.ts`; `node-docker-compose-executors.ts`                                          | `tests/service-management/infrastructure/node-docker-compose-executors.test.ts`; `compose-service-reader-controller.test.ts`                                                                                                        | ✅ Tested | Profiles are intentionally not implemented.                                                                          |
| Controlled logs                 | Explicit `readLogs`, bounded tail, normalized LF/CRLF/CR/ANSI/control output, immutable stdout/stderr batch and truncation                                                                | `src/service-management/application/get-registered-service-logs.ts`; `src/service-management/infrastructure/service-log-readers.ts`                | `tests/service-management/infrastructure/service-log-readers.test.ts`; `tests/service-management/application/get-registered-service-logs.test.ts`; `node-docker-compose-executors.test.ts`                                          | ✅ Tested | No follow/streaming/HTTP endpoint; arbitrary application secrets are not guaranteed redacted.                        |
| Executor safety                 | `docker`, `shell:false`, UTF-8, finite timeout and bounded buffer; separate fixed arguments; safe error mapping                                                                           | `src/service-management/infrastructure/node-docker-*.ts`; `node-docker-compose-executors.ts`                                                       | `tests/service-management/infrastructure/node-docker-compose-executors.test.ts`; `node-docker-container-control-executor.test.ts`; `node-docker-container-inspect-executor.test.ts`                                                 | ✅ Tested | No unrestricted command runner or socket API.                                                                        |
| Dispatching                     | Explicit mock/PM2/Docker/Compose status, control, log and readiness mappings; invalid adapters and missing implementations reject; no fallback                                            | `src/service-management/infrastructure/dispatching-service-*.ts`; `readiness-infrastructure.ts`; `service-log-readers.ts`                          | `tests/service-management/infrastructure/dispatching-service-status-reader.test.ts`; `dispatching-service-controller.test.ts`; `service-log-readers.test.ts`; `readiness-infrastructure.test.ts`                                    | ✅ Tested | Dispatchers snapshot only narrow supplied ports.                                                                     |
| Composition                     | Stable frozen capabilities, shared clock/catalog/graph, narrow seams, no commands/status/readiness/timers during construction                                                             | `src/service-management/composition/create-service-management.ts`                                                                                  | `tests/service-management/composition/create-service-management.test.ts`; `create-service-management-readiness.test.ts`; `compose-and-logs-vertical-slice.test.ts`                                                                  | ✅ Tested | Readiness timer is created only when waiting is invoked.                                                             |
| Dependency graph                | Optional canonical IDs, immutable graph, unknown/duplicate/self/cycle rejection, closures, deterministic topological and reverse order, shared-node deduplication                         | `src/service-management/domain/dependency-graph.ts`; `registered-service.ts`; `environment-registered-service-catalog.ts`                          | `tests/service-management/domain/registered-service.test.ts`; `tests/service-management/domain/dependency-graph.test.ts`; `tests/service-management/infrastructure/environment-registered-service-catalog.test.ts`                  | ✅ Tested | Invalid shapes, identifier boundaries, direct-dependency limit, disconnected cycles and input isolation are covered. |
| Readiness policy                | Optional runtime/health policy, defaults, bounded safe timeout/interval, typed validation categories, unknown-field rejection and adapter compatibility                                   | `src/service-management/domain/readiness-policy.ts`; `registered-service.ts`                                                                       | `tests/service-management/domain/readiness-policy.test.ts`; `tests/service-management/domain/registered-service.test.ts`; `tests/service-management/application/wait-for-registered-service-readiness.test.ts`                      | ✅ Tested | Exact boundary, numeric-type, non-finite and adapter-policy cases are covered.                                       |
| Readiness infrastructure        | Runtime, Docker health and Compose aggregate health mapping; injected clock; immutable results; infrastructure failures remain errors; no fallback                                        | `src/service-management/infrastructure/readiness-infrastructure.ts`                                                                                | `tests/service-management/infrastructure/readiness-infrastructure.test.ts`; `tests/service-management/infrastructure/compose-status-parser.test.ts`; Docker parser tests                                                            | ✅ Tested | Unknown Compose is documented as a domain-only empty aggregate; parser empty output rejects.                         |
| Readiness waiting               | Immediate success, controlled polling/deadline, typed timeout, no extra read/timer after success                                                                                          | `src/service-management/application/wait-for-registered-service-readiness.ts`                                                                      | `tests/service-management/application/wait-for-registered-service-readiness.test.ts`; `tests/service-management/composition/create-service-management-readiness.test.ts`                                                            | ✅ Tested | No real-time waiting in tests.                                                                                       |
| Start orchestration             | Transitive dependencies first, readiness before dependent, shared dependency once, deterministic immutable result                                                                         | `src/service-management/application/plan-registered-service-orchestration.ts`; `orchestrate-registered-service-control.ts`                         | `tests/service-management/application/plan-registered-service-orchestration.test.ts`; `orchestrate-registered-service-control.test.ts`; `tests/service-management/integration/dependency-aware-orchestration.test.ts`               | ✅ Tested | Sequential execution only.                                                                                           |
| Stop orchestration              | Transitive dependents first, stopped services skipped, no dependency starts, fail-fast                                                                                                    | Same orchestration boundaries                                                                                                                      | `orchestrate-registered-service-control.test.ts`; `dependency-aware-orchestration.test.ts`                                                                                                                                          | ✅ Tested | No automatic compensation.                                                                                           |
| Restart orchestration           | Active dependents stop, target restarts once, target readiness gates restoration, previously stopped dependents stay stopped                                                              | Same orchestration boundaries                                                                                                                      | `plan-registered-service-orchestration.test.ts`; `orchestrate-registered-service-control.test.ts`; `dependency-aware-orchestration.test.ts`                                                                                         | ✅ Tested | Dependencies remain running.                                                                                         |
| Orchestration failure contract  | Sequential, fail-fast, non-transactional; completed effects remain; no retry/rollback/compensation; safe IDs/results only                                                                 | `src/service-management/application/orchestrate-registered-service-control.ts`; `orchestration-plan.ts`                                            | `tests/service-management/application/orchestrate-registered-service-control.test.ts`; `dependency-aware-orchestration.test.ts`                                                                                                     | ✅ Tested | Partial effects are intentional and documented.                                                                      |
| Availability scheduling         | Existing always/scheduled/manual/disabled policies, overrides, dependency availability and readiness, deterministic graph ordering                                                        | `src/service-management/application/run-service-availability-reconciliation-tick.ts`; occurrence execution                                         | `tests/service-management/application/run-service-availability-reconciliation-tick.test.ts`; `tests/service-management/integration/dependency-aware-orchestration.test.ts`; `file-backed-docker-compose-scheduling.test.ts`         | ✅ Tested | One failed occurrence does not corrupt unrelated reports.                                                            |
| Occurrence claims               | Target claim before orchestration; child steps create no synthetic claims; duplicate target suppresses replay                                                                             | `src/service-management/application/execute-registered-service-availability-reconciliation-occurrence.ts`; claim store                             | `tests/service-management/application/execute-registered-service-availability-reconciliation-occurrence.test.ts`; `dependency-aware-orchestration.test.ts`; scheduler recovery integrations                                         | ✅ Tested | At-most-once-oriented, not globally exactly-once.                                                                    |
| File-backed reconstruction      | Fresh override/claim/cursor stores and fresh catalog/graph/composition reconstruct state; atomic files, pruning, cursor conflicts preserved                                               | `src/service-management/infrastructure/file-service-*.ts`; composition                                                                             | `tests/service-management/integration/dependency-aware-orchestration.test.ts`; file-backed scheduler recovery suite                                                                                                                 | ✅ Tested | No in-memory graph reuse or fallback after configured file failure.                                                  |
| Scheduler result model          | `idle`, `advanced`, `incomplete`, `conflict` and rejection behavior remain unchanged and immutable                                                                                        | `src/service-management/application/run-service-availability-reconciliation-scheduler-cycle.ts`                                                    | `tests/service-management/application/run-service-availability-reconciliation-scheduler-cycle.test.ts`; file-backed recovery suite                                                                                                  | ✅ Tested | Dependency/readiness failures use existing occurrence/reconciliation reports.                                        |
| Startup and lifecycle           | Invalid graph rejects before serving; construction performs no privileged operation; graceful scheduler/HTTP shutdown remains predictable                                                 | `src/main.ts`; `src/service-management/composition/create-service-management.ts`; lifecycle modules                                                | `tests/main.test.ts`; `tests/lifecycle/*.test.ts`; composition tests                                                                                                                                                                | ✅ Tested | No automatic Docker, Compose, PM2 or readiness operation at startup.                                                 |
| Test isolation                  | No Docker daemon, Compose project, PM2 process, network, production path or real readiness wait required                                                                                  | Test seams and controlled adapters                                                                                                                 | 105 test files; service-management integration suite uses mocks and test-owned temporary directories                                                                                                                                | ✅ Tested | Full suite ran without managed infrastructure.                                                                       |
| Security boundary               | Caller supplies IDs/bounded values; catalog owns targets; plans contain IDs/operations; adapters execute fixed no-shell commands                                                          | Configuration, catalog, orchestration and Node executors                                                                                           | Executor, parser, dispatcher, catalog, orchestration and log tests listed above                                                                                                                                                     | ✅ Tested | No arbitrary command, target, profile, probe, exec, up/down or public admin endpoint.                                |

### Milestone-readiness conclusion

**Outcome: Ready**

The focused dependency and readiness evidence now covers the validation
permutations identified by Issue #216. The complete regression suite passes,
no production defect was discovered, and no documented guarantee exceeds the
implementation or test evidence.

Validation on Node.js 24.18.0 completed with `npm ci`, format check, lint,
typecheck, 105 test files and 1,892 tests, build, diff check, and production
audit all passing. The production audit reported zero vulnerabilities; the
install command reported one development-tree advisory, which was not fixed or
changed in this test-only delivery.

Compose profiles have no accepted requirement or concrete deployment use case;
they remain outside v0.5 as a future consideration requiring a separate product
decision and Issue.

### Intentional limitations

V0.5 remains intentionally bounded: no unrestricted Docker administration,
Docker socket API, Compose resource creation, `up`, `down`, service-level
control, scaling, image pull/build, log streaming, guaranteed secret redaction,
runtime graph mutation, custom/HTTP/TCP readiness probes, parallel
orchestration, retry, rollback, compensation, cross-service transactions,
globally exactly-once execution, distributed coordination, multi-host Docker,
authentication, authorization, or public administrative Docker endpoint.

The scheduler claims the target occurrence before orchestration. If a later
dependency or target step fails, completed external effects remain committed;
reconstruction sees the duplicate target claim and does not replay the entire
orchestration automatically.

## Historical v0.4 Milestone Readiness Snapshots

The repeated v0.4 audit tables below are retained as historical records from
earlier delivery reviews. They are not the current project status and their
old test totals must not be used as v0.5 evidence. The canonical v0.5 audit
matrix and conclusion are recorded in the next section.

### Acceptance Matrix

| Area                                  | Contract/Guarantee                                  | Implementation Boundary                                                                                                      | Test Evidence                                                                                                        | Result    | Notes/Limitation                       |
| ------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------- | -------------------------------------- |
| **Registered-Service Configuration**  |                                                     |                                                                                                                              |                                                                                                                      |           |                                        |
| Service parsing                       | Canonical service identifiers, providers, schedules | `src/service-management/infrastructure/environment-registered-service-catalog.ts`                                            | `tests/service-management/infrastructure/environment-registered-service-catalog.test.ts`                             | ✅ Tested | Supports `mock` and `pm2` adapters     |
| Invalid config                        | Rejection of malformed configuration                | Same as above                                                                                                                | Same as above                                                                                                        | ✅ Tested | Empty string, invalid JSON rejected    |
| Deterministic listing                 | Consistent service enumeration                      | `src/service-management/application/list-registered-services.ts`                                                             | `tests/service-management/application/list-registered-services.test.ts`                                              | ✅ Tested | Catalog order preserved                |
| **Availability Scheduling**           |                                                     |                                                                                                                              |                                                                                                                      |           |                                        |
| Schedule parsing                      | Canonical weekly schedule with timezone             | `src/service-scheduling/domain/weekly-availability-schedule.ts`                                                              | `tests/service-scheduling/domain/weekly-availability-schedule.test.ts`                                               | ✅ Tested | Half-open `[start, end)` semantics     |
| Occurrence generation                 | Distinct canonical occurrences per interval         | `src/service-management/application/generate-registered-service-availability-reconciliation-occurrences.ts`                  | `tests/service-management/application/generate-registered-service-availability-reconciliation-occurrences.test.ts`   | ✅ Tested | No replay of earlier intervals         |
| Interval boundaries                   | `(fromExclusive, toInclusive]` semantics            | `src/service-scheduling/domain/service-availability-policy-transition-calculator.ts`                                         | `tests/service-scheduling/domain/service-availability-policy-transition-calculator.test.ts`                          | ✅ Tested | 8-day maximum per cycle                |
| **Availability Override Persistence** |                                                     |                                                                                                                              |                                                                                                                      |           |                                        |
| Override persistence                  | File-backed storage with atomic replacement         | `src/service-management/infrastructure/file-service-availability-override-store.ts`                                          | `tests/service-management/infrastructure/file-service-availability-override-store.test.ts`                           | ✅ Tested | Version-1 JSON schema                  |
| Override reconstruction               | Persisted state survives restart                    | Same as above                                                                                                                | Same as above                                                                                                        | ✅ Tested | Missing file = no overrides            |
| Conditional removal                   | Atomic compare-and-remove by value                  | Same as above                                                                                                                | Same as above                                                                                                        | ✅ Tested | Returns `removed` or `not_removed`     |
| Override pruning                      | Expired override removal                            | `src/service-management/application/prune-expired-registered-service-availability-overrides.ts`                              | `tests/service-management/application/prune-expired-registered-service-availability-overrides.test.ts`               | ✅ Tested | Per-service results                    |
| **Occurrence Execution**              |                                                     |                                                                                                                              |                                                                                                                      |           |                                        |
| Successful execution                  | Controlled service operation completes              | `src/service-management/application/execute-registered-service-availability-reconciliation-occurrence.ts`                    | `tests/service-management/application/execute-registered-service-availability-reconciliation-occurrence.test.ts`     | ✅ Tested | Returns `executed` result              |
| Failed execution                      | Operation failure after claim acquisition           | Same as above                                                                                                                | Same as above                                                                                                        | ✅ Tested | Returns `failed` result                |
| Duplicate detection                   | Existing claim prevents replay                      | Same as above                                                                                                                | Same as above                                                                                                        | ✅ Tested | Returns `duplicate` result             |
| **Occurrence Claim Persistence**      |                                                     |                                                                                                                              |                                                                                                                      |           |                                        |
| Claim acquisition                     | Atomic claim operation                              | `src/service-management/infrastructure/file-service-availability-reconciliation-occurrence-claim-store.ts`                   | `tests/service-management/infrastructure/file-service-availability-reconciliation-occurrence-claim-store.test.ts`    | ✅ Tested | Returns `claimed` or `duplicate`       |
| Claim reconstruction                  | Persisted claims survive restart                    | Same as above                                                                                                                | Same as above                                                                                                        | ✅ Tested | Ordered by scheduled instant           |
| Completed claim pruning               | Claims at/before cursor removed                     | `src/service-management/application/prune-completed-service-availability-reconciliation-occurrence-claims.ts`                | `tests/service-management/application/prune-completed-service-availability-reconciliation-occurrence-claims.test.ts` | ✅ Tested | Returns `pruned` or `unchanged`        |
| Claim protection                      | Claims after cursor preserved                       | Same as above                                                                                                                | Same as above                                                                                                        | ✅ Tested | Candidate cursor not used as boundary  |
| **Scheduler Cursor Persistence**      |                                                     |                                                                                                                              |                                                                                                                      |           |                                        |
| Initial cursor                        | `null` state represents empty                       | `src/service-management/infrastructure/file-service-availability-reconciliation-scheduler-cursor-store.ts`                   | `tests/service-management/infrastructure/file-service-availability-reconciliation-scheduler-cursor-store.test.ts`    | ✅ Tested | Missing file = empty state             |
| Cursor reconstruction                 | Persisted cursor survives restart                   | Same as above                                                                                                                | Same as above                                                                                                        | ✅ Tested | Version-1 JSON schema                  |
| Compare-and-set                       | Atomic cursor advancement                           | Same as above                                                                                                                | Same as above                                                                                                        | ✅ Tested | Returns `advanced` or `conflict`       |
| Stale conflict                        | Competing advancement wins                          | Same as above                                                                                                                | Same as above                                                                                                        | ✅ Tested | Returns `conflict` with current cursor |
| **Scheduler Results**                 |                                                     |                                                                                                                              |                                                                                                                      |           |                                        |
| Idle result                           | No work when cursor equals target                   | `src/service-management/application/run-service-availability-reconciliation-scheduler-cycle.ts`                              | `tests/service-management/application/run-service-availability-reconciliation-scheduler-cycle.test.ts`               | ✅ Tested | No maintenance executed                |
| Advanced result                       | Successful completion                               | Same as above                                                                                                                | Same as above                                                                                                        | ✅ Tested | Frozen result with all reports         |
| Incomplete result                     | Reconciliation or maintenance failure               | Same as above                                                                                                                | Same as above                                                                                                        | ✅ Tested | Cursor not advanced                    |
| Conflict result                       | Competing cursor wins race                          | Same as above                                                                                                                | Same as above                                                                                                        | ✅ Tested | Successful maintenance committed       |
| **Recovery Scenarios**                |                                                     |                                                                                                                              |                                                                                                                      |           |                                        |
| Incomplete reconciliation             | Failed occurrence after claim                       | `tests/service-management/integration/file-backed-service-availability-scheduler-incomplete-reconciliation-recovery.test.ts` | Integration test                                                                                                     | ✅ Tested | Duplicate protection prevents replay   |
| Override pruning failure              | Conditional removal fails                           | `tests/service-management/integration/file-backed-service-availability-scheduler-override-pruning-failure-recovery.test.ts`  | Integration test                                                                                                     | ✅ Tested | Claim pruning skipped                  |
| Claim pruning rejection               | Pruning operation rejects                           | `tests/service-management/integration/file-backed-service-availability-scheduler-claim-pruning-failure-recovery.test.ts`     | Integration test                                                                                                     | ✅ Tested | Cycle rejects, no result               |
| Cursor advancement rejection          | Cursor store rejects                                | `tests/service-management/integration/file-backed-post-advance-cursor-advancement-failure-recovery.test.ts`                  | Integration test                                                                                                     | ✅ Tested | Maintenance committed                  |
| Cursor conflict                       | Competing process wins                              | `tests/service-management/integration/file-backed-post-advance-cursor-conflict-recovery.test.ts`                             | Integration test                                                                                                     | ✅ Tested | Same-target = idle                     |
| Post-conflict continuation            | Later target continues                              | `tests/service-management/integration/file-backed-post-conflict-next-interval-continuation.test.ts`                          | Integration test                                                                                                     | ✅ Tested | Processes only next interval           |
| Post-conflict incomplete recovery     | Failed occurrence post-conflict                     | `tests/service-management/integration/file-backed-post-conflict-next-interval-incomplete-reconciliation-recovery.test.ts`    | Integration test                                                                                                     | ✅ Tested | Duplicate protection works             |
| Post-conflict override failure        | Override pruning fails post-conflict                | `tests/service-management/integration/file-backed-post-conflict-next-interval-override-pruning-failure-recovery.test.ts`     | Integration test                                                                                                     | ✅ Tested | Retry succeeds                         |
| Post-conflict claim failure           | Claim pruning rejects post-conflict                 | `tests/service-management/integration/file-backed-post-conflict-next-interval-claim-pruning-failure-recovery.test.ts`        | Integration test                                                                                                     | ✅ Tested | Retry succeeds                         |
| Post-conflict cursor rejection        | Cursor advancement rejects post-conflict            | `tests/service-management/integration/file-backed-post-conflict-next-interval-cursor-advancement-failure-recovery.test.ts`   | Integration test                                                                                                     | ✅ Tested | Retry succeeds                         |
| Post-conflict second conflict         | Two consecutive conflicts                           | `tests/service-management/integration/file-backed-post-conflict-next-interval-cursor-conflict-recovery.test.ts`              | Integration test                                                                                                     | ✅ Tested | Same-target = idle                     |
| Post-consecutive continuation         | Future progress after two conflicts                 | `tests/service-management/integration/file-backed-post-consecutive-conflict-next-interval-continuation.test.ts`              | Integration test                                                                                                     | ✅ Tested | Processes T3→T4                        |
| **Process-Style Reconstruction**      |                                                     |                                                                                                                              |                                                                                                                      |           |                                        |
| Store reconstruction                  | Fresh adapters from persisted files                 | All integration tests                                                                                                        | 19 integration tests                                                                                                 | ✅ Tested | No in-memory state reuse               |
| Composition reconstruction            | Fresh use cases and dependencies                    | All integration tests                                                                                                        | Same as above                                                                                                        | ✅ Tested | Complete process restart               |
| **Result Immutability**               |                                                     |                                                                                                                              |                                                                                                                      |           |                                        |
| Frozen results                        | `Object.isFrozen()` assertions                      | All integration tests                                                                                                        | Same as above                                                                                                        | ✅ Tested | All result kinds frozen                |
| **Error Preservation**                |                                                     |                                                                                                                              |                                                                                                                      |           |                                        |
| Exact error identity                  | `rejects.toBe(sentinelError)`                       | Claim pruning and cursor advancement rejection tests                                                                         | Integration tests                                                                                                    | ✅ Tested | No error wrapping                      |
| **Security and Isolation**            |                                                     |                                                                                                                              |                                                                                                                      |           |                                        |
| Temporary directories                 | Test-owned `mkdtemp()` cleanup                      | All integration tests                                                                                                        | Same as above                                                                                                        | ✅ Tested | No production paths                    |
| Controlled clocks                     | Injected `Clock` interface                          | All integration tests                                                                                                        | Same as above                                                                                                        | ✅ Tested | No real timers                         |
| No external effects                   | Mock/controlled dependencies                        | All integration tests                                                                                                        | Same as above                                                                                                        | ✅ Tested | No real PM2/shell/network              |

### Intentional Limitations

1. **At-most-once claim semantics**: Occurrence claims are persisted before service control. A crash after claim persistence but before control completion can suppress a later retry. This is at-most-once claiming, not exactly-once execution.

2. **No cross-store transactions**: The scheduler cycle is not one transaction spanning service effects, occurrence claims, availability overrides, completed claim cleanup, and scheduler cursor persistence. Successful earlier stages may remain committed when a later stage fails or conflicts.

3. **No distributed coordination**: File-backed stores provide no cross-process locking or distributed guarantees. Two adapter instances writing the same file may race. Deployments must retain one scheduler-owning process.

4. **No automatic replay**: After claim acquisition, if the controlled operation fails or becomes uncertain, reconstruction sees the duplicate claim and does not automatically replay the operation. This prevents duplicate effects but may leave an occurrence without a confirmed successful external result.

5. **No automatic compensation**: The scheduler does not provide automatic compensation for partial external effects. Failed operations may have left partial state in external systems.

### Milestone Readiness Conclusion

**Outcome: Ready**

**Evidence:**

- 81 test files, 1563 tests passing
- All acceptance matrix rows have concrete test evidence
- Full validation passes: format, lint, typecheck, test, build, audit
- No production defects discovered
- No unsupported guarantees in documentation
- All required behaviors represented by implemented tests

**Validation Results:**

```
npm run format:check  PASS
npm run lint          PASS
npm run typecheck     PASS
npm test              PASS — 81 files, 1563 tests
npm run build         PASS
git diff --check      PASS
npm audit --omit=dev  PASS — 0 vulnerabilities
```

The historical v0.4 snapshot reported that milestone ready at the time. This
text is retained for audit history; the current project conclusion is the v0.5
matrix above.

## Historical v0.4 Milestone Readiness Snapshot (continued)

### Acceptance Matrix

| Area                                  | Contract/Guarantee                                  | Implementation Boundary                                                                                                      | Test Evidence                                                                                                        | Result    | Notes/Limitation                       |
| ------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------- | -------------------------------------- |
| **Registered-Service Configuration**  |                                                     |                                                                                                                              |                                                                                                                      |           |                                        |
| Service parsing                       | Canonical service identifiers, providers, schedules | `src/service-management/infrastructure/environment-registered-service-catalog.ts`                                            | `tests/service-management/infrastructure/environment-registered-service-catalog.test.ts`                             | ✅ Tested | Supports `mock` and `pm2` adapters     |
| Invalid config                        | Rejection of malformed configuration                | Same as above                                                                                                                | Same as above                                                                                                        | ✅ Tested | Empty string, invalid JSON rejected    |
| Deterministic listing                 | Consistent service enumeration                      | `src/service-management/application/list-registered-services.ts`                                                             | `tests/service-management/application/list-registered-services.test.ts`                                              | ✅ Tested | Catalog order preserved                |
| **Availability Scheduling**           |                                                     |                                                                                                                              |                                                                                                                      |           |                                        |
| Schedule parsing                      | Canonical weekly schedule with timezone             | `src/service-scheduling/domain/weekly-availability-schedule.ts`                                                              | `tests/service-scheduling/domain/weekly-availability-schedule.test.ts`                                               | ✅ Tested | Half-open `[start, end)` semantics     |
| Occurrence generation                 | Distinct canonical occurrences per interval         | `src/service-management/application/generate-registered-service-availability-reconciliation-occurrences.ts`                  | `tests/service-management/application/generate-registered-service-availability-reconciliation-occurrences.test.ts`   | ✅ Tested | No replay of earlier intervals         |
| Interval boundaries                   | `(fromExclusive, toInclusive]` semantics            | `src/service-scheduling/domain/service-availability-policy-transition-calculator.ts`                                         | `tests/service-scheduling/domain/service-availability-policy-transition-calculator.test.ts`                          | ✅ Tested | 8-day maximum per cycle                |
| **Availability Override Persistence** |                                                     |                                                                                                                              |                                                                                                                      |           |                                        |
| Override persistence                  | File-backed storage with atomic replacement         | `src/service-management/infrastructure/file-service-availability-override-store.ts`                                          | `tests/service-management/infrastructure/file-service-availability-override-store.test.ts`                           | ✅ Tested | Version-1 JSON schema                  |
| Override reconstruction               | Persisted state survives restart                    | Same as above                                                                                                                | Same as above                                                                                                        | ✅ Tested | Missing file = no overrides            |
| Conditional removal                   | Atomic compare-and-remove by value                  | Same as above                                                                                                                | Same as above                                                                                                        | ✅ Tested | Returns `removed` or `not_removed`     |
| Override pruning                      | Expired override removal                            | `src/service-management/application/prune-expired-registered-service-availability-overrides.ts`                              | `tests/service-management/application/prune-expired-registered-service-availability-overrides.test.ts`               | ✅ Tested | Per-service results                    |
| **Occurrence Execution**              |                                                     |                                                                                                                              |                                                                                                                      |           |                                        |
| Successful execution                  | Controlled service operation completes              | `src/service-management/application/execute-registered-service-availability-reconciliation-occurrence.ts`                    | `tests/service-management/application/execute-registered-service-availability-reconciliation-occurrence.test.ts`     | ✅ Tested | Returns `executed` result              |
| Failed execution                      | Operation failure after claim acquisition           | Same as above                                                                                                                | Same as above                                                                                                        | ✅ Tested | Returns `failed` result                |
| Duplicate detection                   | Existing claim prevents replay                      | Same as above                                                                                                                | Same as above                                                                                                        | ✅ Tested | Returns `duplicate` result             |
| **Occurrence Claim Persistence**      |                                                     |                                                                                                                              |                                                                                                                      |           |                                        |
| Claim acquisition                     | Atomic claim operation                              | `src/service-management/infrastructure/file-service-availability-reconciliation-occurrence-claim-store.ts`                   | `tests/service-management/infrastructure/file-service-availability-reconciliation-occurrence-claim-store.test.ts`    | ✅ Tested | Returns `claimed` or `duplicate`       |
| Claim reconstruction                  | Persisted claims survive restart                    | Same as above                                                                                                                | Same as above                                                                                                        | ✅ Tested | Ordered by scheduled instant           |
| Completed claim pruning               | Claims at/before cursor removed                     | `src/service-management/application/prune-completed-service-availability-reconciliation-occurrence-claims.ts`                | `tests/service-management/application/prune-completed-service-availability-reconciliation-occurrence-claims.test.ts` | ✅ Tested | Returns `pruned` or `unchanged`        |
| Claim protection                      | Claims after cursor preserved                       | Same as above                                                                                                                | Same as above                                                                                                        | ✅ Tested | Candidate cursor not used as boundary  |
| **Scheduler Cursor Persistence**      |                                                     |                                                                                                                              |                                                                                                                      |           |                                        |
| Initial cursor                        | `null` state represents empty                       | `src/service-management/infrastructure/file-service-availability-reconciliation-scheduler-cursor-store.ts`                   | `tests/service-management/infrastructure/file-service-availability-reconciliation-scheduler-cursor-store.test.ts`    | ✅ Tested | Missing file = empty state             |
| Cursor reconstruction                 | Persisted cursor survives restart                   | Same as above                                                                                                                | Same as above                                                                                                        | ✅ Tested | Version-1 JSON schema                  |
| Compare-and-set                       | Atomic cursor advancement                           | Same as above                                                                                                                | Same as above                                                                                                        | ✅ Tested | Returns `advanced` or `conflict`       |
| Stale conflict                        | Competing advancement wins                          | Same as above                                                                                                                | Same as above                                                                                                        | ✅ Tested | Returns `conflict` with current cursor |
| **Scheduler Results**                 |                                                     |                                                                                                                              |                                                                                                                      |           |                                        |
| Idle result                           | No work when cursor equals target                   | `src/service-management/application/run-service-availability-reconciliation-scheduler-cycle.ts`                              | `tests/service-management/application/run-service-availability-reconciliation-scheduler-cycle.test.ts`               | ✅ Tested | No maintenance executed                |
| Advanced result                       | Successful completion                               | Same as above                                                                                                                | Same as above                                                                                                        | ✅ Tested | Frozen result with all reports         |
| Incomplete result                     | Reconciliation or maintenance failure               | Same as above                                                                                                                | Same as above                                                                                                        | ✅ Tested | Cursor not advanced                    |
| Conflict result                       | Competing cursor wins race                          | Same as above                                                                                                                | Same as above                                                                                                        | ✅ Tested | Successful maintenance committed       |
| **Recovery Scenarios**                |                                                     |                                                                                                                              |                                                                                                                      |           |                                        |
| Incomplete reconciliation             | Failed occurrence after claim                       | `tests/service-management/integration/file-backed-service-availability-scheduler-incomplete-reconciliation-recovery.test.ts` | Integration test                                                                                                     | ✅ Tested | Duplicate protection prevents replay   |
| Override pruning failure              | Conditional removal fails                           | `tests/service-management/integration/file-backed-service-availability-scheduler-override-pruning-failure-recovery.test.ts`  | Integration test                                                                                                     | ✅ Tested | Claim pruning skipped                  |
| Claim pruning rejection               | Pruning operation rejects                           | `tests/service-management/integration/file-backed-service-availability-scheduler-claim-pruning-failure-recovery.test.ts`     | Integration test                                                                                                     | ✅ Tested | Cycle rejects, no result               |
| Cursor advancement rejection          | Cursor store rejects                                | `tests/service-management/integration/file-backed-post-advance-cursor-advancement-failure-recovery.test.ts`                  | Integration test                                                                                                     | ✅ Tested | Maintenance committed                  |
| Cursor conflict                       | Competing process wins                              | `tests/service-management/integration/file-backed-post-advance-cursor-conflict-recovery.test.ts`                             | Integration test                                                                                                     | ✅ Tested | Same-target = idle                     |
| Post-conflict continuation            | Later target continues                              | `tests/service-management/integration/file-backed-post-conflict-next-interval-continuation.test.ts`                          | Integration test                                                                                                     | ✅ Tested | Processes only next interval           |
| Post-conflict incomplete recovery     | Failed occurrence post-conflict                     | `tests/service-management/integration/file-backed-post-conflict-next-interval-incomplete-reconciliation-recovery.test.ts`    | Integration test                                                                                                     | ✅ Tested | Duplicate protection works             |
| Post-conflict override failure        | Override pruning fails post-conflict                | `tests/service-management/integration/file-backed-post-conflict-next-interval-override-pruning-failure-recovery.test.ts`     | Integration test                                                                                                     | ✅ Tested | Retry succeeds                         |
| Post-conflict claim failure           | Claim pruning rejects post-conflict                 | `tests/service-management/integration/file-backed-post-conflict-next-interval-claim-pruning-failure-recovery.test.ts`        | Integration test                                                                                                     | ✅ Tested | Retry succeeds                         |
| Post-conflict cursor rejection        | Cursor advancement rejects post-conflict            | `tests/service-management/integration/file-backed-post-conflict-next-interval-cursor-advancement-failure-recovery.test.ts`   | Integration test                                                                                                     | ✅ Tested | Retry succeeds                         |
| Post-conflict second conflict         | Two consecutive conflicts                           | `tests/service-management/integration/file-backed-post-conflict-next-interval-cursor-conflict-recovery.test.ts`              | Integration test                                                                                                     | ✅ Tested | Same-target = idle                     |
| Post-consecutive continuation         | Future progress after two conflicts                 | `tests/service-management/integration/file-backed-post-consecutive-conflict-next-interval-continuation.test.ts`              | Integration test                                                                                                     | ✅ Tested | Processes T3→T4                        |
| **Process-Style Reconstruction**      |                                                     |                                                                                                                              |                                                                                                                      |           |                                        |
| Store reconstruction                  | Fresh adapters from persisted files                 | All integration tests                                                                                                        | 19 integration tests                                                                                                 | ✅ Tested | No in-memory state reuse               |
| Composition reconstruction            | Fresh use cases and dependencies                    | All integration tests                                                                                                        | Same as above                                                                                                        | ✅ Tested | Complete process restart               |
| **Result Immutability**               |                                                     |                                                                                                                              |                                                                                                                      |           |                                        |
| Frozen results                        | `Object.isFrozen()` assertions                      | All integration tests                                                                                                        | Same as above                                                                                                        | ✅ Tested | All result kinds frozen                |
| **Error Preservation**                |                                                     |                                                                                                                              |                                                                                                                      |           |                                        |
| Exact error identity                  | `rejects.toBe(sentinelError)`                       | Claim pruning and cursor advancement rejection tests                                                                         | Integration tests                                                                                                    | ✅ Tested | No error wrapping                      |
| **Security and Isolation**            |                                                     |                                                                                                                              |                                                                                                                      |           |                                        |
| Temporary directories                 | Test-owned `mkdtemp()` cleanup                      | All integration tests                                                                                                        | Same as above                                                                                                        | ✅ Tested | No production paths                    |
| Controlled clocks                     | Injected `Clock` interface                          | All integration tests                                                                                                        | Same as above                                                                                                        | ✅ Tested | No real timers                         |
| No external effects                   | Mock/controlled dependencies                        | All integration tests                                                                                                        | Same as above                                                                                                        | ✅ Tested | No real PM2/shell/network              |

### Intentional Limitations

1. **At-most-once claim semantics**: Occurrence claims are persisted before service control. A crash after claim persistence but before control completion can suppress a later retry. This is at-most-once claiming, not exactly-once execution.

2. **No cross-store transactions**: The scheduler cycle is not one transaction spanning service effects, occurrence claims, availability overrides, completed claim cleanup, and scheduler cursor persistence. Successful earlier stages may remain committed when a later stage fails or conflicts.

3. **No distributed coordination**: File-backed stores provide no cross-process locking or distributed guarantees. Two adapter instances writing the same file may race. Deployments must retain one scheduler-owning process.

4. **No automatic replay**: After claim acquisition, if the controlled operation fails or becomes uncertain, reconstruction sees the duplicate claim and does not automatically replay the operation. This prevents duplicate effects but may leave an occurrence without a confirmed successful external result.

5. **No automatic compensation**: The scheduler does not provide automatic compensation for partial external effects. Failed operations may have left partial state in external systems.

### Milestone Readiness Conclusion

**Outcome: Ready**

**Evidence:**

- 81 test files, 1563 tests passing
- All acceptance matrix rows have concrete test evidence
- Full validation passes: format, lint, typecheck, test, build, audit
- No production defects discovered
- No unsupported guarantees in documentation
- All required behaviors represented by implemented tests

**Validation Results:**

```
npm run format:check  PASS
npm run lint          PASS
npm run typecheck     PASS
npm test              PASS — 81 files, 1563 tests
npm run build         PASS
git diff --check      PASS
npm audit --omit=dev  PASS — 0 vulnerabilities
```

The historical v0.4 snapshot reported that milestone ready at the time. This
text is retained for audit history; the current project conclusion is the v0.5
matrix above.

## Historical v0.4 Milestone Readiness Snapshot (continued)

### Acceptance Matrix

| Area                                  | Contract/Guarantee                                  | Implementation Boundary                                                                                                      | Test Evidence                                                                                                        | Result    | Notes/Limitation                       |
| ------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------- | -------------------------------------- |
| **Registered-Service Configuration**  |                                                     |                                                                                                                              |                                                                                                                      |           |                                        |
| Service parsing                       | Canonical service identifiers, providers, schedules | `src/service-management/infrastructure/environment-registered-service-catalog.ts`                                            | `tests/service-management/infrastructure/environment-registered-service-catalog.test.ts`                             | ✅ Tested | Supports `mock` and `pm2` adapters     |
| Invalid config                        | Rejection of malformed configuration                | Same as above                                                                                                                | Same as above                                                                                                        | ✅ Tested | Empty string, invalid JSON rejected    |
| Deterministic listing                 | Consistent service enumeration                      | `src/service-management/application/list-registered-services.ts`                                                             | `tests/service-management/application/list-registered-services.test.ts`                                              | ✅ Tested | Catalog order preserved                |
| **Availability Scheduling**           |                                                     |                                                                                                                              |                                                                                                                      |           |                                        |
| Schedule parsing                      | Canonical weekly schedule with timezone             | `src/service-scheduling/domain/weekly-availability-schedule.ts`                                                              | `tests/service-scheduling/domain/weekly-availability-schedule.test.ts`                                               | ✅ Tested | Half-open `[start, end)` semantics     |
| Occurrence generation                 | Distinct canonical occurrences per interval         | `src/service-management/application/generate-registered-service-availability-reconciliation-occurrences.ts`                  | `tests/service-management/application/generate-registered-service-availability-reconciliation-occurrences.test.ts`   | ✅ Tested | No replay of earlier intervals         |
| Interval boundaries                   | `(fromExclusive, toInclusive]` semantics            | `src/service-scheduling/domain/service-availability-policy-transition-calculator.ts`                                         | `tests/service-scheduling/domain/service-availability-policy-transition-calculator.test.ts`                          | ✅ Tested | 8-day maximum per cycle                |
| **Availability Override Persistence** |                                                     |                                                                                                                              |                                                                                                                      |           |                                        |
| Override persistence                  | File-backed storage with atomic replacement         | `src/service-management/infrastructure/file-service-availability-override-store.ts`                                          | `tests/service-management/infrastructure/file-service-availability-override-store.test.ts`                           | ✅ Tested | Version-1 JSON schema                  |
| Override reconstruction               | Persisted state survives restart                    | Same as above                                                                                                                | Same as above                                                                                                        | ✅ Tested | Missing file = no overrides            |
| Conditional removal                   | Atomic compare-and-remove by value                  | Same as above                                                                                                                | Same as above                                                                                                        | ✅ Tested | Returns `removed` or `not_removed`     |
| Override pruning                      | Expired override removal                            | `src/service-management/application/prune-expired-registered-service-availability-overrides.ts`                              | `tests/service-management/application/prune-expired-registered-service-availability-overrides.test.ts`               | ✅ Tested | Per-service results                    |
| **Occurrence Execution**              |                                                     |                                                                                                                              |                                                                                                                      |           |                                        |
| Successful execution                  | Controlled service operation completes              | `src/service-management/application/execute-registered-service-availability-reconciliation-occurrence.ts`                    | `tests/service-management/application/execute-registered-service-availability-reconciliation-occurrence.test.ts`     | ✅ Tested | Returns `executed` result              |
| Failed execution                      | Operation failure after claim acquisition           | Same as above                                                                                                                | Same as above                                                                                                        | ✅ Tested | Returns `failed` result                |
| Duplicate detection                   | Existing claim prevents replay                      | Same as above                                                                                                                | Same as above                                                                                                        | ✅ Tested | Returns `duplicate` result             |
| **Occurrence Claim Persistence**      |                                                     |                                                                                                                              |                                                                                                                      |           |                                        |
| Claim acquisition                     | Atomic claim operation                              | `src/service-management/infrastructure/file-service-availability-reconciliation-occurrence-claim-store.ts`                   | `tests/service-management/infrastructure/file-service-availability-reconciliation-occurrence-claim-store.test.ts`    | ✅ Tested | Returns `claimed` or `duplicate`       |
| Claim reconstruction                  | Persisted claims survive restart                    | Same as above                                                                                                                | Same as above                                                                                                        | ✅ Tested | Ordered by scheduled instant           |
| Completed claim pruning               | Claims at/before cursor removed                     | `src/service-management/application/prune-completed-service-availability-reconciliation-occurrence-claims.ts`                | `tests/service-management/application/prune-completed-service-availability-reconciliation-occurrence-claims.test.ts` | ✅ Tested | Returns `pruned` or `unchanged`        |
| Claim protection                      | Claims after cursor preserved                       | Same as above                                                                                                                | Same as above                                                                                                        | ✅ Tested | Candidate cursor not used as boundary  |
| **Scheduler Cursor Persistence**      |                                                     |                                                                                                                              |                                                                                                                      |           |                                        |
| Initial cursor                        | `null` state represents empty                       | `src/service-management/infrastructure/file-service-availability-reconciliation-scheduler-cursor-store.ts`                   | `tests/service-management/infrastructure/file-service-availability-reconciliation-scheduler-cursor-store.test.ts`    | ✅ Tested | Missing file = empty state             |
| Cursor reconstruction                 | Persisted cursor survives restart                   | Same as above                                                                                                                | Same as above                                                                                                        | ✅ Tested | Version-1 JSON schema                  |
| Compare-and-set                       | Atomic cursor advancement                           | Same as above                                                                                                                | Same as above                                                                                                        | ✅ Tested | Returns `advanced` or `conflict`       |
| Stale conflict                        | Competing advancement wins                          | Same as above                                                                                                                | Same as above                                                                                                        | ✅ Tested | Returns `conflict` with current cursor |
| **Scheduler Results**                 |                                                     |                                                                                                                              |                                                                                                                      |           |                                        |
| Idle result                           | No work when cursor equals target                   | `src/service-management/application/run-service-availability-reconciliation-scheduler-cycle.ts`                              | `tests/service-management/application/run-service-availability-reconciliation-scheduler-cycle.test.ts`               | ✅ Tested | No maintenance executed                |
| Advanced result                       | Successful completion                               | Same as above                                                                                                                | Same as above                                                                                                        | ✅ Tested | Frozen result with all reports         |
| Incomplete result                     | Reconciliation or maintenance failure               | Same as above                                                                                                                | Same as above                                                                                                        | ✅ Tested | Cursor not advanced                    |
| Conflict result                       | Competing cursor wins race                          | Same as above                                                                                                                | Same as above                                                                                                        | ✅ Tested | Successful maintenance committed       |
| **Recovery Scenarios**                |                                                     |                                                                                                                              |                                                                                                                      |           |                                        |
| Incomplete reconciliation             | Failed occurrence after claim                       | `tests/service-management/integration/file-backed-service-availability-scheduler-incomplete-reconciliation-recovery.test.ts` | Integration test                                                                                                     | ✅ Tested | Duplicate protection prevents replay   |
| Override pruning failure              | Conditional removal fails                           | `tests/service-management/integration/file-backed-service-availability-scheduler-override-pruning-failure-recovery.test.ts`  | Integration test                                                                                                     | ✅ Tested | Claim pruning skipped                  |
| Claim pruning rejection               | Pruning operation rejects                           | `tests/service-management/integration/file-backed-service-availability-scheduler-claim-pruning-failure-recovery.test.ts`     | Integration test                                                                                                     | ✅ Tested | Cycle rejects, no result               |
| Cursor advancement rejection          | Cursor store rejects                                | `tests/service-management/integration/file-backed-post-advance-cursor-advancement-failure-recovery.test.ts`                  | Integration test                                                                                                     | ✅ Tested | Maintenance committed                  |
| Cursor conflict                       | Competing process wins                              | `tests/service-management/integration/file-backed-post-advance-cursor-conflict-recovery.test.ts`                             | Integration test                                                                                                     | ✅ Tested | Same-target = idle                     |
| Post-conflict continuation            | Later target continues                              | `tests/service-management/integration/file-backed-post-conflict-next-interval-continuation.test.ts`                          | Integration test                                                                                                     | ✅ Tested | Processes only next interval           |
| Post-conflict incomplete recovery     | Failed occurrence post-conflict                     | `tests/service-management/integration/file-backed-post-conflict-next-interval-incomplete-reconciliation-recovery.test.ts`    | Integration test                                                                                                     | ✅ Tested | Duplicate protection works             |
| Post-conflict override failure        | Override pruning fails post-conflict                | `tests/service-management/integration/file-backed-post-conflict-next-interval-override-pruning-failure-recovery.test.ts`     | Integration test                                                                                                     | ✅ Tested | Retry succeeds                         |
| Post-conflict claim failure           | Claim pruning rejects post-conflict                 | `tests/service-management/integration/file-backed-post-conflict-next-interval-claim-pruning-failure-recovery.test.ts`        | Integration test                                                                                                     | ✅ Tested | Retry succeeds                         |
| Post-conflict cursor rejection        | Cursor advancement rejects post-conflict            | `tests/service-management/integration/file-backed-post-conflict-next-interval-cursor-advancement-failure-recovery.test.ts`   | Integration test                                                                                                     | ✅ Tested | Retry succeeds                         |
| Post-conflict second conflict         | Two consecutive conflicts                           | `tests/service-management/integration/file-backed-post-conflict-next-interval-cursor-conflict-recovery.test.ts`              | Integration test                                                                                                     | ✅ Tested | Same-target = idle                     |
| Post-consecutive continuation         | Future progress after two conflicts                 | `tests/service-management/integration/file-backed-post-consecutive-conflict-next-interval-continuation.test.ts`              | Integration test                                                                                                     | ✅ Tested | Processes T3→T4                        |
| **Process-Style Reconstruction**      |                                                     |                                                                                                                              |                                                                                                                      |           |                                        |
| Store reconstruction                  | Fresh adapters from persisted files                 | All integration tests                                                                                                        | 19 integration tests                                                                                                 | ✅ Tested | No in-memory state reuse               |
| Composition reconstruction            | Fresh use cases and dependencies                    | All integration tests                                                                                                        | Same as above                                                                                                        | ✅ Tested | Complete process restart               |
| **Result Immutability**               |                                                     |                                                                                                                              |                                                                                                                      |           |                                        |
| Frozen results                        | `Object.isFrozen()` assertions                      | All integration tests                                                                                                        | Same as above                                                                                                        | ✅ Tested | All result kinds frozen                |
| **Error Preservation**                |                                                     |                                                                                                                              |                                                                                                                      |           |                                        |
| Exact error identity                  | `rejects.toBe(sentinelError)`                       | Claim pruning and cursor advancement rejection tests                                                                         | Integration tests                                                                                                    | ✅ Tested | No error wrapping                      |
| **Security and Isolation**            |                                                     |                                                                                                                              |                                                                                                                      |           |                                        |
| Temporary directories                 | Test-owned `mkdtemp()` cleanup                      | All integration tests                                                                                                        | Same as above                                                                                                        | ✅ Tested | No production paths                    |
| Controlled clocks                     | Injected `Clock` interface                          | All integration tests                                                                                                        | Same as above                                                                                                        | ✅ Tested | No real timers                         |
| No external effects                   | Mock/controlled dependencies                        | All integration tests                                                                                                        | Same as above                                                                                                        | ✅ Tested | No real PM2/shell/network              |

### Intentional Limitations

1. **At-most-once claim semantics**: Occurrence claims are persisted before service control. A crash after claim persistence but before control completion can suppress a later retry. This is at-most-once claiming, not exactly-once execution.

2. **No cross-store transactions**: The scheduler cycle is not one transaction spanning service effects, occurrence claims, availability overrides, completed claim cleanup, and scheduler cursor persistence. Successful earlier stages may remain committed when a later stage fails or conflicts.

3. **No distributed coordination**: File-backed stores provide no cross-process locking or distributed guarantees. Two adapter instances writing the same file may race. Deployments must retain one scheduler-owning process.

4. **No automatic replay**: After claim acquisition, if the controlled operation fails or becomes uncertain, reconstruction sees the duplicate claim and does not automatically replay the operation. This prevents duplicate effects but may leave an occurrence without a confirmed successful external result.

5. **No automatic compensation**: The scheduler does not provide automatic compensation for partial external effects. Failed operations may have left partial state in external systems.

### Milestone Readiness Conclusion

**Outcome: Ready**

**Evidence:**

- 81 test files, 1563 tests passing
- All acceptance matrix rows have concrete test evidence
- Full validation passes: format, lint, typecheck, test, build, audit
- No production defects discovered
- No unsupported guarantees in documentation
- All required behaviors represented by implemented tests

**Validation Results:**

```
npm run format:check  PASS
npm run lint          PASS
npm run typecheck     PASS
npm test              PASS — 81 files, 1563 tests
npm run build         PASS
git diff --check      PASS
npm audit --omit=dev  PASS — 0 vulnerabilities
```

The historical v0.4 snapshot reported that milestone ready at the time. This
text is retained for audit history; the current project conclusion is the v0.5
matrix above.

## Historical v0.4 Milestone Readiness Snapshot (continued)

### Acceptance Matrix

| Area                                  | Contract/Guarantee                                  | Implementation Boundary                                                                                                      | Test Evidence                                                                                                        | Result    | Notes/Limitation                       |
| ------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------- | -------------------------------------- |
| **Registered-Service Configuration**  |                                                     |                                                                                                                              |                                                                                                                      |           |                                        |
| Service parsing                       | Canonical service identifiers, providers, schedules | `src/service-management/infrastructure/environment-registered-service-catalog.ts`                                            | `tests/service-management/infrastructure/environment-registered-service-catalog.test.ts`                             | ✅ Tested | Supports `mock` and `pm2` adapters     |
| Invalid config                        | Rejection of malformed configuration                | Same as above                                                                                                                | Same as above                                                                                                        | ✅ Tested | Empty string, invalid JSON rejected    |
| Deterministic listing                 | Consistent service enumeration                      | `src/service-management/application/list-registered-services.ts`                                                             | `tests/service-management/application/list-registered-services.test.ts`                                              | ✅ Tested | Catalog order preserved                |
| **Availability Scheduling**           |                                                     |                                                                                                                              |                                                                                                                      |           |                                        |
| Schedule parsing                      | Canonical weekly schedule with timezone             | `src/service-scheduling/domain/weekly-availability-schedule.ts`                                                              | `tests/service-scheduling/domain/weekly-availability-schedule.test.ts`                                               | ✅ Tested | Half-open `[start, end)` semantics     |
| Occurrence generation                 | Distinct canonical occurrences per interval         | `src/service-management/application/generate-registered-service-availability-reconciliation-occurrences.ts`                  | `tests/service-management/application/generate-registered-service-availability-reconciliation-occurrences.test.ts`   | ✅ Tested | No replay of earlier intervals         |
| Interval boundaries                   | `(fromExclusive, toInclusive]` semantics            | `src/service-scheduling/domain/service-availability-policy-transition-calculator.ts`                                         | `tests/service-scheduling/domain/service-availability-policy-transition-calculator.test.ts`                          | ✅ Tested | 8-day maximum per cycle                |
| **Availability Override Persistence** |                                                     |                                                                                                                              |                                                                                                                      |           |                                        |
| Override persistence                  | File-backed storage with atomic replacement         | `src/service-management/infrastructure/file-service-availability-override-store.ts`                                          | `tests/service-management/infrastructure/file-service-availability-override-store.test.ts`                           | ✅ Tested | Version-1 JSON schema                  |
| Override reconstruction               | Persisted state survives restart                    | Same as above                                                                                                                | Same as above                                                                                                        | ✅ Tested | Missing file = no overrides            |
| Conditional removal                   | Atomic compare-and-remove by value                  | Same as above                                                                                                                | Same as above                                                                                                        | ✅ Tested | Returns `removed` or `not_removed`     |
| Override pruning                      | Expired override removal                            | `src/service-management/application/prune-expired-registered-service-availability-overrides.ts`                              | `tests/service-management/application/prune-expired-registered-service-availability-overrides.test.ts`               | ✅ Tested | Per-service results                    |
| **Occurrence Execution**              |                                                     |                                                                                                                              |                                                                                                                      |           |                                        |
| Successful execution                  | Controlled service operation completes              | `src/service-management/application/execute-registered-service-availability-reconciliation-occurrence.ts`                    | `tests/service-management/application/execute-registered-service-availability-reconciliation-occurrence.test.ts`     | ✅ Tested | Returns `executed` result              |
| Failed execution                      | Operation failure after claim acquisition           | Same as above                                                                                                                | Same as above                                                                                                        | ✅ Tested | Returns `failed` result                |
| Duplicate detection                   | Existing claim prevents replay                      | Same as above                                                                                                                | Same as above                                                                                                        | ✅ Tested | Returns `duplicate` result             |
| **Occurrence Claim Persistence**      |                                                     |                                                                                                                              |                                                                                                                      |           |                                        |
| Claim acquisition                     | Atomic claim operation                              | `src/service-management/infrastructure/file-service-availability-reconciliation-occurrence-claim-store.ts`                   | `tests/service-management/infrastructure/file-service-availability-reconciliation-occurrence-claim-store.test.ts`    | ✅ Tested | Returns `claimed` or `duplicate`       |
| Claim reconstruction                  | Persisted claims survive restart                    | Same as above                                                                                                                | Same as above                                                                                                        | ✅ Tested | Ordered by scheduled instant           |
| Completed claim pruning               | Claims at/before cursor removed                     | `src/service-management/application/prune-completed-service-availability-reconciliation-occurrence-claims.ts`                | `tests/service-management/application/prune-completed-service-availability-reconciliation-occurrence-claims.test.ts` | ✅ Tested | Returns `pruned` or `unchanged`        |
| Claim protection                      | Claims after cursor preserved                       | Same as above                                                                                                                | Same as above                                                                                                        | ✅ Tested | Candidate cursor not used as boundary  |
| **Scheduler Cursor Persistence**      |                                                     |                                                                                                                              |                                                                                                                      |           |                                        |
| Initial cursor                        | `null` state represents empty                       | `src/service-management/infrastructure/file-service-availability-reconciliation-scheduler-cursor-store.ts`                   | `tests/service-management/infrastructure/file-service-availability-reconciliation-scheduler-cursor-store.test.ts`    | ✅ Tested | Missing file = empty state             |
| Cursor reconstruction                 | Persisted cursor survives restart                   | Same as above                                                                                                                | Same as above                                                                                                        | ✅ Tested | Version-1 JSON schema                  |
| Compare-and-set                       | Atomic cursor advancement                           | Same as above                                                                                                                | Same as above                                                                                                        | ✅ Tested | Returns `advanced` or `conflict`       |
| Stale conflict                        | Competing advancement wins                          | Same as above                                                                                                                | Same as above                                                                                                        | ✅ Tested | Returns `conflict` with current cursor |
| **Scheduler Results**                 |                                                     |                                                                                                                              |                                                                                                                      |           |                                        |
| Idle result                           | No work when cursor equals target                   | `src/service-management/application/run-service-availability-reconciliation-scheduler-cycle.ts`                              | `tests/service-management/application/run-service-availability-reconciliation-scheduler-cycle.test.ts`               | ✅ Tested | No maintenance executed                |
| Advanced result                       | Successful completion                               | Same as above                                                                                                                | Same as above                                                                                                        | ✅ Tested | Frozen result with all reports         |
| Incomplete result                     | Reconciliation or maintenance failure               | Same as above                                                                                                                | Same as above                                                                                                        | ✅ Tested | Cursor not advanced                    |
| Conflict result                       | Competing cursor wins race                          | Same as above                                                                                                                | Same as above                                                                                                        | ✅ Tested | Successful maintenance committed       |
| **Recovery Scenarios**                |                                                     |                                                                                                                              |                                                                                                                      |           |                                        |
| Incomplete reconciliation             | Failed occurrence after claim                       | `tests/service-management/integration/file-backed-service-availability-scheduler-incomplete-reconciliation-recovery.test.ts` | Integration test                                                                                                     | ✅ Tested | Duplicate protection prevents replay   |
| Override pruning failure              | Conditional removal fails                           | `tests/service-management/integration/file-backed-service-availability-scheduler-override-pruning-failure-recovery.test.ts`  | Integration test                                                                                                     | ✅ Tested | Claim pruning skipped                  |
| Claim pruning rejection               | Pruning operation rejects                           | `tests/service-management/integration/file-backed-service-availability-scheduler-claim-pruning-failure-recovery.test.ts`     | Integration test                                                                                                     | ✅ Tested | Cycle rejects, no result               |
| Cursor advancement rejection          | Cursor store rejects                                | `tests/service-management/integration/file-backed-post-advance-cursor-advancement-failure-recovery.test.ts`                  | Integration test                                                                                                     | ✅ Tested | Maintenance committed                  |
| Cursor conflict                       | Competing process wins                              | `tests/service-management/integration/file-backed-post-advance-cursor-conflict-recovery.test.ts`                             | Integration test                                                                                                     | ✅ Tested | Same-target = idle                     |
| Post-conflict continuation            | Later target continues                              | `tests/service-management/integration/file-backed-post-conflict-next-interval-continuation.test.ts`                          | Integration test                                                                                                     | ✅ Tested | Processes only next interval           |
| Post-conflict incomplete recovery     | Failed occurrence post-conflict                     | `tests/service-management/integration/file-backed-post-conflict-next-interval-incomplete-reconciliation-recovery.test.ts`    | Integration test                                                                                                     | ✅ Tested | Duplicate protection works             |
| Post-conflict override failure        | Override pruning fails post-conflict                | `tests/service-management/integration/file-backed-post-conflict-next-interval-override-pruning-failure-recovery.test.ts`     | Integration test                                                                                                     | ✅ Tested | Retry succeeds                         |
| Post-conflict claim failure           | Claim pruning rejects post-conflict                 | `tests/service-management/integration/file-backed-post-conflict-next-interval-claim-pruning-failure-recovery.test.ts`        | Integration test                                                                                                     | ✅ Tested | Retry succeeds                         |
| Post-conflict cursor rejection        | Cursor advancement rejects post-conflict            | `tests/service-management/integration/file-backed-post-conflict-next-interval-cursor-advancement-failure-recovery.test.ts`   | Integration test                                                                                                     | ✅ Tested | Retry succeeds                         |
| Post-conflict second conflict         | Two consecutive conflicts                           | `tests/service-management/integration/file-backed-post-conflict-next-interval-cursor-conflict-recovery.test.ts`              | Integration test                                                                                                     | ✅ Tested | Same-target = idle                     |
| Post-consecutive continuation         | Future progress after two conflicts                 | `tests/service-management/integration/file-backed-post-consecutive-conflict-next-interval-continuation.test.ts`              | Integration test                                                                                                     | ✅ Tested | Processes T3→T4                        |
| **Process-Style Reconstruction**      |                                                     |                                                                                                                              |                                                                                                                      |           |                                        |
| Store reconstruction                  | Fresh adapters from persisted files                 | All integration tests                                                                                                        | 19 integration tests                                                                                                 | ✅ Tested | No in-memory state reuse               |
| Composition reconstruction            | Fresh use cases and dependencies                    | All integration tests                                                                                                        | Same as above                                                                                                        | ✅ Tested | Complete process restart               |
| **Result Immutability**               |                                                     |                                                                                                                              |                                                                                                                      |           |                                        |
| Frozen results                        | `Object.isFrozen()` assertions                      | All integration tests                                                                                                        | Same as above                                                                                                        | ✅ Tested | All result kinds frozen                |
| **Error Preservation**                |                                                     |                                                                                                                              |                                                                                                                      |           |                                        |
| Exact error identity                  | `rejects.toBe(sentinelError)`                       | Claim pruning and cursor advancement rejection tests                                                                         | Integration tests                                                                                                    | ✅ Tested | No error wrapping                      |
| **Security and Isolation**            |                                                     |                                                                                                                              |                                                                                                                      |           |                                        |
| Temporary directories                 | Test-owned `mkdtemp()` cleanup                      | All integration tests                                                                                                        | Same as above                                                                                                        | ✅ Tested | No production paths                    |
| Controlled clocks                     | Injected `Clock` interface                          | All integration tests                                                                                                        | Same as above                                                                                                        | ✅ Tested | No real timers                         |
| No external effects                   | Mock/controlled dependencies                        | All integration tests                                                                                                        | Same as above                                                                                                        | ✅ Tested | No real PM2/shell/network              |

### Intentional Limitations

1. **At-most-once claim semantics**: Occurrence claims are persisted before service control. A crash after claim persistence but before control completion can suppress a later retry. This is at-most-once claiming, not exactly-once execution.

2. **No cross-store transactions**: The scheduler cycle is not one transaction spanning service effects, occurrence claims, availability overrides, completed claim cleanup, and scheduler cursor persistence. Successful earlier stages may remain committed when a later stage fails or conflicts.

3. **No distributed coordination**: File-backed stores provide no cross-process locking or distributed guarantees. Two adapter instances writing the same file may race. Deployments must retain one scheduler-owning process.

4. **No automatic replay**: After claim acquisition, if the controlled operation fails or becomes uncertain, reconstruction sees the duplicate claim and does not automatically replay the operation. This prevents duplicate effects but may leave an occurrence without a confirmed successful external result.

5. **No automatic compensation**: The scheduler does not provide automatic compensation for partial external effects. Failed operations may have left partial state in external systems.

### Milestone Readiness Conclusion

**Outcome: Ready**

**Evidence:**

- 81 test files, 1563 tests passing
- All acceptance matrix rows have concrete test evidence
- Full validation passes: format, lint, typecheck, test, build, audit
- No production defects discovered
- No unsupported guarantees in documentation
- All required behaviors represented by implemented tests

**Validation Results:**

```
npm run format:check  PASS
npm run lint          PASS
npm run typecheck     PASS
npm test              PASS — 81 files, 1563 tests
npm run build         PASS
git diff --check      PASS
npm audit --omit=dev  PASS — 0 vulnerabilities
```

The historical v0.4 snapshot reported that milestone ready at the time. This
text is retained for audit history; the current project conclusion is the v0.5
matrix above.

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

## Dependency-aware service orchestration

Registered services may declare dependencies using only canonical registered
service IDs:

```json
{
  "id": "atlas-api",
  "dependencies": ["atlas-postgres", "atlas-redis"],
  "readinessPolicy": {
    "mode": "health",
    "timeoutMilliseconds": 30000,
    "pollIntervalMilliseconds": 500
  }
}
```

The catalog validates unknown targets, duplicate edges, self-dependencies,
cycles, direct-dependency limits, and readiness policy bounds before startup.
The resulting immutable graph uses deterministic topological ordering: starts
run dependencies first and stops run dependents first. Shared dependencies are
processed once.

Readiness defaults to runtime mode, where only `running` is ready. Docker
containers and Docker Compose projects may opt into health mode; Docker health
must be `healthy` and Compose aggregate health must be `healthy`. `starting`,
`unhealthy`, `mixed`, `unknown`, and `not_configured` remain not ready. Waiting
uses bounded timeout and poll intervals with an injected application clock and
timer in tests.

Restart stops active dependents, restarts the target once, confirms target
readiness, and restores only dependents stopped by that orchestration. A
dependent that was already stopped remains stopped. Manual orchestration and
scheduled orchestration share dependency ordering; scheduled starts additionally
block when a dependency's effective availability is unavailable.

Availability occurrences are claimed for the scheduled target before
orchestration. Child dependency steps create no claims. Consequently, a
process reconstructed after a partial orchestration sees the target claim as a
duplicate and does not automatically replay the dependency sequence. Earlier
effects remain committed; there is no automatic retry, rollback, compensation,
or transaction across services.

Dependency configuration cannot supply Docker targets, Compose service names,
paths, commands, shell probes, HTTP endpoints, TCP probes, or custom scripts.
The implementation intentionally does not discover dependencies from Compose
files or labels, start services in parallel, mutate the graph at runtime, or
provide a new HTTP endpoint.

### Mock safe-shutdown preparation

Before a due machine shutdown occurrence is claimed, Atlas can explicitly run
a mock preparation pipeline for supported blockers. Running registered
services are stopped in dependent-first order, active tasks can be drained,
an in-progress backup can be completed, and required filesystem synchronization
can be represented as complete. These operations use narrow mock boundaries;
they do not stop real services, cancel real tasks, run backups, or invoke the
operating-system `sync` command.

The canonical preparation order is recording the start, stopping services,
draining tasks, completing the backup, synchronizing the filesystem, recording
completion, reevaluating readiness, and recording final readiness. Only steps
required by the initial blockers are included. Events use sequence numbers
starting at one for each explicit attempt.

Preparation records immutable, sequence-numbered in-memory events. A partial
failure preserves completed effects and leaves the occurrence unclaimed, so a
later explicit attempt can observe idempotent states such as
`already_stopped`, `already_drained`, `not_running`, and
`already_synchronized`. There is no rollback, compensation, or automatic
retry.

Non-preparable blockers, including service schedule conflicts, failed or
unknown service state, unknown readiness, and missing confirmation, fail closed
without preparation effects. When preparation mutates state, final readiness
uses a fresh explicit confirmation and the readiness evaluator remains
authoritative. Only final approval allows the existing claim, mock wake-alarm,
and simulated-shutdown chain to continue.

The preparation capability is explicitly invoked and has no timer, background
worker, scheduler loop, persistence journal, real RTC effect, real shutdown,
or administrative event history.

### Secure Linux power-helper foundation

The reviewed application-side Linux boundary uses protocol version `1` and the
fixed helper executable `/usr/local/libexec/atlas-manager-power-helper`. It
supports only RTC information, wake-alarm read/schedule/cancel, and shutdown
request operations. Requests and responses are immutable, strictly validated,
canonical JSON objects; unknown fields, operations, versions, timestamps,
states, transitions, and failure codes are rejected.

Before each helper execution, Atlas checks that the platform is Linux and that
the fixed helper is a root-owned regular executable with safe file and
`/usr/local/libexec` permissions. The transport uses no shell, no arguments,
working directory `/`, only `LANG=C` and `LC_ALL=C`, a fixed five-second
timeout, and bounded stdout/stderr. Same-instance operations are sequential and
transport or helper failures become focused project-owned errors without paths,
commands, output, environment values, exit details, or helper text.

The helper-backed RTC, wake-alarm, and shutdown adapters share one frozen
transport bundle and can be selected only through the exact
`POWER_MANAGEMENT_BACKEND=linux_helper` configuration value. The default is
`mock`; composition performs no helper inspection or process work. Selecting
the Linux helper is atomic for all four power adapters and has no fallback to
mock behavior. The helper remains uninstalled and no real effect is enabled
until the separate installation, enrollment, host-qualification, HTTP, and
real-effect gates are completed. A helper shutdown result is `accepted`, not
`completed`; the mock result remains `simulated`.

### Cloudflare Access identity verification

ADR-004 adds a production-shaped, but not yet HTTP-exposed, authentication
adapter for Cloudflare Access application JWTs. HTTP delivery reads only the
case-insensitive `Cf-Access-Jwt-Assertion` header and passes one bounded,
request-scoped assertion to the access-control provider. The application
verifies an RS256 signature against the fixed team JWKS endpoint and requires
the configured issuer, audience, `type: app`, temporal claims, and a canonical
lowercase UUID subject. Empty subjects reject Cloudflare service tokens.

Signing keys are fetched with a fixed five-second timeout and 64 KiB response
bound, cached in memory for ten minutes, refreshed once for an unknown key ID,
and protected by a thirty-second failed-fetch cooldown. Missing configuration
keeps the existing deny-all authenticator and performs no network request.
Tokens, claims, emails, headers, and keys are never logged, persisted, or
returned in authentication results. No shutdown route, cookie fallback, session,
production helper activation, or real power effect is included.

### External Linux power-helper executable foundation

ADR-005 adds the standalone Go source and build support for the fixed helper
executable. The intended operator-controlled installation is the root-owned,
dedicated-group, setuid file `/usr/local/libexec/atlas-manager-power-helper`
with mode `04750`; the application user must belong to the file's dedicated
group. The application remains unprivileged, and no repository command or CI
step runs `sudo`, `chown`, `chmod 4750`, or `setcap`.

The helper is a pinned, `CGO_ENABLED=0` standard-library Go executable. It
accepts exactly one bounded version-one JSON request with no arguments and
returns one canonical response. Every currently valid operation is rejected
with `operation_unsupported`. It performs no filesystem, device, process,
shell, network, RTC, wake, or shutdown effect. Invalid input and startup
failures produce safe fixed exit codes and no diagnostics on stderr.

The helper is not installed and does not enable real power. ADR-011 now
provides a production-shaped composition gate, disabled by default; future
deployment, enrollment, and real-effect activation still require separate
reviewed Issues.

### Systemd-logind shutdown backend

ADR-008 adds the final version-one helper source backend for
`request_shutdown`. It validates the root-owned fixed Unix socket
`/run/dbus/system_bus_socket`, opens one private connection with EXTERNAL
authentication, performs `Hello`, and calls exactly
`org.freedesktop.login1.Manager.PowerOff(false)`. The call has a fixed
three-second deadline, respects logind inhibitors, and never uses a shell,
child process, syscall, fallback, or retry.

`accepted: true` means only that logind returned a successful method reply; it
does not prove that the host has already powered off. Connection loss or a
deadline after transmission is treated as uncertain internally and maps to the
existing safe `operation_failed` response. The helper remains uninstalled and
unsetuid; Atlas Manager remains mock-first unless the exact composition
selector is explicitly chosen, and no HTTP or scheduler activation is implied.

### Host qualification and disabled installation

Issue #256 adds the separate
`atlas-manager-power-helper-host-qualification` executable. It supports only
`qualify`, `verify-disabled-installation`, and `verify-removed`, requires
effective root, and remains read-only. It inspects fixed Linux, RTC, group,
installation-parent, runtime-lock, and system-bus resources and emits a
bounded canonical report. It never installs or executes the helper, changes
RTC state, calls `PowerOff`, modifies groups, or activates Atlas Manager.
Firmware wake behavior, application-user enrollment, and production wiring
remain separate gates.

### Production-shaped helper composition

ADR-011 adds an explicit, fail-closed composition selector. The only accepted
values are `mock` and `linux_helper`, with `mock` as the default. The selected
backend is frozen once during startup; HTTP input, helper discovery,
environment-selected paths, and runtime switching cannot change it. HTTP
route flags and the machine-power scheduler remain independent. The Atlas
host has not been drilled, the helper has not been installed or executed, and
Atlas Manager remains mock-first by default.

### Configured machine operating policy

ADR-012 adds the strict startup variable
`MACHINE_OPERATING_POLICY`. It defaults to `{"mode":"always_on"}` and also
accepts `manual` or a scheduled weekly policy using only
`America/Sao_Paulo`. The JSON is bounded, duplicate-key checked, validated by
the existing immutable policy domain, and parsed once into `EnvironmentConfig`.
Invalid explicit input fails startup without falling back to always-on.

Policy selection is independent from `POWER_MANAGEMENT_BACKEND`, HTTP route
flags, and scheduler lifecycle. A scheduled policy affects only planning and
explicitly invoked scheduler ticks; no scheduler loop, helper request, RTC
operation, D-Bus request, wake mutation, or shutdown is started by parsing or
composition.

### Policy-bound scheduler confirmation

ADR-013 adds a narrow confirmation authority for explicitly invoked scheduler
ticks. It confirms only an exact shutdown occurrence regenerated from the
immutable configured policy. `always_on` and `manual` never authorize automatic
shutdown occurrences. Due, stale, readiness, preparation, claim, wake, and
shutdown checks remain separate and authoritative.

Direct and administrative shutdown execution retain their own confirmation
contracts. The scheduler supplies its policy-bound reader, scheduler audit
source, and explicit automatic-preparation option through `executeAt`; there
is no weaker `execute` fallback. No scheduler loop, timer, helper request, or
real power effect is added.

### Disabled machine-power scheduler lifecycle

ADR-014 adds an automatic machine-power scheduler lifecycle behind the exact
`MACHINE_POWER_SCHEDULER_ENABLED=true` setting. It is disabled by default and
requires persistent cursor, occurrence-claim, and event-history files. The
first tick starts only after HTTP listening, then uses a fixed one-shot
60-second cadence without overlap. Blocked, incomplete, conflict, and failed
outcomes terminate the application fail-closed without retry.

The scheduler shares the configured power and event-history capability bundles
with administrative surfaces but does not enable HTTP routes, select the Linux
helper, or start because a scheduled policy exists. No Atlas or VM drill was
performed and no helper, RTC, D-Bus, wake, reboot, or shutdown effect occurred.

### Linux power-effects admission

Linux power effects remain disabled by default. Selecting
POWER_MANAGEMENT_BACKEND=linux_helper does not by itself activate an
effect-capable route or scheduler. When an effect-capable surface is enabled,
startup additionally requires the exact
MACHINE_POWER_EFFECTS_ACTIVATION=linux_helper value, the confirmation
MACHINE_POWER_EFFECTS_CONFIRMATION=confirm_linux_helper_power_effects, and
one reviewed lowercase helper SHA-256 in
LINUX_POWER_HELPER_EXPECTED_SHA256.

Admission performs one read-only preflight of the fixed installed helper. It
checks the reviewed ownership, mode, setuid, group membership, safe parents,
link count, and installed-file hash before HTTP listening or scheduler
startup. The preflight never executes the helper and never repairs or enrolls
users. Failure is fail-closed with no fallback to mock. Installation,
physical-host qualification, application-user enrollment, and real-effect
certification remain deployment gates.

### Exact Linux runtime identity

ADR-016 adds a second read-only admission check for Linux power effects. The
process must already run as the dedicated `atlas-manager` account, with
primary group `atlas-manager`, home `/var/lib/atlas-manager`, shell
`/usr/sbin/nologin`, and supplementary membership in
`atlas-manager-power`. Numeric IDs remain host-assigned but must resolve
uniquely from the fixed, root-owned `/etc/passwd` and `/etc/group` files.

The helper file's group ownership is bound to the exact admitted
`atlas-manager-power` GID at startup and at each helper-backed operation.
Root, another account, duplicate or unsafe account records, missing
membership, and helper ownership by another group fail closed. Disabled,
mock, and inert Linux configurations do not inspect account files and do not
require these accounts. Account creation, group enrollment, deployment, and
host qualification remain operator-controlled deferred gates.

### Reproducible disabled deployment bundle

Issue #270 adds a separate Linux amd64 deployment module that builds an
isolated application bundle with production-only dependencies, a strict
manifest, SHA-256 inventory, and normalized archive metadata. The bundle
contains a disabled systemd unit, a safe environment template, and the
operator-run `atlas-manager-installer`.

The installer uses fixed production paths and exact `atlas-manager` runtime
identity settings. It supports only bundle inspection, disabled installation,
verification, file-level rollback, and disabled uninstall. It never creates
users or groups, enrolls `atlas-manager-power`, reads the real configuration,
calls npm or systemd, starts the service, installs the power helper, or
activates Linux effects. The actual environment, application state, helper
installation, host qualification, and service enablement remain separate
operator-controlled gates.

### Read-only deployment host qualification

Issue #272 adds `atlas-manager-host-qualification` to the deployment bundle.
It supports only `qualify`, `verify-prepared`,
`verify-disabled-installation`, and `verify-removed`. The executable requires
effective root in production, inspects only fixed resources, emits one bounded
canonical JSON report, and never creates a lock or changes host state.

Completely absent runtime identities produce `preparation_required`; partial
or conflicting identities block. Prepared-host, disabled-installation, and
removed-state checks remain separate from account creation, installation,
systemd enablement/startup, helper installation, power-helper qualification,
and real-effect certification. No physical host or VM qualification was run.

### Operator-controlled runtime identity preparation

Issue #274 adds `atlas-manager-runtime-identity-installer` to the deployment
bundle. It accepts only `inspect`, `prepare-disabled`, and `verify-managed`.
The preparation action requires the exact anti-accident confirmation and a
completely absent identity state, then creates only the fixed
`atlas-manager` user, primary group, and empty `atlas-manager-power` group.

The transaction writes private managed evidence and a synchronized journal,
verifies every account transition, and rolls back only resources created by
the current failed attempt. It never creates the home directory, changes
textual group membership, installs Atlas or the helper, creates configuration,
enables or starts systemd, or performs a power operation. Committed identities
have no public removal action; physical preparation remains deferred.

### Deterministic disabled deployment rehearsal

Issue #276 adds sandbox-only Go test infrastructure that builds two valid
deterministic bundles and reuses the production qualification,
identity-preparation, installer, upgrade, rollback, uninstall, and verification
packages against one synthetic Linux amd64 host. Fake account commands and
injected Node.js and systemd observations keep the rehearsal independent from
the real host.

Filesystem snapshots, mutation allowlists, bounded canonical step digests, and
a deterministic evidence chain prove that each transition changes only its
reviewed boundary. The rehearsal never reads or mutates real account databases
or production paths, calls systemd, executes Atlas Manager or the power helper,
accesses RTC or D-Bus, enables or starts a service, or performs a physical-host
or VM drill. The packaged mock-only application smoke test remains separate.

### Mock-only production activation readiness

Issue #278 adds the first reversible service-activation profile. The fixed
runtime configuration binds Atlas Manager to loopback, the mock power backend,
disabled power effects and scheduler, an always-on policy, an empty service
catalog, and disabled administrative routes. Separate operator-run tools
install/remove that configuration and activate/deactivate only the reviewed
systemd unit. Activation verifies loopback health, route absence, and the exact
`atlas-manager` identity; it never installs or executes the power helper.

Automated activation coverage is sandbox-only. It uses fake account/systemd
boundaries, emits bounded canonical evidence, and does not touch real systemd,
account databases, production paths, RTC, D-Bus, a host, or a VM.

### Mock-only administrative control plane and dashboard

Issue #280 adds the first product-facing administrative surface. Protected
registered-service, availability, overview, and event-history APIs use
Cloudflare Access plus local role authorization, persistent audit, strict
confirmations, and trusted catalog identifiers. The same-origin dashboard is
loopback-only, uses a closed static asset inventory, and renders values safely.

The managed administrative profile enables those read/control surfaces while
keeping wake and shutdown routes disabled, the power backend at `mock`, power
effects disabled, the machine-power scheduler disabled, and the Linux helper
unused. Automated control-plane rehearsal is synthetic and does not contact
Cloudflare, Docker, Compose, PM2, systemd, or a physical host.
