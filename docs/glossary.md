# Atlas Manager — Project Glossary

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

The current operational state reported for a registered service.

Possible status values will be defined during implementation and may differ
between service-management technologies.

Infrastructure-specific values should be translated into project-defined
status models.

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

### Wake alarm

A hardware or operating-system mechanism used to request that Atlas starts at a
future time.

Atlas Manager may configure a supported RTC wake alarm through a controlled
adapter.

## Dependency terms

### Service dependency

A relationship indicating that one registered service requires another service
to be available or healthy.

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
