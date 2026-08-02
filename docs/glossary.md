# Atlas Manager — Project Glossary

### Power-helper installation bundle

A deterministic Linux amd64 archive containing the exact helper executable,
operator installer, strict manifest, checksums, license texts, and installation
runbook. It is a distribution artifact, not an activation mechanism.

### Operator-controlled installation

An explicit root-only action performed by a local administrator after bundle,
host, and group checks. Atlas Manager and npm never perform it.

### Empty power-helper group

The required local `atlas-manager-power` group with no members. Issue #254
requires it to exist before installation and deliberately does not enroll the
application user.

### Managed helper installation

The fixed root-owned helper path plus its exact hash and protected installation
state record. Unmanaged or unsafe files are never automatically adopted.

### Reproducible bundle

An artifact whose executable inputs, manifest, archive ordering, ownership,
modes, timestamps, and gzip metadata are deterministic for the same source
commit, package version, and `SOURCE_DATE_EPOCH`.

## Document purpose

This glossary defines the main terms used in Atlas Manager documentation and
future implementation.

Its purpose is to provide a shared vocabulary for developers, contributors,
and coding agents.

The glossary clarifies existing product and architectural concepts. It does not
introduce new requirements.

When a definition conflicts with a formal requirement or Architecture Decision
Record, the following sources take precedence:

1. accepted Architecture Decision Records;
2. `docs/requirements.md`;
3. `docs/architecture.md`;
4. this glossary.

Not every term described here currently corresponds to an implemented class,
module, endpoint, or database entity.

## Event-history terms

### Administrative event

An immutable project-owned record of one state-changing administrative or
automated operation. Version one stores a contiguous sequence, generated audit
attempt ID, timestamp, trusted source, Atlas machine target, operation, status,
and a strict safe detail shape.

### Administrative event history

The bounded append-only collection of administrative events. It is distinct
from diagnostic logs and preparation progress events and can use either the
default in-memory store or explicitly configured file-backed JSON Lines.

### Audit attempt

The application-owned context shared by the `started` and terminal events of
one top-level operation. Its canonical lowercase UUID is generated internally;
callers cannot provide it.

### Event sequence

The positive, contiguous number assigned by an event store. It is the
authoritative ordering when timestamps are equal, and callers cannot choose it.

### Event source

The trusted classification of an operation origin. The first version supports
administrative/unattributed-local, automated/machine-power-scheduler, and
system/atlas-manager. It is selected internally rather than from external
input.

### Event target

The strict resource addressed by an event. Version one accepts only the Atlas
machine target `machine/atlas`.

### Terminal event

The single `succeeded`, `rejected`, or `failed` event recorded after a top-level
operation returns a result or encounters a safe failure.

### Append-only event store

An event-history implementation that assigns the next sequence and appends a
complete canonical event without rewriting, deleting, rotating, or repairing
previous entries.

### Event-history readiness

A fail-closed check that confirms the shared event-history boundary can be
read and used for recording. It performs no repair or file creation.

### Unattributed administrative source

The current direct-operation source `administrative/unattributed-local`. It
does not represent authenticated identity, authorization, session, or remote
actor verification.

### Administrative principal

The immutable project-owned identity established by authentication. The current
model contains only a canonical lowercase UUID and contains no credentials,
tokens, sessions, claims, or caller-controlled metadata.

### Authentication provider

A narrow application port that establishes an administrative principal or
returns a safe unauthenticated/unavailable result. It receives no raw password,
header, cookie, token, or other credential value.

### Authentication result

The immutable result of administrative authentication: `authenticated`,
`unauthenticated`, or `unavailable` with one safe reason category.

### Administrative role

One of the fixed project-owned roles `power_operator`, `scheduler_operator`,
`auditor`, or `administrator`.

### Administrative permission

One explicit allowlisted capability such as `power.wake.schedule` or
`event_history.read`. Wildcards and generic permission strings are not valid.

### Authorization decision

An immutable application result stating whether one authenticated principal may
perform one explicit operation, including the mapped permission and safe deny
reason when applicable.

### Protected administrative operation

An application facade that authenticates, authorizes, audits the decision, and
only then invokes one approved capability. It does not accept caller-selected
roles, permissions, or actor identifiers.

### Verified audit actor

The internally constructed actor `administrator:<canonical-principal-uuid>`.
It is propagated only after successful authentication and authorization.

### Deny-by-default authentication

A security posture in which missing or unavailable identity evidence does not
create a local administrator; the default authenticator rejects the request.

### Authorization audit event

An administrative event recording one requested operation, its fixed
permission, an allowed or denied decision, and a safe reason code only when
denied. It is recorded before the protected target operation.

### Partial-effect audit failure

A safe error returned when an operation effect completed but its terminal
administrative event could not be recorded. The effect remains applied and is
not retried, rolled back, or compensated.

## Product terms

### Atlas

The physical homelab server on which Atlas Manager and other managed resources
are expected to run.

Atlas is currently a Linux-based mini PC used for hosting applications,
containers, infrastructure services, and automation.

### Atlas Manager

The self-hosted application responsible for monitoring, managing, and
automating approved resources on Atlas.

Atlas Manager is also an educational software-engineering project.

### Administrative API

The HTTP interface through which approved administrative operations and
information will be exposed.

The administrative API is not a remote shell and must never accept arbitrary
commands for execution.

### Administrative dashboard

The planned graphical interface that will consume the administrative API.

The dashboard is a client of Atlas Manager and must not bypass application,
authorization, validation, or security rules.

### Protected administrative HTTP route

An explicitly activated HTTP delivery boundary that authenticates the request,
authorizes one existing application capability, records the authorization
decision, and maps the result into a safe HTTP response. The first route is the
read-only `GET /admin/event-history` endpoint.

### Route activation gate

The strict deployment configuration that controls whether a protected
administrative route is registered. The event-history route is disabled by
default and requires loopback binding, Cloudflare Access configuration,
persistent event history, and trusted read-capable role assignments.

### Administrative event-history endpoint

The bounded cursor-paginated `GET /admin/event-history` query. It uses the
existing event-history query model and shared persistent store; it is not a
power-operation endpoint.

### Global process-local limiter

A fixed in-memory admission control shared by all requests to the initial
administrative route. It allows 60 admitted requests per 60-second window and
does not use identity, client IP, forwarded headers, timers, or distributed
coordination.

### Administrative request concurrency limit

The fixed maximum of four concurrently admitted event-history requests. A
fifth request is rejected immediately rather than queued, and every admitted
request releases its slot in a `finally` path.

### Authorization-audited read

An event-history query whose authorization decision is recorded in the same
event-history instance before the target query runs. The new authorization
event may therefore appear in the returned page.

### Loopback-only administrative origin

The initial deployment boundary in which protected administrative HTTP is
enabled only when `HOST` is exactly `127.0.0.1`. Proxy forwarding and client IP
values are not trusted by the application.

### Protected shutdown workflow

The two-stage administrative process exposed by the preparation and execution
routes. Preparation can perform dependency-aware service cleanup but cannot
claim or execute an occurrence. Execution requires a fresh stage-specific
confirmation and readiness evaluation before persistent claim, wake scheduling,
and simulated shutdown.

### Stage-specific shutdown confirmation

The immutable request-owned value `confirm_shutdown_preparation` or
`confirm_shutdown_execution`. The literals are not credentials, are not stored,
and are never inferred from authentication, roles, local access, or previous
requests.

### Persistent occurrence claim

The file-backed, permanent record that prevents the same shutdown occurrence
from repeating wake or shutdown effects after replay or process restart. A
claim is not automatically released after a later failure.

### Fresh execution readiness

The readiness evaluation performed by each execution request after its own
authorization event. Preparation from an earlier request does not replace this
evaluation, and execution never performs automatic preparation.

### Administrative power-operation gate

The process-local fail-fast gate allowing one active wake or shutdown mutation.
It does not queue requests and does not authenticate or audit rejected busy
requests.

### Managed resource

A resource known to Atlas Manager and eligible for approved monitoring or
control operations.

A managed resource may represent:

- a PM2 process;
- a Docker container;
- a Docker Compose application;
- a systemd unit;
- a backup target;
- another explicitly supported infrastructure resource.

A resource must not become manageable merely because its name was received
through an HTTP request.

### Registered service

A managed resource represented in the Atlas Manager service catalog.

A registered service has a stable project-defined identity and may include
metadata such as:

- display name;
- management adapter;
- external resource identifier;
- supported operations;
- health-check configuration;
- dependencies;
- availability mode;
- schedule configuration.

The term does not refer exclusively to a systemd service.

### Service

A general product term for a registered capability or application managed by
Atlas Manager.

Depending on its configured adapter, a service may correspond to a Docker
container, PM2 process, systemd unit, or another approved resource.

When referring specifically to systemd, use the term `systemd unit` instead of
the generic word `service`.

### Service catalog

The controlled collection of services known to Atlas Manager.

The service catalog prevents external clients from supplying arbitrary process
names, container names, commands, or filesystem paths.

### Service identifier

A stable project-defined value used to identify a registered service.

A service identifier is different from an external process name, container
name, systemd unit name, or database-generated identifier.

External clients should interact with service identifiers rather than raw
infrastructure identifiers.

### External resource identifier

The infrastructure-specific identifier used by an adapter to locate a managed
resource.

Examples include:

- a Docker container name;
- a PM2 process name;
- a systemd unit name.

External resource identifiers belong to configuration or infrastructure
boundaries and should not be accepted as unrestricted user input.

## Architecture terms

### Feature-first modular monolith

The architectural style selected for Atlas Manager.

The application is deployed as a single system while its source code is
organized primarily around product capabilities with explicit module
boundaries.

Feature-first organization does not mean every feature must duplicate every
architectural layer.

### Delivery layer

The architectural area responsible for receiving external input and
translating application results into an external representation.

The initial delivery mechanism is an Express HTTP API.

Delivery-layer responsibilities include:

- routes;
- controllers;
- request validation;
- HTTP status codes;
- response mapping.

Business and infrastructure logic do not belong in this layer.

### Application layer

The architectural area responsible for use cases, workflows, orchestration,
and application policies.

The application layer coordinates domain rules and external capabilities
through ports.

### Domain layer

The architectural area containing business concepts and rules that do not
depend on frameworks or infrastructure implementations.

Domain code should use plain TypeScript and remain independently testable.

Not every feature requires a complex domain model.

### Infrastructure layer

The architectural area containing concrete integrations with external systems,
libraries, storage, and operating-system capabilities.

Examples include integrations with:

- Docker;
- PM2;
- systemd;
- Linux system files;
- the filesystem;
- RTC wake alarms;
- future persistence technologies.

### Port

A project-defined interface describing a capability required by an application
or domain component.

Ports should expose only the operations Atlas Manager needs.

A port must not copy an external tool's complete API merely because those
operations are technically available.

### Adapter

A concrete infrastructure implementation of a port.

An adapter translates between Atlas Manager models and an external system.

Examples include:

- a Docker service-management adapter;
- a PM2 process-management adapter;
- a Linux server-health adapter;
- a future event repository adapter.

### Composition root

The location where concrete dependencies are created and connected.

The composition root is expected to assemble:

- configuration;
- adapters;
- application services;
- controllers;
- the Express application;
- the HTTP server.

Dependency construction should not be scattered across controllers or domain
modules.

### Dependency direction

The rule that framework and infrastructure code may depend on project-defined
application boundaries, while application and domain logic must not depend
directly on concrete infrastructure implementations.

### Architecture Decision Record

A document recording an important architectural decision, its context,
considered alternatives, and consequences.

Architecture Decision Record is commonly abbreviated as ADR.

Accepted ADRs should not be rewritten to conceal past decisions. A later ADR
may supersede an earlier one.

## Service-management terms

### Management adapter

The adapter selected to manage a registered service.

Examples may include:

- Docker;
- PM2;
- systemd.

A service's management adapter determines how infrastructure operations are
performed, but it must not determine application policies.

### Supported operation

An operation explicitly permitted for a registered resource.

Examples may include:

- read status;
- start;
- stop;
- restart;
- read approved logs.

The presence of an operation in an external tool does not automatically make
that operation supported by Atlas Manager.

### Service status

The current operational state reported for a registered service. The initial
project-defined runtime states are:

- `running`: the service is active;
- `stopped`: the service is inactive through an expected stopped state;
- `failed`: the service reached a recognized failure state;
- `unknown`: the status read succeeded, but the infrastructure state could not
  be classified into another approved runtime state.

Infrastructure-specific values should be translated into project-defined
status models.

Runtime status is separate from health and readiness. A service may be running
while its application is unhealthy or not ready to perform its expected
function. The `unknown` state does not replace infrastructure errors, missing
registrations, or invalid status data.

### Health state

An assessment of whether a service is ready to perform its expected function.

Health is not always equivalent to process state.

For example, a container may be running while its application health check is
still failing.

### Health check

A controlled mechanism used to determine a resource's health state.

Examples may include:

- Docker health information;
- an approved HTTP endpoint;
- a process state check;
- another explicitly configured probe.

Health checks must use predictable timeouts and must not accept arbitrary
commands.

### Start operation

An application request to make a registered service available.

A start operation may require dependency resolution, health confirmation,
adapter calls, and event recording.

### Stop operation

An application request to make a registered service unavailable.

A stop operation may require dependent services to be stopped first.

### Restart operation

An application request that performs a controlled stop-and-start sequence or an
equivalent operation supported by the selected adapter.

Restart behavior should remain consistent with dependency, authorization, and
event-recording policies.

### Database-managed service

A registered service that represents a database engine running as a Docker
resource.

In the initial release, PostgreSQL, MongoDB, or other database engines are
managed only as infrastructure services.

Atlas Manager does not initially provide logical database administration,
queries, schema management, logical backups, or logical restoration.

## Docker terms

### Docker resource

A Docker-managed infrastructure object relevant to Atlas Manager.

The initial product scope focuses primarily on registered containers and
approved application resources, not generic unrestricted Docker
administration.

### Container

A running or stopped Docker container.

A container does not automatically become a registered service. It must be
explicitly included in the Atlas Manager service catalog.

### Docker health status

Health information produced by a Docker container health check.

Docker health status is one possible input for a project-defined health state.

### Docker socket

The Unix socket commonly used to communicate with the Docker daemon.

Access to the Docker socket is privileged because it can provide extensive
control over the host.

Atlas Manager must not receive unrestricted Docker socket access without a
reviewed and controlled security design.

### Docker Compose application

A group of related Docker resources defined through Docker Compose.

Support for managing Compose applications must expose only approved
project-level operations rather than unrestricted Compose commands.

### Docker-managed registered service

A registered service whose management adapter is `docker`.

A Docker-managed registered service is manageable through the same
project-level service-management contracts used by mock and PM2 services. The
configured Docker container name or identifier remains an infrastructure detail
owned by the registered-service configuration and Docker adapter.

### Docker container target

The configured external resource identifier for a Docker-managed registered
service.

The Docker container target is a non-empty canonical string containing no
control characters or surrounding whitespace. It is passed as a single argument
to Docker CLI commands and never interpolated into shell commands or treated as
executable syntax.

### Docker health state

A project-defined immutable vocabulary describing the health status of a Docker
container.

The Docker health state vocabulary includes:

- `not_configured` — no Docker health configuration;
- `starting` — Docker health starting;
- `healthy` — Docker health healthy;
- `unhealthy` — Docker health unhealthy;
- `unknown` — unsupported health value.

Docker health state is distinct from the generic runtime state. A running
container with an unhealthy Docker health check remains `running` with a
`unhealthy` health state.

### Docker resource snapshot

A canonical immutable resource usage snapshot for a running Docker container.

The Docker resource snapshot contains approved fields only:

- `cpuPercent` — CPU percentage (may exceed 100 on multi-core systems);
- `memoryUsageBytes` — memory usage in bytes;
- `memoryLimitBytes` — memory limit in bytes;
- `networkReceiveBytes` — network receive in bytes;
- `networkTransmitBytes` — network transmit in bytes;
- `blockReadBytes` — block read in bytes;
- `blockWriteBytes` — block write in bytes;
- `pids` — process count.

All values are finite, non-negative, and validated before model construction.
Stopped containers do not produce a resource snapshot; instead, the resource
usage is represented as unavailable with reason `container_not_running`.

### Docker Compose managed service

A registered service whose management adapter is `docker-compose`. A Compose
managed service represents an entire Compose project as one resource, not
individual Compose services. It requires adapter-specific management
configuration with an absolute `composeFile` path inside the configured
`projectDirectory`.

### Compose project target

The configured external resource identifier for a Docker Compose registered
service. This is the Compose project name and must be a canonical string with
no control characters or surrounding whitespace.

### Controlled service logs

An application capability for bounded log retrieval from registered Docker
resources. Logs are accessed through the `readLogs` supported operation and
return an immutable batch with separate stdout and stderr lines. Content is
normalized: ANSI escape sequences and control characters are removed, line
lengths are capped, and output is bounded by line count and byte limits. Log
streaming and follow mode are not supported. No HTTP log endpoint exists.

## Process and operating-system terms

### PM2 process

An application process managed through PM2.

A PM2 process may be represented as a registered service through a controlled
adapter.

### systemd unit

A resource managed by systemd.

A systemd service unit is one type of systemd unit, but the generic product
term `service` should not be assumed to mean systemd.

### Host server

The operating system and hardware environment on which Atlas Manager runs.

In this project, the host server is Atlas.

### Server health

The approved operational information describing the state of Atlas.

It may include non-sensitive data such as:

- uptime;
- memory usage;
- disk usage;
- CPU load;
- temperatures when safely available.

Server health must not expose secrets, private paths, credentials, or
unnecessary system details.

## Scheduling terms

### Availability mode

The policy controlling how a registered service is expected to become
available.

Planned modes include:

- `always`;
- `scheduled`;
- `manual`;
- `disabled`.

The exact behavior of each mode must be implemented through explicit
application rules.

### Always mode

An availability mode in which Atlas Manager should attempt to keep the service
available according to its approved operational policy.

### Scheduled mode

An availability mode in which service availability is controlled by a defined
schedule.

### Manual mode

An availability mode in which Atlas Manager performs start or stop operations
only through an explicit approved request.

### Disabled mode

An availability mode in which ordinary start or scheduling operations are not
permitted.

### Schedule

A configuration defining when an operation or availability policy should
apply.

Schedules must use an explicit timezone and should not rely implicitly on the
host timezone.

### Weekly schedule

A recurring schedule based on days of the week and defined time ranges.

### Temporary override

A temporary policy that changes normal availability behavior until a defined
expiration or cancellation condition.

Examples include:

- keep a service available until a specified time;
- start a service for a limited duration;
- temporarily pause its normal schedule.

### Scheduler

The application component responsible for identifying scheduled work and
triggering application use cases.

The scheduler must not bypass validation, authorization, dependency, or
event-recording rules.

### Power schedule

A schedule for approved host power operations, such as shutdown or wake
preparation.

Power scheduling is security-sensitive and must use controlled host
capabilities.

### Machine operating policy

The project-owned policy describing when Atlas is expected to operate. The
initial modes are `always_on`, `scheduled`, and `manual`. `always_on` and
`manual` do not produce automatic transitions; `scheduled` evaluates an
explicit weekly machine schedule.

### Machine operating window

An immutable weekly machine interval containing a lowercase weekday, a local
`HH:mm` start, and a local `HH:mm` end. Windows use half-open `[start, end)`
semantics. Adjacent windows are allowed and overlapping or overnight windows
are rejected.

### Schedule expectation

The intent produced by evaluating a schedule at an explicit instant. Machine
power planning uses `operating`, `offline`, or `manual`. It is not a report of
the real machine's current power state.

### Machine power plan

An immutable read-only result containing the evaluation instant, schedule
expectation, and the next planned shutdown and wake transitions. It describes
intent only and does not execute either transition.

### Planned shutdown

An immutable machine power transition plan identifying the next UTC instant at
which a scheduled policy expects its operating period to end. A planned
shutdown is not a shutdown request and does not claim that shutdown will
complete.

### Planned wake

An immutable machine power transition plan identifying the next UTC instant at
which a scheduled policy expects its next operating period to begin. A planned
wake is not an RTC configuration or wake-alarm mutation.

### Manual machine power mode

A machine operating-policy mode that intentionally suspends automatic power
expectation. Its schedule expectation is `manual` and it produces no planned
shutdown or wake transition.

### Wake alarm

### Machine shutdown occurrence

An immutable planned shutdown operation containing the canonical UTC shutdown
instant and next canonical UTC wake instant. Its identity is the exact tuple
of operation, shutdown time, and wake time; it is not a random ID.

### Occurrence claim

The process-local decision that an exact machine shutdown occurrence has been
accepted for one execution attempt. A later equivalent claim is a duplicate;
claims are permanent for the mock adapter lifetime and are not persisted.

### Due occurrence

A shutdown occurrence processed at or after its shutdown instant and strictly
before its wake instant. Only a due occurrence may be claimed.

### Stale occurrence

A shutdown occurrence processed at or after its wake instant. It is rejected
without claim or mutation and is not automatically replaced.

### Duplicate occurrence

An occurrence whose complete identity was already claimed by the same store.
Duplicate execution performs no wake or shutdown mutation.

### Wake preparation

Scheduling the occurrence's next wake alarm before its simulated shutdown.
A failed preparation prevents shutdown.

### Partial-effect failure

A failure after an earlier approved effect completed. If simulated shutdown
fails after wake preparation, the wake alarm remains scheduled; no rollback or
compensation is attempted.

### At-most-once execution attempt

The claim guarantee that one exact occurrence passes the claim once and later
attempts are duplicates. It does not guarantee exactly-once machine operation.

### Machine-power scheduler cursor

An immutable canonical UTC timestamp through which machine-power scheduler
intervals were successfully considered. It records scheduler progress, not
successful hardware effects or real machine state.

### Machine-power scheduler tick

One explicitly invoked bounded scheduler execution. It captures one timestamp,
processes one interval, executes generated occurrences sequentially, prunes
completed claims, and may advance the cursor.

### Machine-power scheduler interval

The interval `(completedThrough, tickedThrough]`. An occurrence at the old
cursor is excluded and one at the tick timestamp is included. Intervals longer
than eight days are blocked.

### Scheduler report

An immutable record of every generated occurrence result for one interval. It
is complete only when all items have terminal results; safe failed items make
the report incomplete.

### Cursor conflict

A compare-and-set result indicating that the authoritative cursor changed
since the scheduler read it. The scheduler does not overwrite, retry, or roll
back the authoritative state.

### Cursor advancement

The forward compare-and-set operation that persists a candidate cursor only
when its expected cursor still matches the authoritative value.

### Process reconstruction

Creating fresh power-management stores and application objects from the same
claim and cursor files after a process stops or fails. This preserves
sequential duplicate protection but does not provide cross-process locking.

### Persistent occurrence claim

A canonical file-backed record of a machine shutdown occurrence identity. It
survives sequential reconstruction and can later be pruned through a cursor.

### Completed claim pruning

Controlled removal of persisted claims whose shutdown time is at or before the
old authoritative cursor. Current-interval claims are retained until later
successful progression.

### Crash window

A process termination point between claim persistence, wake preparation,
shutdown request, and cursor advancement. The mock-first design favors
at-most-once attempts and does not infer whether an external effect completed.

### Interval bound

The maximum eight-day duration accepted for one machine-power scheduler tick.
Oversized intervals are blocked rather than silently skipped.

### Machine offline interval

The proposed machine-unavailable interval `[scheduledFor, wakeScheduledFor)`
for one shutdown occurrence. The shutdown instant is included and the wake
instant is excluded.

### Safe-shutdown readiness

The fail-closed evaluation that determines whether one due machine shutdown
occurrence may proceed. It checks confirmation, service schedule/runtime state,
active tasks, backups, filesystem readiness, and event-recording readiness.

### Shutdown blocker

An immutable project-owned explanation for why a shutdown occurrence cannot
proceed. Blockers are canonically ordered and contain only safe details.

### Readiness decision

The immutable `approved` or `rejected` result produced before an occurrence
claim. Approval contains no blockers; rejection contains at least one blocker.

### Explicit confirmation

A mock-first affirmative signal required before readiness dependencies can
approve shutdown. Its safe default is `not_confirmed`; it is not authentication
or authorization.

### Service availability conflict

A registered service is expected to be available during some portion of the
machine offline interval. This produces a service-specific shutdown blocker.

### Fail closed

The safety rule that unknown, malformed, or unavailable readiness information
rejects shutdown instead of being interpreted as ready.

### Readiness rejection

A rejected decision that consumes no occurrence claim and performs no wake or
shutdown mutation. It is therefore retryable after conditions change.

### Retryable rejection

A rejected readiness attempt that may be evaluated again by a later explicit
caller or scheduler tick because no at-most-once execution claim was consumed.

A hardware or operating-system mechanism used to request that Atlas starts at a
future time. The current v0.6 slices query and mutate one simulated next alarm
through project-owned mock data only; real configuration requires a future
reviewed adapter and confirmation design.

### Next wake alarm

The one wake alarm currently represented by Atlas Manager. A next-alarm query
returns an immutable observation containing `unsupported`, `not_scheduled`, or
`scheduled` with one canonical `scheduledFor` instant.

### Wake-alarm schedule request

An application request containing only a canonical `scheduledFor` timestamp.
The timestamp must represent an instant strictly later than the application
request instant. The request contains no device, command, executable, or RTC
target information.

### Wake-alarm replacement

A successful schedule operation that changes an existing next alarm to a
different instant. Its immutable mutation result has outcome `replaced` and
contains both the previous and current scheduled states.

### Unchanged wake-alarm request

A successful schedule operation whose requested instant is equal to the
currently represented next alarm. Its outcome is `unchanged` and it does not
fabricate a replacement.

### Wake-alarm cancellation

An approved operation that removes the currently represented next alarm. It
returns `cancelled` when an alarm existed and `not_scheduled` for a successful
empty-state no-op.

### Mock wake-alarm state

A deterministic process-local infrastructure state shared by the mock
wake-alarm reader, controller, and RTC information reader. It is recreated for
each composition and has no timer, persistence, hardware, or machine effect.

### RTC information

The project-owned immutable observation containing the application observation
timestamp, normalized RTC timestamp, and wake-alarm observation state. It does
not expose RTC device paths, kernel files, commands, or raw operating-system
structures.

### Wake-alarm observation

The project-owned state describing whether wake-alarm information is
`unsupported`, `not_scheduled`, or `scheduled`. A scheduled observation carries
one canonical `scheduledFor` timestamp; the other states do not fabricate one.

### Simulated shutdown request

An application request accepted by the mock shutdown controller. Its result is
marked `shutdown` and `simulated`; it does not claim that the operating system
powered off the machine.

### Mock power adapter

An infrastructure adapter that returns deterministic RTC information or a
simulated shutdown result without accessing hardware, privileged interfaces,
child processes, or the real machine.

### Privileged power adapter

A future infrastructure adapter that could interact with operating-system power
or RTC facilities. It requires an explicit confirmation, authorization, and
security design before implementation.

## Dependency terms

### Service dependency

A relationship indicating that one registered service requires another service
to be available or healthy.

The declaration contains only another registered-service identifier; it does
not contain Docker targets, paths, commands, hosts, or probes.

### Dependency

The service required by another service.

For example, a database container may be a dependency of an API.

### Dependent service

A service that requires another service.

For example, an API may be dependent on a database container.

### Dependency-aware orchestration

Application logic that starts, stops, or checks services according to their
declared dependency relationships.

Startup generally follows dependency order.

Shutdown generally follows the reverse order.

### Dependency graph

A representation of registered service dependency relationships.

The dependency graph must reject invalid configurations such as missing
services or circular dependencies.

The graph is immutable after catalog construction and supports direct and
transitive dependency/dependent queries plus deterministic topological order.

### Direct dependency

A service named directly in another service's `dependencies` collection.

### Transitive dependency

A dependency reached through one or more dependency edges. A shared dependency
appears once in a closure.

### Dependent

A registered service that requires another registered service. Dependents are
stopped before the service they require.

### Dependency closure

The unique set of transitive dependencies or dependents reachable from a target
service.

### At-most-once occurrence protection

The scheduler's persisted target-occurrence claim rule. A target occurrence is
claimed before its dependency orchestration runs; a duplicate claim suppresses
the complete replay after reconstruction. This prevents automatic duplicate
replay but does not provide globally exactly-once execution, atomic
cross-service effects, rollback, or compensation.

### Topological order

An ordering in which every dependency appears before its dependent. Atlas
Manager uses canonical registered-service IDs as deterministic tie-breakers.

### Circular dependency

An invalid configuration in which a sequence of services eventually depends on
itself.

Example:

```text
service-a -> service-b -> service-c -> service-a
```

Circular dependencies must be detected before orchestration begins.

### Readiness confirmation

The process of verifying that a dependency has reached its required health or
availability state before starting a dependent service.

A process being started does not necessarily mean it is ready.

### Readiness policy

The registered-service configuration selecting `runtime` or `health` readiness
and bounded timeout/poll intervals.

### Runtime readiness

Readiness inferred from generic registered-service runtime state. Only
`running` is ready.

### Health readiness

Readiness inferred from adapter-approved health state. Docker and Compose
health models are supported; running alone is insufficient.

### Orchestration plan

An immutable, deterministic sequence of project-owned control and readiness
steps produced before effects begin.

### Orchestration step

One control or readiness action for one registered-service ID.

### Partial orchestration effect

The state left by already completed external steps when a later step fails.
Atlas Manager does not automatically roll back or compensate those effects.

## Backup and event terms

### Backup orchestration

The controlled application workflow that requests and coordinates approved
backup operations.

Backup orchestration is different from implementing every storage engine's
logical backup behavior.

### Backup target

A registered resource or data location included in an approved backup
operation.

Backup targets must use controlled identifiers and paths.

### Event history

A user-relevant history of administrative and automated operations.

Event history is different from low-level application logs.

### Administrative event

A structured record of an operation performed or attempted by Atlas Manager.

An administrative event may include:

- operation type;
- target resource;
- operation source;
- timestamp;
- result;
- safe error information.

### Operation source

The origin of an administrative operation.

Examples may include:

- an authenticated user request;
- the scheduler;
- a temporary override;
- an internal recovery workflow.

## Security terms

### Privileged operation

An operation capable of affecting the host, processes, containers, system
services, power state, backups, or protected files.

Privileged operations require narrow interfaces, explicit authorization,
controlled arguments, and additional review.

### Arbitrary command execution

Execution of a command whose executable or arguments are supplied without
strict project-defined control.

Atlas Manager must never expose arbitrary command execution through its API.

### Allowlist

An explicit collection of resources or operations that Atlas Manager is
permitted to use.

Only allowlisted operations and registered identifiers should reach privileged
infrastructure adapters.

### Untrusted input

Data received from outside the trusted application boundary.

Examples include:

- HTTP request bodies;
- URL parameters;
- headers;
- environment variables;
- external configuration;
- persisted data read from an external source.

Untrusted input requires validation before use.

### Controlled argument

An argument derived from project-defined values, registered configuration, or
strictly validated input.

A controlled argument must not permit unrestricted command construction.

### Least privilege

The security principle that each process, adapter, or operating-system identity
should receive only the permissions required to perform its approved
responsibilities.

### Authentication

The process of verifying the identity of a user or client.

### Authorization

The process of deciding whether an authenticated identity may perform a
specific operation on a specific resource.

Authentication alone does not grant permission for every administrative
operation.

### Audit event

A structured event created to provide traceability for a security-sensitive or
administrative action.

Audit information must avoid storing secrets.

### Secret

Sensitive information that must not be committed or exposed.

Examples include:

- passwords;
- access tokens;
- private keys;
- Cloudflare credentials;
- production environment values.

## Error and reliability terms

### Project-defined error

An error model representing an expected failure in Atlas Manager terms rather
than exposing a framework or infrastructure error directly.

Examples include:

- resource not found;
- dependency unavailable;
- operation not supported;
- operation rejected;
- infrastructure timeout.

### Infrastructure failure

A failure produced while communicating with an external system or
operating-system capability.

Infrastructure failures should be translated into safe project-defined errors
when practical.

### Timeout

A defined limit on how long Atlas Manager waits for an external operation.

Infrastructure interactions and health checks should not wait indefinitely.

### Fail early

The practice of stopping application startup when required configuration is
invalid or an essential dependency cannot be initialized safely.

## Development terms

### Issue

A GitHub item describing a problem, feature, documentation task, or maintenance
activity.

An Issue should define a clear objective and acceptance criteria.

### Pull Request

A proposed change to the repository that is reviewed before being merged.

Issues and Pull Requests share the same numeric sequence in GitHub.

### Acceptance criteria

The conditions that must be satisfied for an Issue to be considered complete.

### Scope

The specific work authorized by an Issue and its acceptance criteria.

Work outside the scope should normally become a separate Issue.

### Conventional Commit

The commit-message convention used by Atlas Manager.

Example:

```text
feat: add server health endpoint
```

### Definition of Done

The complete set of conditions required before a contribution is considered
finished.

The current Definition of Done is documented in CONTRIBUTING.md.

### Squash merge

The merge strategy that combines the Pull Request's commits into one commit on
main.

### Coding agent

An automated coding assistant used to analyze or modify the repository.

Coding agents must follow AGENTS.md and remain subject to human review.

### Shutdown preparation

An explicit mock-first pipeline that resolves supported shutdown blockers
before an occurrence may be claimed.

### Preparation plan

The immutable, canonical list of preparation steps required by one initial
readiness decision.

### Preparation step

One validated operation or readiness transition in a preparation plan.

### Preparation event

An immutable, narrow in-memory record of preparation progress, ordered by a
per-attempt sequence number.

### Preparable blocker

A blocker that has a bounded mock preparation operation, such as a running
service, active task, backup in progress, or filesystem synchronization need.

### Non-preparable blocker

A blocker that must fail closed and prevent preparation effects, such as a
service required during the offline interval or unknown readiness.

### Preparation report

An immutable record of the initial decision, ordered preparation steps/events,
final readiness, and whether preparation was not required, blocked, prepared,
or incomplete.

### Final readiness

The authoritative readiness decision reevaluated after preparation effects and
before the occurrence claim.

### Evaluation-scoped confirmation

An explicit confirmation read that authorizes only the current readiness
evaluation. Preparation mutations require a fresh confirmation read.

### Partial preparation

Preparation in which earlier mock effects completed but a later step failed;
effects are preserved, with no rollback or compensation.

### Idempotent preparation retry

An explicit later attempt that reads current authoritative state and reports
already-complete effects without repeating them unnecessarily.

### Power helper

A future narrowly scoped privileged executable responsible for approved Linux
RTC, wake-alarm, and shutdown operations. It is separate from the unprivileged
Node.js process.

### Helper protocol

The versioned project-owned request and response vocabulary used between Atlas
Manager and the fixed power helper. Version 1 supports only five allowlisted
operations and rejects unknown fields and values.

### Fixed helper executable

The only executable accepted by the Linux power transport:
`/usr/local/libexec/atlas-manager-power-helper`. The path is a reviewed code
and deployment contract, not caller-provided input or a PATH lookup.

### Helper installation contract

The pre-execution checks requiring Linux, a root-owned regular non-symlink
executable, safe file permissions, and a non-writable real parent directory.
Inspection never modifies the installation.

### No-shell process transport

A power-management transport that invokes the fixed executable directly with
an empty argument list and `shell: false`. It does not accept arbitrary
commands, paths, environments, or working directories.

### Bounded output

The transport rule that limits helper stdout to 16 KiB and stderr to 4 KiB
while streams are read. An exceeded bound terminates the process and exposes
no partial output.

### Adapter bundle

The frozen collection of helper-backed RTC, wake-alarm reader/controller, and
machine-shutdown adapters sharing one serialized transport.

### Production activation gate

The set of reviewed prerequisites that must exist before real power effects
are enabled: authenticated and authorized administration, destructive
confirmation, persistent audit events, deployment and permission validation,
recovery procedures, supported Linux verification, operator-visible failures,
and helper security review.

### Helper-backed adapter

An infrastructure adapter that translates one existing power-management port
into a strict helper protocol operation and maps only validated responses into
existing project-owned domain results. It performs no fallback to mock behavior.

### Cloudflare Access assertion

The bounded compact JWT delivered in the `Cf-Access-Jwt-Assertion` request
header. It is request-scoped and is never logged or persisted.

### Access application token

A Cloudflare Access JWT for one configured application. Atlas Manager accepts
only tokens with an RS256 signature, `type: app`, and a validated human UUID
subject.

### Access audience

The one exact application audience configured for this deployment. It is
compared without wildcard, substring, case-folding, or trimming behavior.

### Access issuer

The internally derived HTTPS issuer
`https://<team-name>.cloudflareaccess.com`.

### JWKS

The JSON Web Key Set published by the trusted Cloudflare Access team endpoint.
Atlas Manager accepts a bounded set of validated RS256 RSA verification keys.

### Signing-key rotation

The normal replacement of Access signing keys. An unknown key ID causes at
most one coalesced JWKS refresh before the assertion is accepted or rejected.

### Request-scoped authentication provider

An authentication-provider instance that captures only one request's bounded
assertion reader. Shared verifier and JWKS infrastructure may be reused.

### Human administrative subject

The canonical lowercase UUID in a verified Access token's `sub` claim. Empty
subjects used by service tokens are not human administrative identities.

### Identity-provider unavailable

The safe authentication outcome returned when required Cloudflare signing-key
data cannot be safely obtained or parsed.

### Assertion verification

The application-side process of validating JWT structure, signature, issuer,
audience, type, temporal claims, and human subject before creating a principal.

### Protected wake-alarm resource

The exact mock-first resource `/admin/power/wake-alarm`, supporting GET
observation, PUT desired-state scheduling, and DELETE cancellation after the
existing protected-administration checks.

### Wake-alarm read permission

The explicit `power.wake.read` permission for `read_wake_alarm`. It is granted
to `power_operator` and `administrator`, not to `auditor` or
`scheduler_operator`.

### Idempotent wake schedule

A PUT expressing the desired future alarm instant. Repeating the same instant
returns `unchanged`; a different instant returns `replaced`.

### Idempotent wake cancellation

A DELETE that returns `cancelled` when an alarm exists and `not_scheduled` when
it is already absent.

### Wake mutation gate

The process-local fail-fast gate allowing one active wake PUT or DELETE. A
second mutation receives a conflict and is never authenticated or audited.

### Wake state recheck requirement

The safe response after a wake mutation completed but its terminal audit failed.
The client must GET the authoritative state before another mutation; the
application does not retry or roll back.

### Shared administrative admission

The one global process-local 60-per-60-second and four-concurrent request
boundary shared by all enabled administrative HTTP routes.

### External Linux power helper

The standalone compiled Go executable at the fixed future installation path
`/usr/local/libexec/atlas-manager-power-helper`. Issue #246 supplies only its
strict protocol runtime and deny-all backend; it is not installed or enabled.

### Setuid helper installation

The intended root-owned installation with dedicated group
`atlas-manager-power` and exact mode `04750`. The application inspector checks
the state but never changes ownership, permissions, group membership, or
directories.

### Helper protocol corpus

The shared canonical and invalid JSON fixtures under
`power-helper/testdata/protocol`. TypeScript and Go tests consume the same
fixtures to prevent their protocol descriptions from diverging.

### Fixed Linux RTC resource

The reviewed `rtc0` sysfs resource consisting only of
`/sys/class/rtc/rtc0/since_epoch` and `/sys/class/rtc/rtc0/wakealarm`. It is
not configurable, discovered dynamically, or selected by a request.

### RTC-to-system-clock alignment

The fixed check that places a `since_epoch` value within 300 seconds of the
system clock captured around the read before representing it as canonical UTC.

### Read-only RTC helper backend

The Issue #248 Go backend that observes fixed Linux RTC sysfs state and keeps
all wake and shutdown mutation operations unsupported.

### Wake-alarm mutation transaction

A bounded helper operation that captures the current fixed RTC wake state,
writes one absolute value, and verifies the resulting state while holding the
required lock.

### Wake-alarm operation lock

The fixed nonblocking advisory lock at
`/run/atlas-manager-power-helper.lock`. Reads acquire it shared; scheduling
and cancellation acquire it exclusively. Busy or unsafe lock state fails
closed.

### Partial wake replacement

The intentional state in which replacement successfully cancels the old alarm
but fails before verifying the new alarm. The helper does not retry or restore
the old value; a later authoritative read is required.

### Systemd-logind shutdown requester

The fixed helper-side adapter that asks
`org.freedesktop.login1.Manager.PowerOff(false)` over the system D-Bus. It does
not invoke commands, bypass inhibitors, or prove that power-off completed.

### Fixed system-bus boundary

The root-owned `/run/dbus/system_bus_socket` and its root-owned safe parent.
The helper never accepts a D-Bus address from environment, protocol, or
configuration input.

### Shutdown acceptance

The limited meaning of a successful helper shutdown response: systemd-logind
returned a successful method reply. It is not confirmation that the machine is
already powered off.

### Uncertain shutdown acceptance

The internal state after the PowerOff request may have been transmitted but no
reply was received. It maps to `operation_failed` and is never retried or
compensated.

### Host qualification

Issue #256's read-only capability inspection of one Linux host. A passing
result approves only a disabled helper installation at the time of inspection;
it is not distribution-wide, firmware, hardware, application-enrollment, or
production-effect certification.

### Disabled installation drill

The explicit operator sequence of qualification, installation, disabled-state
verification, reboot verification, uninstall, and removed-state verification.
The `atlas-manager-power` group remains empty throughout the drill.

### Power-management backend selector

The exact `POWER_MANAGEMENT_BACKEND` configuration value that chooses the
complete frozen power adapter set. `mock` is the default; `linux_helper` is
the only alternate value. Paths, arguments, resources, and fallback behavior
are not configurable.

### Production-shaped composition

The startup boundary that selects and freezes either the mock power
infrastructure or one complete Linux helper adapter bundle without executing
the helper. It is a composition gate, not installation, enrollment, HTTP
activation, scheduler activation, or real-effect certification.

### Accepted shutdown

The Linux helper domain result produced after systemd-logind returns a
successful `PowerOff(false)` reply. It records acceptance of the request, not
completion of host power-off. Mock shutdowns retain the distinct
`simulated` outcome.

### Machine operating policy

The immutable startup policy that describes whether the machine is always on,
manual, or operating within canonical weekly windows. It is configured by
`MACHINE_OPERATING_POLICY` and does not itself activate a scheduler or power
effect.

### Strict machine policy JSON

The bounded configuration format for `MACHINE_OPERATING_POLICY`. It is one
JSON object with duplicate-key detection, no unknown fields, no arbitrary
timezone, and validation through the existing machine-policy domain.

### Policy-bound scheduler confirmation

The scheduler-only authority introduced by ADR-013. It regenerates the
one-minute policy interval ending at a candidate shutdown and confirms only
when exactly one generated occurrence matches every field. It does not replace
readiness, preparation, direct confirmation, administrative confirmation, or
automatic scheduler lifecycle.

### Machine-power scheduler lifecycle

The disabled-by-default process lifecycle around the existing explicit
machine-power scheduler tick. It starts after HTTP listening only when the
exact activation flag is `true`, uses one non-overlapping one-shot timer with
a fixed 60-second delay, and terminates fail-closed on blocked, incomplete,
conflict, or failed outcomes.

### Linux power-effects activation admission

The immutable startup boundary introduced by ADR-015. It admits real Linux
helper effects only when an effect-capable surface, exact operator
confirmation, expected installed-helper SHA-256, and read-only installation
preflight all agree. It is independent from backend selection, machine policy,
HTTP authentication, request confirmation, scheduler policy confirmation,
readiness, installation, enrollment, and real-effect certification.

### Helper installation preflight

A read-only startup inspection of the fixed installed helper. It reuses the
installation inspector and verifies safe file identity, ownership, group,
04750 mode, setuid, link count, parent directories, process group membership,
and an exact streaming SHA-256. It never executes or repairs the helper.

### Linux power runtime identity

The fixed dedicated service identity required by ADR-016 for admitted Linux
power effects: user `atlas-manager`, primary group `atlas-manager`, home
`/var/lib/atlas-manager`, shell `/usr/sbin/nologin`, and supplementary
membership in `atlas-manager-power`. Numeric IDs are host-assigned but must
be resolved uniquely from fixed local account files.

### Exact helper-group binding

The relationship in which the local `atlas-manager-power` GID, the running
process supplementary membership, the startup helper preflight, and every
operation-time helper inspection all use the same admitted numeric GID. A
different positive non-root group cannot authorize the helper.

### Disabled deployment bundle

A reproducible Linux amd64 archive containing the compiled application,
production dependencies, strict file inventory, disabled systemd unit, safe
environment template, and operator installer. It does not activate Atlas.

### Deployment state

Root-private state recording only releases managed by the Atlas Manager
installer. It is not application runtime state and is never used to adopt
unknown files.

### Deployment host qualification

The separate read-only Linux amd64 inspection boundary introduced by ADR-018.
It validates fixed deployment assumptions and emits bounded canonical JSON;
it does not prepare, install, enable, start, or repair Atlas Manager.

### Preparation required

A qualification result meaning the fixed runtime identities are completely
absent while other inspected host assumptions are safe. It is not permission
to create accounts or groups and does not pass prepared-host verification.

### Disabled-installation evidence

A canonical report proving that the managed application release, unit, and
template are intact while the service remains disabled and inactive. It does
not prove application startup or power-effect readiness.

### Runtime identity preparation

The separate operator-run transaction that creates the fixed `atlas-manager`
user, its primary group, and the empty `atlas-manager-power` group. It starts
only from completely absent identities, records private managed state, and
does not create a home, install the application, enroll group membership, or
enable the service.

### Managed identity preparation state

Root-private version-one evidence containing the fixed identity names,
host-assigned numeric IDs, source commit, and bundle version. It does not
adopt or authorize unrelated accounts and is not a removal instruction.

### Disabled deployment rehearsal

The deterministic sandbox integration test introduced by ADR-020. It builds
two valid releases and composes host qualification, runtime identity
preparation, disabled installation, upgrade, rollback, uninstall, and state
verification without touching a physical host or executing Atlas Manager.

### Rehearsal evidence

Bounded canonical JSON containing release digests, step classifications,
filesystem mutation classifications, and a deterministic report hash chain.
It is integrity evidence for the sandbox rehearsal, not release authenticity
or production deployment approval.

### Mock-only activation profile

The fixed first-service configuration: loopback HTTP, mock power backend,
disabled Linux effects and scheduler, always-on policy, empty service catalog,
and disabled administrative routes.

### Service lifecycle boundary

The operator-run boundary that controls only `atlas-manager.service` through
fixed systemd commands, verifies loopback health and runtime identity, and can
roll activation back without changing deployment or identities.
