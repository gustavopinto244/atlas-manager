# Atlas Manager — High-Level Architecture

## Document purpose

This document describes the intended high-level software architecture of Atlas
Manager.

It defines architectural boundaries, dependency rules, integration patterns,
and security principles that should guide implementation.

This document does not represent a complete implementation. Atlas Manager is
currently in its foundation phase, and most feature modules described here have
not been created yet.

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
helper source is implemented separately by Issue #246 but is not installed or
production-wired in this slice. Default power-management
composition remains mock-first and production activation is gated by ADR-002
authentication, authorization, confirmation, auditing, deployment, and
security-review prerequisites.

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
not claimed.

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

Authentication creates an immutable UUID-only principal. Authorization maps one
explicit operation to one fixed permission and reads trusted role assignments
exactly once. The default authenticator denies all requests and unknown or
unavailable role data fails closed. Authorization events are stored through the
same event-history boundary before a target capability runs.

Power-management and event-history adapters do not receive credentials, roles,
permissions, sessions, or authorization policy. Verified authenticated actors
are constructed internally as `administrator:<principalId>`; callers cannot
provide actor fields. Scheduler-generated occurrence events remain
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

The current `src/main.ts` is only a bootstrap validation entry point. It does
not yet implement the final composition root.

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

Authentication and authorization are separate requirements before exposing
privileged administrative operations. ADR-003 accepts project-owned
application authorization and rejects controller-only, adapter-owned, and
caller-selected roles or actors. The current implementation is mock-first:
authentication has a deny-all default, authorization uses fixed roles and
permissions, and every protected decision is audited before target invocation.
Production identity verification, protected HTTP delivery, transport security,
and deployment validation remain deferred.

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
