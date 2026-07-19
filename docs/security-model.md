# Atlas Manager — Security Model

## Document purpose

This document defines the initial security model for Atlas Manager.

Atlas Manager is expected to monitor and control resources on the Atlas host
server. Some planned operations may affect processes, containers, system
services, files, backups, schedules, and the host power state.

Because these capabilities can affect the availability and integrity of the
server, security must be considered part of the architecture rather than an
optional feature added after implementation.

This document provides security principles and boundaries. It does not replace
detailed requirements, implementation-specific threat analysis, automated
tests, or deployment review.

Relevant documents include:

- `docs/requirements.md`;
- `docs/architecture.md`;
- `docs/glossary.md`;
- `docs/roadmap.md`;
- accepted Architecture Decision Records.

## Security objectives

Atlas Manager should protect:

- the availability of the Atlas host;
- the integrity of managed services;
- the confidentiality of credentials and configuration;
- the integrity and availability of backups;
- the accuracy of administrative events;
- access to privileged administrative operations;
- the reliability of schedules and orchestration;
- the privacy of system information exposed by the API.

The application should provide only the authority required for its approved
responsibilities.

## Protected assets

### Host availability

Atlas must remain available according to its intended operating schedule.

Operations that may stop processes, containers, services, or the host itself
must be controlled and auditable.

### Managed services

Registered services must not be started, stopped, restarted, inspected, or
modified by unauthorized clients.

Atlas Manager should control only explicitly registered resources.

### Host operating system

The application must not expose unrestricted access to:

- shell execution;
- systemd;
- PM2;
- Docker;
- the filesystem;
- RTC configuration;
- process management;
- power-management facilities.

### Credentials and secrets

Protected secrets may include:

- authentication secrets;
- access tokens;
- private keys;
- Cloudflare credentials;
- database credentials;
- session secrets;
- service credentials;
- backup destination credentials;
- production environment values.

Secrets must not be committed, logged, returned through HTTP responses, or
stored in administrative events.

### Configuration

Configuration defines which resources and operations Atlas Manager may access.

Unauthorized modification of configuration could expand application
privileges.

Security-sensitive configuration includes:

- registered service identifiers;
- external resource identifiers;
- supported operations;
- filesystem paths;
- backup destinations;
- schedule definitions;
- dependency relationships;
- adapter configuration;
- authorization policies.

### Backups

Backups may contain application data, configuration, or sensitive information.

Backup operations must protect:

- source integrity;
- destination control;
- access permissions;
- failure reporting;
- retention rules;
- restoration availability.

### Administrative history

Administrative events must accurately represent operations attempted or
performed by Atlas Manager.

Events must not be silently altered to conceal actions or failures.

## Trust boundaries

### External client boundary

HTTP clients are outside the trusted application boundary.

All request data must be treated as untrusted, including:

- URL parameters;
- query parameters;
- headers;
- cookies;
- request bodies;
- uploaded data;
- client-provided identifiers.

A client must not gain infrastructure access merely by knowing a process,
container, service, or filesystem name.

### HTTP delivery boundary

Express routes and controllers translate external requests into application
operations.

The delivery layer is responsible for:

- validating request syntax;
- identifying the authenticated client;
- requesting authorization;
- limiting request size;
- mapping safe results and errors.

The delivery layer must not directly execute privileged infrastructure
operations.

### Application boundary

The application layer decides whether an operation is permitted according to
project rules.

It coordinates:

- resource registration;
- supported operations;
- dependency order;
- availability policies;
- authorization;
- event recording;
- infrastructure adapters.

Application use cases should accept project-defined values rather than raw
commands or unrestricted external identifiers.

### Infrastructure boundary

Infrastructure adapters interact with Docker, PM2, systemd, Linux interfaces,
filesystems, backup tools, or other external systems.

Adapters must expose only the narrow capabilities required by Atlas Manager.

An adapter must not make unrestricted external-system APIs available to HTTP
controllers.

### Host privilege boundary

The Node.js process must run as an unprivileged user.

Operations requiring additional host permissions must use narrowly scoped and
reviewed mechanisms.

The application must not receive general root access.

## Security principles

### Least privilege

Each application component and operating-system identity should receive only
the permissions required for its approved responsibilities.

Examples include:

- limiting readable and writable paths;
- limiting controllable services;
- limiting available systemd operations;
- limiting Docker operations;
- separating privileged helpers from the HTTP process;
- avoiding unnecessary group membership.

### Explicit resource registration

Atlas Manager must control only resources that are explicitly registered.

External clients should use stable project-defined service identifiers.

Clients must not supply unrestricted:

- process names;
- container names;
- systemd unit names;
- commands;
- executable paths;
- filesystem paths;
- backup destinations.

### Deny by default

An operation that is not explicitly supported should be rejected.

The presence of a capability in Docker, PM2, systemd, or the operating system
does not automatically make it available through Atlas Manager.

### Validate at boundaries

External data must be validated when entering the application.

Validation should cover:

- expected data types;
- accepted formats;
- length limits;
- allowed values;
- required fields;
- unknown fields when appropriate.

Syntax validation does not replace authorization or application rules.

### Safe failure

Unexpected failures must not expose:

- stack traces;
- credentials;
- tokens;
- internal commands;
- private filesystem paths;
- raw infrastructure errors;
- environment values;
- sensitive host information.

Detailed diagnostic information belongs in protected logs, not public API
responses.

### Auditable administration

Security-sensitive operations should generate structured administrative
events.

An event should identify safe information such as:

- operation type;
- registered target;
- operation source;
- timestamp;
- authorization result;
- operation result;
- safe error category.

## Command execution

Atlas Manager must never expose arbitrary command execution.

The application must not:

- accept an executable command through HTTP;
- accept an unrestricted command argument list;
- concatenate untrusted input into shell commands;
- use `eval` or equivalent dynamic execution;
- expose a generic terminal endpoint;
- provide unrestricted script execution;
- pass client-provided values to a shell interpreter.

Prefer direct library or process APIs that avoid shell parsing.

When an external executable is genuinely required:

- the executable must be selected by application code;
- arguments must be constructed from controlled values;
- identifiers must resolve through registered configuration;
- execution must use a timeout;
- output must be bounded;
- errors must be translated safely;
- the operation must be auditable.

Shell execution should be avoided when a safer direct API exists.

## Privileged operations

Privileged operations include actions that can affect:

- processes;
- containers;
- system services;
- host power;
- wake scheduling;
- protected files;
- backups;
- deployment configuration.

Each privileged operation must have:

- an explicit application use case;
- an explicit authorization policy;
- a registered target;
- a narrow port interface;
- a controlled adapter;
- predictable arguments;
- timeout behavior;
- safe error translation;
- administrative event recording.

A privileged adapter must not decide whether a client is authorized.

Authorization belongs before the adapter invocation.

## Docker security

Access to the Docker daemon is highly privileged.

Possession of unrestricted Docker socket access can provide extensive control
over the host.

Atlas Manager must not expose the Docker API directly to clients.

Docker operations must be limited to approved project capabilities such as:

- retrieving approved container status;
- starting a registered container;
- stopping a registered container;
- restarting a registered container;
- retrieving approved health information;
- reading bounded and approved logs.

The initial release must not provide:

- arbitrary image execution;
- arbitrary container creation;
- arbitrary volume mounting;
- arbitrary host-path mounting;
- unrestricted Docker commands;
- unrestricted Docker Compose execution;
- arbitrary environment-variable injection;
- generic Docker administration.

The final Docker access mechanism requires security review before deployment.

## PM2 and systemd security

PM2 and systemd adapters must operate only on registered resources.

Clients must not supply unrestricted PM2 process names or systemd unit names.

Supported actions should be explicit and may include:

- status;
- start;
- stop;
- restart.

Operations such as creating new units, modifying unit files, enabling unknown
services, or changing deployment configuration remain outside ordinary
service-control APIs.

## Filesystem security

Filesystem operations must use controlled paths.

The application must not accept arbitrary client-provided paths.

Approved paths should be:

- defined in trusted configuration;
- normalized before use;
- checked against approved root directories;
- protected against directory traversal;
- accessed with minimal operating-system permissions.

Symbolic links and path resolution must be considered when protecting file
boundaries.

Sensitive files must not be exposed through logs or API responses.

## Backup security

Backup operations can read large or sensitive portions of the system.

Backup targets and destinations must be registered or explicitly configured.

The application must not allow clients to supply arbitrary:

- source paths;
- destination paths;
- storage credentials;
- executable backup commands;
- retention commands.

Backup output and failure messages must be filtered before exposure.

Backups containing sensitive data should use appropriate access permissions and
encryption when required.

Backup success must not be assumed merely because a process exited without a
visible error. Validation requirements should be defined for each backup type.

## Power-management security

Shutdown and wake operations can make Atlas unavailable.

Power operations require:

- explicit authorization;
- controlled scheduling;
- validation of requested times;
- conflict handling;
- cancellation behavior;
- audit events;
- protection against accidental repeated execution.

The Node.js application must not run as root to perform these actions.

A narrowly scoped host mechanism should perform only the approved power
operations.

The API must not accept arbitrary shutdown commands or unrestricted RTC values.

## Authentication

Authentication must be implemented before privileged administrative operations
are exposed beyond a trusted development environment.

The selected mechanism must be documented through an ADR before
implementation.

Authentication should protect against:

- credential disclosure;
- session theft;
- replay where relevant;
- weak secret storage;
- insecure transport;
- unauthenticated administrative access.

Production administrative access must use HTTPS.

## Authorization

Authentication confirms identity. Authorization determines whether an identity
may perform a specific operation.

Authorization decisions should consider:

- operation type;
- registered resource;
- supported operation;
- client identity;
- administrative role or permission;
- current service policy;
- operation source.

The application should deny operations when authorization cannot be
established.

Infrastructure adapters must not be responsible for user-level authorization.

## Network exposure

Atlas Manager should expose only the required network interfaces and ports.

Deployment must consider:

- Nginx reverse-proxy behavior;
- Cloudflare Tunnel configuration;
- trusted proxy settings;
- HTTPS enforcement;
- origin exposure;
- firewall rules;
- CORS configuration;
- request-size limits;
- rate limiting;
- internal-only endpoints.

A Cloudflare Tunnel does not remove the need for application authentication and
authorization.

Network and proxy configuration changes require explicit review.

## Cross-origin access

CORS must use an explicit allowlist in deployed environments.

The application must not use a permissive origin configuration for privileged
administrative endpoints without a reviewed requirement.

CORS is a browser control and must not be treated as authentication or
authorization.

## Request limits and abuse protection

Administrative endpoints should define appropriate limits for:

- request body size;
- query size;
- header size;
- operation frequency;
- repeated authentication attempts;
- log retrieval size;
- pagination size;
- concurrent privileged operations.

Rate limiting may be required for remotely accessible endpoints.

Rate limiting does not replace authorization.

## Conflicting and repeated operations

Administrative operations may conflict or overlap.

Examples include:

- starting and stopping the same service concurrently;
- restarting a service while dependency startup is in progress;
- scheduling shutdown while a backup is running;
- submitting duplicate backup requests;
- issuing repeated power operations.

Application use cases should define predictable behavior for conflicting
operations.

Where required, the application may use:

- operation locks;
- idempotency rules;
- state checks;
- conflict responses;
- cancellation rules.

These mechanisms must be introduced for concrete use cases rather than as
unnecessary general abstractions.

## Input validation

Zod is approved for boundary validation.

Validation should be applied to:

- environment variables;
- HTTP parameters;
- request bodies;
- external configuration;
- persisted data read from external sources.

Validation schemas should:

- reject invalid types;
- enforce length limits;
- restrict enumerated values;
- reject malformed identifiers;
- reject unexpected data when appropriate;
- produce safe error details.

Validated input must still be checked against registered resources and
authorization policies.

## Configuration and secrets

Secrets must remain outside the Git repository.

The repository may include `.env.example` files containing only safe placeholder
values and variable names.

Production configuration should:

- use appropriate filesystem permissions;
- avoid world-readable secret files;
- separate secrets from ordinary documentation;
- validate required values at startup;
- fail early when security-critical configuration is missing;
- avoid printing secret values during startup.

Secret rotation should be possible without changing source code.

## Logging

Pino is approved for structured logging.

Logs should provide enough context for diagnosis without exposing sensitive
information.

Logs must not include:

- plaintext credentials;
- authentication tokens;
- session identifiers when unsafe;
- private keys;
- full environment dumps;
- unrestricted request bodies;
- sensitive backup content;
- secret configuration values.

Log fields derived from external input may require sanitization or size limits.

Production logs should use controlled retention and access permissions.

## Administrative events

Administrative events represent user-relevant or automated operations.

They should remain distinct from low-level diagnostic logs.

Events may record:

- operation type;
- registered target;
- source;
- timestamp;
- success or failure;
- safe error category.

Events must not contain secrets or unrestricted command output.

Security-sensitive operations should produce events even when rejected, when
doing so does not create excessive abuse data.

## Error handling

Expected failures should be represented by project-defined errors.

HTTP responses should expose stable and safe information.

For example, clients may receive:

- resource not found;
- operation not supported;
- operation not permitted;
- dependency unavailable;
- conflict;
- validation failure;
- service temporarily unavailable;
- internal error.

Raw Docker, PM2, systemd, filesystem, or shell errors must not be returned
directly.

Unexpected failures should be logged with a correlation identifier when
appropriate.

## Dependency security

Dependency additions and upgrades require review.

Review should consider:

- maintenance status;
- release history;
- security advisories;
- required permissions;
- transitive dependencies;
- compatibility with supported runtimes;
- whether a smaller or built-in alternative exists.

Options such as `--force` or `--legacy-peer-deps` must not be used merely to
hide unresolved compatibility problems.

Lockfile changes must be reviewed.

## Testing security-sensitive behavior

Security-relevant behavior should be covered through automated tests where
practical.

Examples include:

- rejection of unknown service identifiers;
- rejection of unsupported operations;
- request validation;
- authorization failures;
- dependency-cycle detection;
- path-boundary checks;
- safe error responses;
- timeout behavior;
- duplicate-operation handling;
- redaction of sensitive log fields.

Infrastructure integration tests must not unexpectedly perform real privileged
operations.

Tests requiring Docker, PM2, systemd, power management, or host filesystem
access must be explicitly isolated and documented.

## Deployment security

The deployed application should:

- run as a dedicated unprivileged user;
- use only required filesystem permissions;
- expose only required ports;
- use HTTPS for remote administration;
- validate configuration during startup;
- avoid storing secrets in the repository;
- protect logs and configuration files;
- use controlled service restarts;
- support recovery and rollback;
- restrict privileged helper capabilities.

Deployment configuration involving PM2, systemd, Nginx, Docker, Cloudflare,
SSH, firewall rules, or operating-system permissions requires explicit review.

## Security review triggers

Additional security review is required when a change introduces or modifies:

- authentication;
- authorization;
- secret storage;
- privileged operations;
- shell or process execution;
- Docker access;
- filesystem writes;
- backup execution;
- power management;
- external network exposure;
- proxy configuration;
- environment configuration;
- sensitive logging;
- new dependencies with elevated access;
- deployment permissions.

Major security-boundary changes may require a new ADR.

## Incident considerations

Future operational documentation should define how to respond to events such
as:

- credential exposure;
- unauthorized administrative access;
- suspicious privileged operations;
- damaged or missing backups;
- unexpected host shutdown;
- compromised service credentials;
- malicious dependency discovery.

Initial response priorities should include:

1. limit further access;
2. preserve safe diagnostic evidence;
3. rotate exposed credentials;
4. verify host and managed-service integrity;
5. restore trusted operation;
6. document the incident and required improvements.

Detailed incident-response procedures will be added when deployment and
authentication mechanisms are defined.

## Security non-goals

Atlas Manager is not intended to provide:

- a general remote shell;
- unrestricted Docker administration;
- arbitrary process execution;
- arbitrary filesystem browsing;
- generic systemd administration;
- generic database administration;
- protection for a host that is already fully compromised;
- replacement for operating-system updates and security controls;
- replacement for secure network and identity configuration.

## Responsibilities

The contributor is responsible for:

- understanding the security impact of a change;
- following the documented boundaries;
- reviewing generated code;
- validating staged changes;
- avoiding secrets in commits;
- requesting review for privileged behavior.

Coding agents may assist with implementation but may not independently approve
security-sensitive architecture or deployment changes.

## Security-model maintenance

Update this document when:

- trust boundaries change;
- a privileged capability is introduced;
- authentication or authorization is selected;
- deployment topology changes;
- new protected assets are introduced;
- an incident reveals a missing control;
- an ADR changes a security assumption.

Security documentation must remain consistent with accepted ADRs and formal
requirements.
