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

Authentication and authorization are required before exposing privileged
administrative operations outside a trusted development environment.

The exact mechanism has not yet been selected and should be documented before
implementation.

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
