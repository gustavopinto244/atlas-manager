# Atlas Manager — High-Level Architecture

## Current administrative control plane and dashboard

ADR-022 introduced the first protected product-facing control plane. The
current `1.0.0` implementation extends it through ADR-027 and ADR-031–034.
Service,
availability, overview, and dashboard routes use one process-local admission
boundary and the existing Cloudflare authentication, fixed role policy,
authorization audit, and persistent event history. HTTP maps explicit safe
response objects and resolves service identifiers through the trusted catalog;
it never calls Docker, Compose, PM2, shell commands, or infrastructure
adapters directly.

The dashboard is a same-origin closed asset inventory with restrictive CSP,
safe DOM text rendering, no browser credential storage, no CORS, and no
external assets. The managed profile is loopback-only and mock-first:
administrative control is enabled, but wake/shutdown routes, Linux effects,
and the machine-power scheduler remain disabled. Service activation and power
activation are independent boundaries. The ADR-022 implementation tranche used
no physical host or VM; the later GA acceptance exercised the mock-only
deployment and real Cloudflare ingress without activating physical power.

## Controlled backup orchestration

ADR-023 adds a project-owned backup-management boundary. Registered targets are
immutable and resolve only to the `mock` or `filesystem_tree` adapters. The
filesystem adapter traverses an approved configured tree with standard-library
APIs, rejects links and special files, writes a private candidate, computes a
canonical manifest, and publishes atomically. Run history, scheduled claims,
cursor advancement, and retention are separate persistent boundaries. HTTP and
dashboard responses expose only bounded target and run metadata; backup content
and paths remain private. Shutdown readiness consumes only a bounded backup
state and never starts or cancels a backup.

## Reproducible helper installation boundary

Issue #254 adds a separate release/build boundary around the helper:

```text
explicit build inputs
        ↓
reproducible `GOOS=linux`, `GOARCH=amd64`, `GOAMD64=v1` bundle with
`CGO_ENABLED=0`
        ↓
operator-run installer
        ↓
fixed root-owned setuid helper path
```

The installer is not part of Atlas Manager and is never called by npm, startup,
HTTP, or the helper. It validates the closed manifest, executable checksums,
root-owned parents, and an existing empty `atlas-manager-power` group before an
atomic replacement. Its production paths are fixed; sandbox roots are only
available through internal tests. The archive does not contain setuid metadata,
and no application user is enrolled. Host qualification and production wiring
remain later deployment decisions.

## Document purpose

This document describes the intended high-level software architecture of Atlas
Manager.

It defines architectural boundaries, dependency rules, integration patterns,
and security principles that should guide implementation.

Atlas Manager reached general availability at `1.0.0`, and most feature
modules described here are implemented; see `docs/capabilities.md` for the
current implementation status of each capability. This document remains a
living reference for the architectural boundaries and patterns that continue
to guide new work, not a record of a finished, unchanging design.

Detailed product behavior is defined in:

- `docs/product-vision.md`;
- `docs/requirements.md`.

Individual architectural decisions are recorded in `docs/adr/`.

## Architectural style

Atlas Manager is designed as a feature-first modular monolith.

The application is deployed as a single system, while its code is separated
into cohesive feature modules with explicit responsibilities and boundaries.

The architecture is inspired by:

- Clean Architecture;
- Ports and Adapters;
- lightweight Domain-Driven Design.

These approaches are used as practical guidelines. The project should avoid
creating abstractions that do not support a current requirement.

## Architectural goals

The architecture should:

- keep business and application logic independent from frameworks;
- make infrastructure integrations replaceable and testable;
- keep privileged operations explicit and controlled;
- support incremental development;
- allow individual features to evolve without excessive coupling;
- remain understandable to the primary developer;
- support automated testing at different levels;
- avoid unnecessary distributed-system complexity.

## High-level overview

```text
External client
      |
      v
HTTP delivery layer
Express routes, controllers, validation and response mapping
      |
      v
Application layer
Use cases, orchestration and application policies
      |
      v
Domain layer
Business concepts, rules and dependency-free models
      |
      v
Ports
Interfaces required by application and domain logic
      |
      v
Infrastructure adapters
Docker, PM2, systemd, operating system, filesystem and persistence
```

The dependency direction points toward application and domain rules.

Infrastructure code may depend on application-defined interfaces, but
application code must not depend directly on infrastructure implementations.

### Privileged Linux power boundary

Future real power effects are isolated behind a power-management-only helper
boundary:

```text
application use case
        ↓
power-management port
        ↓
helper-backed adapter
        ↓
strict process transport
        ↓
external privileged helper
```

The application-side foundation validates immutable protocol requests and
responses, inspects the fixed root-owned helper installation, and uses a
bounded no-shell process transport. The only accepted executable path is
`/usr/local/libexec/atlas-manager-power-helper`; callers cannot supply a path,
arguments, environment, working directory, timeout, or output limit. The
helper source is not installed. Default power-management composition remains
mock-first, while ADR-011 provides an explicit complete-bundle selector;
authentication, authorization, confirmation, auditing, deployment, and
security-review prerequisites still gate real effects.

### Administrative event-history boundary

State-changing power operations use a separate administrative audit boundary:

```text
application use case
        ↓
administrative audit trail
        ↓
administrative-event recorder port
        ↓
in-memory or explicitly configured file-backed event store
```

The event-history feature owns immutable event models, strict operation
details, attempt identifiers, store-assigned sequences, bounded queries, and
file reconstruction. Power management depends only on its public application
contracts; it does not import file-store internals, paths, parsers, or mutable
collections. Preparation progress remains a separate in-memory concern and is
not used as the persistence format.

Every audited top-level operation records `started` before its first
state-changing effect and one terminal result afterward. The same application
timestamp may be used for both events; sequence determines order. The shared
event-history readiness check is part of shutdown readiness, so an unavailable
history fails closed before preparation, claims, wake mutation, or shutdown.
Terminal audit failures preserve completed effects and return focused
partial-effect errors without rollback or retry. The store is append-only
within one process instance; cross-process locking and tamper-proof storage are
not claimed. Operational v2 persistence adds a fixed atomic cross-process
writer lock, bounded segments, canonical record and segment SHA-256 chains,
retention anchors, and protected exports. These provide deterministic
integrity evidence, not external authenticity or non-repudiation.

Rotation, retention, migration, and export use private transaction evidence.
Broken chains, unknown files, unsafe metadata, interrupted maintenance, and
stale locks fail closed. No automatic repair, arbitrary path selection, or
silent truncation is available.

### Administrative access-control boundary

Issue #236 adds a project-owned mock-first boundary before protected
administration:

```text
delivery-owned authentication adapter
        ↓
access-control application
        ↓
protected administration facade
        ↓
power management / event history
        ↓
controlled infrastructure adapter
```

Authentication creates an immutable UUID-backed human or service principal.
Authorization maps one explicit operation to one fixed permission and reads
trusted role assignments exactly once. The default authenticator denies all
requests and unknown or unavailable role data fails closed. Authorization
events are stored through the same event-history boundary before a target
capability runs.

Power-management and event-history adapters do not receive credentials, roles,
permissions, sessions, or authorization policy. Verified authenticated human
actors are constructed internally as `administrator:<principalId>` and
Cloudflare service-token actors as `service:<principalId>`; callers cannot
provide actor fields or kind. Scheduler-generated occurrence events remain
`automated/machine-power-scheduler`, even when a protected administrator
authorizes the scheduler tick. This application boundary does not authorize
delivery requests by itself; the Cloudflare identity adapter and the protected
event-history route are layered above it.

### Protected shutdown HTTP boundary

The two-stage shutdown delivery is intentionally operation-specific:

```text
shutdown HTTP handler
        ↓
request-scoped Cloudflare provider and confirmation
        ↓
request-scoped access-control composition
        ↓
protected administration facade
        ↓
shared service-management and mock-first power composition
        ↓
persistent event history and occurrence claims
```

`POST /admin/power/shutdown/preparations` may stop registered services when
readiness identifies preparable blockers, but it never claims an occurrence or
changes the wake alarm. `POST /admin/power/shutdown/executions` performs fresh
readiness, claims the occurrence, schedules wake, and requests simulated
shutdown. The HTTP layer never invokes the direct shutdown-controller
capability. Preparation and execution use separate request-scoped confirmation
values and execution never performs automatic preparation.

## Feature-first modular organization

Code should be organized primarily around product capabilities instead of
being separated only by technical file types.

Examples of planned feature areas include:

- server health;
- registered services;
- service scheduling;
- Docker resources;
- power management;
- backups;
- event history;
- administration.

A feature may contain its own delivery, application, domain, and
infrastructure-related code when those elements are specific to that feature.

Shared code should be introduced only when multiple features have a genuine
common requirement.

A shared directory must not become a location for unrelated utilities.

## Architectural areas

### Delivery layer

The delivery layer receives external input and translates it into application
operations.

The initial delivery mechanism will be an HTTP API implemented with Express.js.

Delivery responsibilities include:

- declaring HTTP routes;
- reading request parameters, headers, and bodies;
- validating external input;
- calling application use cases;
- translating results into HTTP responses;
- mapping known errors to appropriate status codes.

The delivery layer must not:

- contain business rules;
- execute shell commands;
- control Docker, PM2, or systemd directly;
- access persistence implementations directly;
- decide service dependency order;
- implement scheduling policies.

Express-specific objects such as `Request`, `Response`, and `NextFunction`
must remain inside the HTTP delivery boundary.

### Application layer

The application layer implements use cases and coordinates domain behavior and
external capabilities.

Examples of application responsibilities include:

- retrieving server health information;
- starting or stopping a registered service;
- applying service availability schedules;
- coordinating dependency-aware startup;
- requesting a backup operation;
- recording an administrative event.

Application use cases should depend on explicit ports rather than concrete
infrastructure libraries.

The application layer may coordinate multiple ports as part of a single
operation.

For example, starting an API may require:

1. identifying its dependencies;
2. starting a database container;
3. waiting for the dependency health check;
4. starting the API process;
5. recording the result.

The application layer determines this workflow. Docker and PM2 adapters only
perform their respective infrastructure operations.

### Domain layer

The domain layer contains business concepts and rules that can be expressed
without frameworks or operating-system integrations.

Possible domain concepts include:

- registered service;
- service identifier;
- service status;
- availability mode;
- weekly schedule;
- temporary override;
- service dependency;
- health state;
- backup request.

Domain code should:

- use plain TypeScript;
- avoid Express imports;
- avoid infrastructure imports;
- preserve valid state through explicit rules;
- remain independently testable.

Not every feature requires complex domain modeling. Simple use cases should
remain simple.

### Ports

Ports are interfaces that describe capabilities required by the application or
domain layers.

Examples may include:

- `ServiceManager`;
- `ContainerManager`;
- `SystemServiceManager`;
- `ServerHealthReader`;
- `PowerController`;
- `BackupExecutor`;
- `EventRepository`;
- `Clock`.

Ports should describe project needs rather than expose an external library's
entire API.

For example, a Docker-related port should expose only operations required by
Atlas Manager. It must not reproduce unrestricted access to every Docker
command.

### Infrastructure adapters

Infrastructure adapters implement ports using external systems and libraries.

Planned adapters may communicate with:

- Docker;
- PM2;
- systemd;
- Linux operating-system files;
- RTC wake alarms;
- the filesystem;
- a future persistence mechanism.

Adapters are responsible for:

- translating application requests into infrastructure operations;
- translating external responses into project-defined models;
- handling expected infrastructure errors;
- applying timeouts where required;
- avoiding leakage of library-specific data into application code.

Adapters must not independently decide business or orchestration policies.

## Composition root

Concrete implementations should be assembled in a composition root near the
application entry point.

The composition root is responsible for:

- creating configuration objects;
- constructing infrastructure adapters;
- constructing application services;
- injecting dependencies;
- creating the Express application;
- starting the HTTP server.

Dependency construction must not be scattered across controllers or feature
modules.

`src/main.ts` is the production composition root. It parses immutable
configuration, admits or rejects Linux power effects before HTTP construction,
builds the shared feature capabilities, creates Express, starts scheduler
lifecycles only after the listener is ready, and coordinates graceful
shutdown. Feature-local composition functions keep those responsibilities
modular while the top-level wiring remains centralized.

## Request flow

A typical administrative HTTP operation should follow this flow:

```text
HTTP request
    |
    v
Express route
    |
    v
Request validation
    |
    v
Controller
    |
    v
Application use case
    |
    +--> Domain rules
    |
    +--> Port interface
              |
              v
       Infrastructure adapter
              |
              v
       External system
    |
    v
Application result
    |
    v
HTTP response mapping
```

External failures should be translated into project-defined errors before
reaching the controller whenever practical.

## Validation boundaries

External input must be treated as untrusted.

Zod is approved for validating:

- environment variables;
- HTTP request parameters;
- HTTP request bodies;
- configuration files or persisted external data.

Validation schemas should remain near the boundary where the external data
enters the application.

Validating syntax does not replace application or domain rules.

For example, Zod may validate that a service identifier is a string, while the
application layer determines whether that service is registered and may be
controlled.

## Error handling

Expected failures should use explicit project-defined error types or result
models.

Examples include:

- requested resource not found;
- unsupported operation;
- dependency unavailable;
- infrastructure timeout;
- operation rejected by policy;
- external service failure.

Controllers should map known errors to stable HTTP responses.

Unexpected errors must be logged and converted into a generic internal error
response without exposing stack traces, commands, filesystem paths, or secrets.

## Privileged operations

Atlas Manager will perform operations that can affect the host server.

These capabilities include:

- controlling processes;
- controlling containers;
- controlling system services;
- scheduling shutdown and wake operations;
- reading system information;
- creating backups.

The Express process must not run as root.

Privileged operations must be implemented through narrowly scoped and
controlled mechanisms.

The application must never:

- execute arbitrary commands received through HTTP;
- expose unrestricted shell access;
- concatenate untrusted input into shell commands;
- expose unrestricted Docker socket operations;
- accept arbitrary service names or filesystem paths.

Privileged operations should use:

- explicit operation types;
- registered resource identifiers;
- allowlists;
- controlled arguments;
- minimal operating-system permissions;
- audit events;
- timeouts and predictable failure handling.

Infrastructure changes involving `sudo`, systemd, PM2, Nginx, Docker,
Cloudflare, SSH, or firewall configuration require explicit approval.

## Service catalog

Resources controlled by Atlas Manager should be registered in a service
catalog instead of being accepted as arbitrary external input.

A registered service may describe:

- its stable identifier;
- its display name;
- its management adapter;
- its external resource identifier;
- supported operations;
- health-check configuration;
- dependencies;
- availability mode;
- schedule configuration.

Database engines are treated as Docker-managed services in the initial release.

The service catalog must not provide logical PostgreSQL or MongoDB
administration unless a future requirement explicitly introduces it.

## Scheduling

Scheduling should trigger application use cases rather than call infrastructure
adapters directly.

This ensures that scheduled and manually requested operations follow the same:

- authorization rules;
- dependency rules;
- validation;
- event recording;
- error handling.

Planned availability modes include:

- `always`;
- `scheduled`;
- `manual`;
- `disabled`.

Temporary overrides should take precedence according to explicit application
rules and must include a defined expiration or cancellation condition.

The application timezone is expected to be `America/Sao_Paulo`, but timezone
handling must be configured explicitly rather than inferred from the host.

## Dependency-aware orchestration

Registered services may depend on other registered services.

Startup should generally occur in dependency order:

```text
dependency
    |
    v
dependency health confirmation
    |
    v
dependent service
```

Shutdown should generally occur in the reverse order:

```text
dependent service
    |
    v
dependency
```

Dependency traversal must detect invalid configurations such as cycles or
missing resources.

Infrastructure adapters must not independently start additional dependencies.
That responsibility belongs to the application orchestration logic.

## Persistence

The initial project does not yet have a selected persistence implementation.

When persistence is introduced:

- application logic should depend on repository ports;
- persistence-specific models must remain in infrastructure code;
- migrations or schema changes must be versioned;
- secrets must remain outside the repository;
- the chosen technology should be recorded through an ADR when appropriate.

## Cross-cutting concerns

### Configuration

Environment variables and external configuration must be validated when the
application starts.

The application should fail early when required configuration is invalid.

### Logging

Pino is approved for structured application logging.

Logs should include useful operational context without exposing secrets or
sensitive values.

### Event history

Administrative and automated operations should eventually generate structured
events containing information such as:

- operation type;
- target resource;
- source of the operation;
- timestamp;
- result;
- safe error information.

Event history is not a replacement for application logs. It represents
user-relevant administrative actions.

### Authentication and authorization

Authentication and authorization remain separate requirements for privileged
administration. ADR-003 accepts project-owned application authorization and
rejects controller-only, adapter-owned, and caller-selected roles or actors.
The current protected HTTP delivery verifies Cloudflare Access assertions,
maps trusted local role assignments to fixed permissions, and audits each
decision before target invocation. Human dashboard identities and CLI service
principals use the same policy while retaining distinct audit actor prefixes.
Missing configuration or credentials still follow the deny-all default.

## Testing strategy

### Domain tests

Domain rules should be tested without Express, infrastructure, or external
services.

### Application tests

Application use cases should be tested using fake or in-memory implementations
of their required ports.

These tests should verify orchestration, policies, dependency order, and error
handling.

### HTTP integration tests

HTTP routes should be tested through the Express application using Supertest.

These tests should verify:

- request validation;
- response status codes;
- response structures;
- error mapping.

### Infrastructure integration tests

Infrastructure adapters should be tested separately where practical.

Tests that require Docker, PM2, systemd, or operating-system capabilities must
be clearly identified and must not run unexpectedly as ordinary unit tests.

## Illustrative source organization

The following structure is illustrative and may evolve through implementation
and ADRs:

```text
src/
├── main.ts
├── application/
├── features/
│   ├── health/
│   ├── services/
│   ├── scheduling/
│   ├── docker/
│   ├── power/
│   ├── backups/
│   └── events/
├── infrastructure/
├── http/
└── shared/
```

The final structure should be introduced incrementally.

Directories should not be created before they have a concrete responsibility.

## Non-goals

The initial architecture does not aim to provide:

- independent microservices;
- unrestricted remote shell access;
- a generic Docker administration platform;
- logical database administration;
- distributed event processing;
- abstractions for hypothetical integrations without current requirements.

## Architectural evolution

Architecture should evolve in response to demonstrated requirements.

A major change should be recorded through a new Architecture Decision Record
when it affects:

- framework selection;
- architectural style;
- persistence technology;
- authentication strategy;
- privilege boundaries;
- deployment topology;
- communication between major modules.

Existing ADRs should not be rewritten to hide previous decisions. A new ADR
should supersede an earlier decision when necessary.

### Cloudflare Access administrative identity boundary

ADR-004 selects one request-scoped, application-side Cloudflare Access JWT
verification boundary without adding an administrative route:

```text
Cloudflare Access
        ↓
HTTP assertion reader
        ↓
request-scoped authentication provider
        ↓
shared RS256 verifier and bounded JWKS provider
        ↓
AdministrativePrincipal
        ↓
existing protected administration
```

HTTP delivery owns raw header extraction. Access-control application code
receives only a narrow assertion-reader port and never receives an Express
request, cookie, session, or arbitrary headers. The issuer and JWKS URL are
derived from trusted configuration; callers cannot select them. Infrastructure
adapters verify identity and retrieve keys, but do not assign roles or make
authorization decisions. Construction is lazy, and no route consumes the
Cloudflare foundation unless the explicit administrative event-history
configuration is complete.

### Protected administrative event-history delivery

Issue #240 adds the first protected administrative HTTP route, while keeping
the target operation read-only:

```text
Express event-history handler
        ↓
request-scoped Cloudflare assertion reader
        ↓
request-scoped authentication provider
        ↓
request-scoped access-control composition
        ↓
protected administration facade
        ↓
shared file-backed event history
```

`GET /admin/event-history` is not registered by default. Explicit activation
requires the loopback host, Cloudflare Access settings, a persistent event
history path, and trusted role assignments. The handler parses the raw query
string, enforces URL/body bounds, then creates the request-scoped provider and
calls only `getAdministrativeEventHistory` on the protected facade. It does
not import or invoke the event-history reader directly.

Authorization is recorded in the same event-history instance before the query,
so a successful authorization event can be included in its own response. The
handler maps only strict event fields and applies a 60-per-60-second global
process-local admission limit, four-request concurrency limit, a 1 MiB
response bound, and restrictive no-store response headers. It does not enable
Express `trust proxy`, use client IPs, add CORS, expose a bearer challenge, or
register power-management routes. Health routes remain independent of this
composition and of Cloudflare or event-history availability.

### Protected wake-alarm delivery

Issue #242 adds the bounded mock-first wake-alarm resource:

```text
wake-alarm HTTP handler
        ↓
request-scoped Cloudflare provider
        ↓
request-scoped access control
        ↓
protected administration facade
        ↓
shared mock-first power composition
        ↓
shared persistent event history
```

`GET`, `PUT`, and `DELETE /admin/power/wake-alarm` are registered only when
`ADMINISTRATIVE_WAKE_ALARM_HTTP_ENABLED=true`. Both administrative routes
share one clock, verifier/JWKS cache, role reader, event-history store, power
composition, global admission, and wake mutation gate. Each request still
creates its own assertion reader, authentication provider, access control, and
protected facade. Handlers invoke only operation-specific protected
capabilities and never call power adapters directly.

GET uses the protected authorization timestamp for the wake observation. PUT
and DELETE preserve authorization, started, effect, and terminal event order.
A terminal audit failure leaves mock state authoritative and requires a later
GET recheck; no retry or rollback is performed. No RTC hardware or machine
power effect is enabled.

### External helper executable foundation

ADR-005 implements the executable side of the existing fixed transport as a
separate `power-helper/` Go module. The intended deployment boundary is:

```text
unprivileged Atlas Manager
        ↓ fixed no-argument transport
/usr/local/libexec/atlas-manager-power-helper
        ↓ deny-all version-one backend
operation_unsupported
```

The compiled helper is intended to be root-owned, executable by the dedicated
`atlas-manager-power` group, setuid-root, and mode `04750`. Its process model
is one request per process. Startup checks reject non-Linux, non-root, wrong
identity, and argument-bearing execution; request parsing is bounded and
rejects duplicate fields, unknown fields, noncanonical timestamps, CRLF,
multiple lines, and trailing data. Invalid input and startup failures never
write diagnostics.

The application-side installation inspector checks the exact mode, root
ownership, nonzero group, process group membership, and root-owned safe parent
directory. It does not repair state. No installation command, setuid change,
helper wiring, or real backend is included. CI builds the Linux artifact only
under the ignored `dist/power-helper/` directory.

### Read-only Linux RTC backend

ADR-006 adds the first real helper backend without changing application
composition:

```text
fixed helper protocol
        ↓
Linux read-only backend
        ↓
/sys/class/rtc/rtc0/since_epoch
/sys/class/rtc/rtc0/wakealarm
```

The backend verifies the fixed `/sys` mount, exposes no generic path reader,
opens attributes read-only, bounds reads to 128 bytes, and validates RTC time
against one injected system-clock interval with 300 seconds of tolerance.
Missing RTC support is unsupported; malformed or uncertain state is
`state_unavailable`. Only the two read operations are implemented. The three
mutation operations remain deny-all, and the backend is not wired into the
Node.js power-management composition. A separate test executable injects
fixed deterministic results for TypeScript/Go compatibility without reading
CI hardware.

### Linux wake-alarm mutation backend

ADR-007 extends the fixed helper backend for the two safe mutation operations:

```text
exclusive fixed lock
        ↓
validated RTC time and current wake state
        ↓
bounded absolute epoch write to fixed wakealarm
        ↓
read-after-write verification
        ↓
typed mutation response
```

Reads use a shared lock; schedule and cancel use an exclusive nonblocking lock
at `/run/atlas-manager-power-helper.lock`. Scheduling the same value performs
no write. Replacement writes `0\n`, verifies absence, then writes the new
value under one lock. A failed replacement is not rolled back or retried.
The production helper still does not implement shutdown, and the Node.js
application continues using its mock-first composition.

### Systemd-logind shutdown backend

Issue #252 extends only the standalone helper:

```text
fixed exclusive operation lock
        ↓
fixed system-bus socket inspector
        ↓
private EXTERNAL-authenticated D-Bus connection
        ↓
org.freedesktop.login1.Manager.PowerOff(false)
        ↓
typed accepted or safe failure response
```

The requester owns a narrow project interface and hides concrete D-Bus types.
The bus address, destination, object, interface, method, argument, and
deadline are constants. No D-Bus work occurs after lock rejection, and the
requester performs no RTC access. The production Node.js composition remains
mock-first by default. ADR-011 provides a separate explicit composition gate
for selecting the complete Linux adapter bundle; construction remains frozen
and does not inspect or invoke the helper. HTTP route flags and scheduler
activation remain independent.

### Linux host qualification

Issue #256 adds a separate root-run but read-only host qualification utility
with exactly three actions: `qualify`, `verify-disabled-installation`, and
`verify-removed`. Its report uses closed structs, fixed check ordering,
bounded JSON, and only safe OS, kernel, architecture, and hashed-boot facts.

Qualification reads fixed resources, reuses the 300-second RTC alignment rule,
checks the root-owned system-bus socket, and performs only the private
two-second D-Bus checks `NameHasOwner`, introspection, and `CanPowerOff`.
It never creates locks, writes sysfs, invokes the helper, calls `PowerOff`,
changes groups, or changes installation state. A passing report approves only
a disabled installation with an empty helper group.

### Production-shaped power composition

ADR-011 selects the complete power-management infrastructure atomically. The
default `mock` selector constructs the existing mock readers and controllers.
The exact `linux_helper` selector creates one frozen bundle containing the
fixed-path transport, installation inspector, RTC reader, wake reader, wake
controller, and machine-shutdown controller; all four adapters share that
transport. Composition performs no helper request and does not fall back to
mock when the selected helper is unavailable or rejects an operation.

The Linux shutdown adapter reports `accepted` only when the helper reports a
successful systemd-logind `PowerOff(false)` reply. It never claims that the
machine completed power-off. Installation, empty-group qualification,
application-user enrollment, HTTP activation, scheduler activation, and
real-effect certification remain separate deployment gates.

### Configured machine operating policy

ADR-012 adds one immutable startup input, `MACHINE_OPERATING_POLICY`, with a
safe `always_on` default. A project-owned strict JSON decoder rejects duplicate
keys and malformed or oversized values before the existing machine operating
policy domain validator canonicalizes the result. The administrative runtime
passes that policy to `createPowerManagement` once; plan evaluation and
explicit scheduler ticks share the same canonical policy.

Policy configuration does not select the Linux helper, enable HTTP routes, or
start a scheduler. Parsing and composition perform no plan execution, helper
request, RTC access, D-Bus request, wake mutation, shutdown, lock creation, or
background work.

ADR-033 later added a separately persisted policy for CLI/dashboard/API CRUD
and candidate preview. That persisted value is authoritative for what an
operator reads and edits, but it intentionally does not flow into
`createPowerManagement`, the scheduler confirmation reader, or any physical
effect. Selecting the future scheduler authority requires a new activation
decision; the distinction is not an implicit live reload.

### Policy-bound scheduler confirmation

ADR-013 keeps scheduler authorization source-specific. The scheduler receives
one confirmation reader built from the same immutable policy used for
occurrence generation. The reader regenerates the one-minute interval ending
at the candidate shutdown and confirms only one exact matching occurrence.

Direct occurrence execution and administrative HTTP execution do not inherit
this authority. Readiness still owns due, stale, service, task, backup,
filesystem, event-recording, and preparation decisions. The scheduler remains
an explicitly invoked tick; no lifecycle loop or timer is configured.

### Machine-power scheduler lifecycle

ADR-014 adds a separate lifecycle around the existing explicit machine-power
scheduler tick. `MACHINE_POWER_SCHEDULER_ENABLED` accepts only exact `true` or
`false` and defaults to `false`. Enabled operation requires persistent cursor,
permanent claim, and event-history files. A one-shot Node timer waits exactly
60 seconds after each continuing tick; the first tick starts only after HTTP
listening, and no ticks overlap. Blocked, incomplete, conflict, and failure
outcomes stop the application through bounded coordinated shutdown.

The scheduler and administrative power surfaces share one immutable production
power capability bundle and event-history bundle. Route activation, helper
backend selection, and policy selection remain independent. No scheduler loop,
helper request, or real power effect is created by default.

### Linux power-effects startup admission

ADR-015 adds a startup admission boundary after environment parsing and before
power composition, HTTP server creation, or scheduler startup. The default
MACHINE_POWER_EFFECTS_ACTIVATION=disabled is immutable. Linux effects require
the exact activation value, explicit operator confirmation, an exact reviewed
installed-helper SHA-256, and one read-only preflight through the fixed
installation inspector.

The preflight uses Node's built-in streaming SHA-256 support and validates the
fixed helper path, regular-file identity, root ownership, non-root group,
04750 mode, setuid bit, single hard link, safe parent directories, process
group membership, and digest. It makes no helper protocol request and does not
touch RTC, wake-alarm, D-Bus, group, ownership, or permission state. Failure
prevents HTTP listening and scheduler startup; it never falls back to mock.

Backend selection, effect-capable surface activation, machine policy,
scheduler activation, HTTP authentication/authorization, request confirmation,
policy confirmation, readiness, host qualification, user enrollment, and
real-effect certification remain independent gates.

### Exact Linux runtime identity admission

ADR-016 extends Linux power-effects admission with a fixed runtime identity
contract. The process must resolve to `atlas-manager`, primary group
`atlas-manager`, home `/var/lib/atlas-manager`, shell
`/usr/sbin/nologin`, and membership in `atlas-manager-power`. UID and GID
values are host-assigned facts, but they must be positive, non-root, equal
across real/effective APIs, and unambiguous in the fixed local account files.

The identity inspector reads only bounded, root-owned, non-writable
`/etc/passwd` and `/etc/group` files through injectable infrastructure. It
does not use NSS commands, environment usernames, shells, or account
mutation. The admitted helper-group GID is passed to both startup preflight
and operation-time installation inspection, so another non-root group cannot
substitute for `atlas-manager-power`.

Disabled, mock, and inert Linux configurations do not inspect account files.
Identity failure happens before helper hashing, power composition, HTTP
creation, and scheduler startup. Account creation, group enrollment, systemd
configuration, deployment, host qualification, and real-effect certification
remain separate gates.

### Reproducible disabled application deployment

The application deployment boundary is separate from `power-helper/`. The
`deployment/` Go module builds an isolated TypeScript payload and production
npm tree, validates a closed manifest, and emits a normalized Linux amd64
archive. Its installer uses fixed paths, fixed Node.js `/usr/bin/node`, the
exact `atlas-manager` identity, and a nonblocking deployment lock. It installs
only a disabled unit and template; it does not enable systemd, create the real
environment, execute Atlas, or install the helper.

ADR-035 separates the systemd privilege profiles. The installed default is a
mock-only unit with `NoNewPrivileges=true`, `RestrictSUIDSGID=true`, and no
`atlas-manager-power` supplementary group. A separately checksummed
power-enabled template is an explicit future input and is never selected by
the current installer or mock lifecycle. Neither profile sets any ADR-015
activation variable.

### Read-only deployment qualification

ADR-018 adds a separate Go qualification executable beside the deployment
installer. Its four actions inspect the fixed Linux amd64 deployment contract
and produce bounded canonical JSON. The qualifier reuses bundle, identity,
manifest, systemd, and managed-release rules without acquiring the installer
lock or invoking installer actions. It may run only the fixed
`/usr/bin/node --version` check; it never executes Atlas Manager, npm,
systemd commands, the helper, RTC, or D-Bus.

### Operator-controlled runtime identity preparation

ADR-019 adds a separate Go executable for the only reviewed identity-creation
transaction. It accepts only `inspect`, `prepare-disabled`, and
`verify-managed`; preparation requires root, Linux amd64, exact confirmation,
valid bundle/host preconditions, and a completely absent identity state. It
uses fixed account-management binaries without a shell, writes a private
transaction journal before mutation, verifies every transition, and rolls
back only resources created by the current failed attempt. The helper group
remains textually empty and no home, deployment, service, configuration,
helper, or power state is created.

### Deterministic disabled deployment rehearsal

ADR-020 adds test-only integration infrastructure in
\`deployment/internal/rehearsal\`. It composes the existing production
qualification, identity preparation, installer, release switching, rollback,
uninstall, and verification packages over one synthetic Linux amd64 host with
injected account commands, Node.js, systemd, filesystem, and capacity
observations. Two valid releases are built through the existing bundle builder.

The rehearsal snapshots the sandbox before and after every step and enforces
exact mutation allowlists. It emits bounded canonical evidence with report
digests and a deterministic hash chain. It is not a production command and
never reads the real account database, invokes account tools or systemd,
executes the application or helper, or accesses RTC or D-Bus.

### Mock-only production activation readiness

ADR-021 adds two separate operator boundaries after disabled installation. The
runtime-configuration tool installs only the fixed mock-first environment,
validated by the real TypeScript parser. The service-lifecycle tool controls
only the fixed systemd unit and verifies loopback health, route absence, and
the dedicated runtime identity. Both use fixed paths, exact confirmations,
private state, nonblocking locks, and bounded reports. Activation is reversible
and does not install the helper, enable the scheduler, or expose administrative
routes.
