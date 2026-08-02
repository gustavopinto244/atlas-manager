# Atlas Manager — Security Model

## Privileged helper installation

The helper installation boundary is deliberately separate from the Node.js
application. A reproducible Linux amd64 bundle is inspected and installed only
by an explicit operator action. The installer has no configurable root,
destination, bundle, or executable path and executes no child process. It
requires effective root for mutation, validates a pre-existing empty
`atlas-manager-power` group, and never edits account databases or enrolls an
application user.

The archive helper is not setuid. The installer applies exact root ownership,
group ownership, and mode `04750` only after checksum, manifest, parent,
candidate, and target validation, then atomically replaces the fixed path.
Unknown target state is rejected rather than adopted or repaired. Checksums
provide integrity checking but not authenticity; signatures, host
qualification, and production activation remain separate gates. CI uses
temporary sandbox trees and never writes privileged host paths or invokes the
helper.

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

### Protected shutdown boundary

Shutdown HTTP delivery is disabled by default and remains loopback-only. It
requires persistent event history, persistent occurrence claims and scheduler
cursor state, Cloudflare identity verification, and a trusted power-capable
role assignment. Authentication is request-scoped and authorization is audited
before preparation or execution effects.

Preparation and execution require different exact confirmations. A valid JWT,
an administrator or power-operator role, local access, or a previous
preparation request never supplies current execution confirmation. Execution
does not automatically prepare; it evaluates readiness again before claiming.

The occurrence claim is permanent. Wake scheduling precedes the simulated
shutdown request. If a later audit or effect fails, completed effects and the
claim remain authoritative; there is no retry, rollback, cancellation, or
compensation. HTTP returns a state-recheck error without exposing internal
results. No helper, RTC mutation, real shutdown, trusted proxy, client-IP
security, or CORS permission is enabled.

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

### Current administrative access-control foundation

ADR-003 defines the current fail-closed chain:

```text
authentication provider → principal → fixed policy → audited decision
→ protected operation → controlled adapter
```

The default provider returns `credentials_absent`; no implicit local
administrator exists. Principals contain only canonical lowercase UUIDs.
Exactly four roles and seven permissions are accepted, with a reviewed fixed
role-permission mapping. Unknown principals, unavailable role data, and policy
failures deny the operation. Callers cannot choose a principal, role,
permission, or audit actor.

Authorization events contain only the requested operation, mapped permission,
allow/deny decision, and safe reason code when denied. Credentials, tokens,
headers, role collections, provider errors, and unrestricted metadata are never
persisted. A failed authorization audit prevents the target operation. Explicit
shutdown confirmation remains a separate safeguard after authorization.

This is not production authentication. It adds no password, token, cookie,
session, identity-provider integration, HTTP middleware, or public route. Real
administrative exposure remains blocked until identity verification, protected
delivery, transport and deployment validation, recovery procedures, and rate-
limiting decisions are reviewed.

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

The current event-history boundary supports exactly the six state-changing
power operations and records immutable, structured entries with a generated
attempt ID, a store-assigned contiguous sequence, a trusted source, the Atlas
machine target, an application timestamp, a status, and operation-specific
safe details. Direct calls use `administrative/unattributed-local`; scheduler
calls use `automated/machine-power-scheduler`. This is not authenticated actor
attribution.

Each top-level operation records a durable `started` event before its first
state-changing effect and one terminal `succeeded`, `rejected`, or `failed`
event afterward. Readiness uses the same recorder/store boundary. If that
boundary is unavailable, safe shutdown readiness rejects before preparation,
claim acquisition, wake mutation, or shutdown.

Events may record:

- operation type;
- registered target;
- source;
- timestamp;
- success or failure;
- safe error category.

Events must not contain secrets or unrestricted command output.

The in-memory store is the default. Explicit file-backed history uses
canonical version-one JSON Lines, bounded lines and file size, owner-restricted
permissions, strict reconstruction, and bounded cursor queries. It is
append-only through the application contract but does not claim cryptographic
tamper evidence, cross-process locking, or protection from a compromised host.

If terminal recording fails after an effect, the effect is preserved and a
focused partial-effect error is returned. There is no retry, rollback, or
compensation. Persistent administrative auditing is an activation prerequisite
for future real power effects; authentication, authorization, and public event
delivery remain separate future work.

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

## Cloudflare Access identity verification

ADR-004 requires the application to independently verify a Cloudflare Access
application JWT before creating an administrative principal. Only the bounded
`Cf-Access-Jwt-Assertion` header is accepted; cookies and unsigned identity
headers are ignored. Verification is bound to the configured team issuer and
one exact application audience, accepts RS256 only, requires `type: app`, and
requires a canonical lowercase UUID `sub`. Empty subjects therefore cannot
authenticate service tokens as human administrators. Email is not an identity
or role-assignment input.

The fixed team JWKS endpoint is fetched with no credentials, no redirect
following, a five-second timeout, and a 65,536-byte streaming limit. Validated
keys are process-local and bounded, with ten-minute cache lifetime, one refresh
for an unknown key, concurrent refresh coalescing, and a thirty-second failed
fetch cooldown. Required-key or provider failures return the safe
`identity_provider_unavailable` outcome; they never authenticate or expose
provider details. Missing configuration preserves deny-by-default behavior.

The identity foundation alone is not a complete protected HTTP delivery
mechanism. The separate event-history route below is the first consumer; it
does not add sessions, cookie authentication, trusted-proxy policy, helper
activation, or real machine effects.

## Protected administrative event-history HTTP delivery

Issue #240 introduces one explicitly gated read-only route:
`GET /admin/event-history`. The route is registered only when
`ADMINISTRATIVE_EVENT_HISTORY_HTTP_ENABLED=true` and all trusted deployment
configuration is valid. Enabled delivery requires the exact loopback host
`127.0.0.1`, Cloudflare Access settings, a distinct absolute persistent event
history path, and role assignments that include `event_history.read`.

The request order is deliberately fixed:

```text
admission limits
        ↓
method, URL, and body bounds
        ↓
strict query validation
        ↓
request-scoped authentication
        ↓
authorization audit event
        ↓
bounded event-history query
        ↓
explicit safe response mapping
```

Malformed queries, overlong targets, and rate-limited requests do not create
authorization events. Accepted requests use the existing Cloudflare JWT
provider and protected facade. Authorization and the query share one
persistent event-history instance, and the authorization event is written
before the query. No direct reader bypass is permitted.

The route rejects request bodies, does not enable Express `trust proxy`, and
does not use client IP or forwarding headers for identity, authorization, or
rate limiting. A fixed process-local global limiter admits 60 requests per
60-second window and at most four concurrently; excess requests are rejected
without authentication or audit work. Responses are bounded to 1 MiB and
include `no-store`, `nosniff`, no-referrer, deny-framing, and restrictive CSP
headers. CORS permissions and bearer challenges are intentionally absent.

Event-history reads and the mock-first wake-alarm lifecycle are exposed.
Shutdown, preparation, execution, and scheduler routes remain absent, and no
helper or real machine effect is activated by this delivery.

## Protected wake-alarm HTTP delivery

Issue #242 adds `GET`, `PUT`, and `DELETE /admin/power/wake-alarm` behind the
separate `ADMINISTRATIVE_WAKE_ALARM_HTTP_ENABLED` gate. Enabling either
administrative surface requires exact loopback binding, paired Cloudflare
configuration, persistent event history, and trusted role assignments. Wake
delivery additionally requires a `power_operator` or `administrator`; an
auditor or scheduler operator is not granted wake access.

The read permission is `power.wake.read` and maps only to `read_wake_alarm`.
Wake requests use no query parameters, reject bodies on GET and DELETE, bound
PUT JSON to 512 UTF-8 bytes, and accept only the two exact JSON content types.
PUT sets a future canonical timestamp and DELETE remains idempotent. The
existing mock state is the only target effect.

All administrative routes share one process-local admission budget of 60
requests per 60 seconds and four concurrent requests. PUT and DELETE share a
single fail-fast mutation gate. Admission and validation happen before
authentication, so malformed, limited, or busy requests do not fill the audit
history. Accepted requests authenticate, authorize, record the decision, and
then invoke the protected capability. Authorization audit failure prevents the
target; terminal audit failure preserves a completed mock mutation and returns
a state-recheck error without compensation.

Wake responses are explicit, bounded, non-cacheable, and use the same
restrictive headers as event history. No CORS, ETag, bearer challenge, trusted
proxy, client-IP security, helper activation, real RTC access, or real power
effect is introduced.

## External helper privilege boundary

ADR-005 accepts a compiled, memory-safe Go helper as the future privilege
boundary while keeping Atlas Manager unprivileged. The intended installation
is `/usr/local/libexec/atlas-manager-power-helper`, root-owned, group-owned by
the dedicated `atlas-manager-power` group, and mode `04750`. The application
must belong to that group, and the parent directory must be root-owned and
not writable by group or others. Installation inspection reports safe project
categories and never repairs or prints filesystem details.

The helper accepts no arguments and no environment-selected behavior. It
handles one bounded canonical JSON request, uses only the fixed five-operation
v1 vocabulary, and currently rejects every valid operation with
`operation_unsupported`. Invalid input and startup failures are silent and
use fixed nonzero exit codes. There is no shell, child process, network,
filesystem, RTC, D-Bus, systemd, or power operation. Setuid code is
security-sensitive; each future fixed-resource backend and installation
procedure requires separate review. The binary is not installed or wired into
production by this delivery.

## Read-only RTC boundary

ADR-006 limits the helper's first operating-system backend to fixed `rtc0`
sysfs observation. `/sys` must report the Linux sysfs magic before the backend
reads the fixed `since_epoch` and `wakealarm` attributes. No caller, request,
environment, working directory, or command-line value can select a path.

Each attribute is read-only and bounded to 128 bytes. Canonical unsigned epoch
values are converted to UTC only when the RTC value falls within 300 seconds
of the system clock captured around the read. Missing support maps to
`operation_unsupported`; malformed, unreadable, or timezone-uncertain state
maps to `state_unavailable`. The backend never writes sysfs, starts a child
process, invokes a shell, accesses `/dev/rtc0`, or performs a power effect.

The production helper remains uninstalled and the Atlas Manager composition
remains mock-first. A deterministic, separately named fixture is used for
cross-language tests; it is not selectable by the production executable and
does not require RTC hardware in CI.

## Wake-alarm mutation boundary

ADR-007 permits only absolute epoch writes to the fixed
`/sys/class/rtc/rtc0/wakealarm` attribute. Cancellation writes exactly `0\n`;
relative syntax, caller-selected paths, commands, shells, subprocesses,
systemd, D-Bus, and network access remain prohibited. Payloads are bounded to
32 bytes and must be fully accepted by one write operation.

Every read uses a shared lock and every mutation uses an exclusive, fail-fast
lock at `/run/atlas-manager-power-helper.lock`. The lock must be a root-owned
regular file with exact mode `0600`, one link, and no final-component symlink.
Validation and RTC-to-system alignment occur before writing. Every write is
followed by exact state verification. Replacement is deliberately non-atomic:
if cancellation succeeds but scheduling or verification fails, the state is
preserved and reported as failed without retry, rollback, or compensation.

The helper remains uninstalled and the application remains mock-first. Shutdown
continues to be unsupported, and tests inject narrow lock/filesystem ports
instead of writing real sysfs.

## Systemd-logind shutdown boundary

ADR-008 restricts helper shutdown to the fixed root-owned socket
`/run/dbus/system_bus_socket` and the exact noninteractive call
`org.freedesktop.login1.Manager.PowerOff(false)`. The parent directory must be
a root-owned non-group-writable directory, and the socket must be a root-owned
Unix socket with no final symlink. `DBUS_SYSTEM_BUS_ADDRESS` and
`DBUS_SESSION_BUS_ADDRESS` cannot redirect the connection.

The helper uses one private EXTERNAL-authenticated connection and a fixed
three-second deadline. It does not bypass inhibitors, request interactive
authorization, enumerate inhibitors, use the PID 1 manager, call a shell,
start a process, invoke a syscall, or use SysRq. The operation is serialized by
the existing exclusive helper lock and never reads or writes RTC state.

A successful reply means logind accepted the request, not that power-off is
complete. Uncertain acceptance is never retried or compensated and is exposed
only as the existing `operation_failed` protocol category. The helper source is
not installed, and the application selects it only through the explicit
fail-closed `POWER_MANAGEMENT_BACKEND=linux_helper` composition gate. The
default remains mock and composition performs no helper request. A selected
helper failure is never converted to mock success.

## Read-only host qualification

Issue #256 adds a separate effective-root qualification command. Root provides
identity parity with the future helper, not mutation authority: the command
has no installer calls, repair mode, child process execution, sysfs writes,
group updates, helper execution, or power operation. It accepts only three
exact actions and fixed host resources.

Reports exclude names, addresses, usernames, raw boot IDs, credentials,
filesystem details, and D-Bus diagnostics. The boot identifier is hashed with
a project-owned domain separator. The fixed system bus is inspected and a
two-second private EXTERNAL-authenticated connection performs only read-only
logind checks; `PowerOff` is never called. The required empty helper group
deliberately separates disabled installation from application enrollment and
real-effect activation.

The qualification and bundle target is fixed to `GOOS=linux`, `GOARCH=amd64`,
`GOAMD64=v1`, and `CGO_ENABLED=0`; a host CPU model is evidence only and is
never used as an allowlist.

## Production-shaped composition boundary

ADR-011 keeps the application safe by default. `POWER_MANAGEMENT_BACKEND` is
the only selector and accepts exactly `mock` or `linux_helper`; it defaults to
`mock`. The selection is immutable and atomic across RTC information, wake
alarm read, wake alarm mutation, and machine shutdown adapters. No helper path,
argument, RTC resource, D-Bus resource, fallback, repair, installation,
group enrollment, or runtime switch is configurable.

The Linux adapter is created once with one shared fixed-contract transport and
the existing installation inspector. Creating the composition performs no
helper request. Real adapter failures remain failures, and route enablement,
scheduler execution, host qualification, installation, application-user
enrollment, and real-effect certification are independent gates. A successful
Linux shutdown means `accepted` by logind, not completed power-off; the mock
backend continues to report `simulated`.

## Machine operating policy configuration

ADR-012 accepts one bounded `MACHINE_OPERATING_POLICY` JSON object and passes
its immutable canonical domain value through startup composition. Absent input
means `always_on`; explicit invalid input fails startup and never falls back.
Only `always_on`, `manual`, and scheduled windows in `America/Sao_Paulo` are
accepted. Duplicate JSON keys, unknown fields, malformed roots, surrounding
whitespace, BOM, NUL, trailing data, and oversized input reject.

The policy is not selected by HTTP, reloaded at runtime, or changed by a
request. A scheduled policy does not select `linux_helper`, grant any user
access, enable administrative routes, or start a scheduler. Configuration and
composition perform no helper, RTC, D-Bus, wake, shutdown, filesystem, or
background scheduler effect.

## Policy-bound scheduler confirmation

ADR-013 authorizes scheduler shutdowns only through an exact occurrence
regenerated from the immutable configured machine policy. The reader performs
no environment, file, RTC, D-Bus, helper, or HTTP access and never selects a
nearest transition or applies a timestamp tolerance. `always_on` and `manual`
policies always return `not_confirmed`.

The policy check is necessary but not sufficient: readiness, preparation,
permanent claims, wake-before-shutdown ordering, and failure boundaries remain
in force. Direct and administrative paths retain separate confirmations, and
the scheduler has no fallback from `executeAt` to a weaker execution method.

## Disabled machine-power scheduler lifecycle

The machine-power scheduler is a separate disabled-by-default activation gate.
Only exact `MACHINE_POWER_SCHEDULER_ENABLED=true` starts it, and startup also
requires persistent cursor, occurrence-claim, and event-history paths. The
loop runs one explicit tick immediately after HTTP listening and then waits a
fixed 60 seconds after each successful continuing tick. It never overlaps,
retries, repairs state, or falls back to mock behavior.

Blocked, incomplete, conflict, and failed ticks terminate the process
fail-closed through coordinated shutdown. Administrative HTTP flags,
`POWER_MANAGEMENT_BACKEND`, policy selection, helper installation, and user
enrollment do not activate the loop. No host or VM drill, helper execution,
RTC access, D-Bus request, wake mutation, reboot, or shutdown was performed.

### Hash-bound Linux effects admission

Linux power effects have an additional startup gate. The exact
MACHINE_POWER_EFFECTS_ACTIVATION=linux_helper value is required only when a
Linux backend has an enabled effect-capable surface. It must be paired with
the exact operator confirmation and one lowercase 64-character SHA-256 digest
for the installed helper. Disabled activation rejects contradictory dormant
confirmation or digest values, and Linux activation without an effect surface
is rejected.

The startup preflight is read-only and fixed-path. It reuses the installation
inspector, streams the helper hash with built-in Node APIs, rejects symlinks,
unsafe parents, incorrect ownership, mode, setuid, group membership, link
count, size, or digest, and does not execute the helper. It performs no RTC,
wake-alarm, D-Bus, shutdown, group, ownership, permission, or installation
mutation. Any failure stops startup before HTTP listening and scheduler work;
there is no fallback to mock or automatic repair.

The activation confirmation does not replace authentication, authorization,
request confirmation, scheduler policy confirmation, readiness, preparation,
or permanent occurrence claims. Physical Atlas deployment, application-user
enrollment, host qualification, and real-effect certification remain separate
gates. No host or VM drill occurred for this delivery.

### Dedicated runtime identity

Linux power effects require the process to run as the exact dedicated
`atlas-manager` service identity. The fixed contract is primary group
`atlas-manager`, home `/var/lib/atlas-manager`, shell
`/usr/sbin/nologin`, and supplementary membership in
`atlas-manager-power`. Root execution, UID/GID mismatch, account ambiguity,
unsafe account files, missing helper-group membership, and helper ownership by
another non-root group reject startup or the next helper operation.

The identity inspector validates only fixed local `/etc/passwd` and
`/etc/group` resources using bounded reads and safe metadata checks. It does
not trust `USER`, `LOGNAME`, or similar environment values, does not use
NSS commands, and never creates or modifies accounts, groups, memberships,
permissions, ownership, or privileges. Numeric IDs are internal facts and are
not logged or exposed through HTTP.

Disabled, mock, and inert configurations do not inspect account files. The
exact admitted helper-group GID is shared by startup preflight and
operation-time transport inspection. Enrollment, systemd configuration,
deployment, host qualification, and real-effect certification remain
deferred.

### Disabled Atlas Manager deployment boundary

Application deployment is an operator-only Go boundary independent from the
Linux power-helper installer. A bundle is accepted only when its closed
manifest, file modes, file types, and SHA-256 inventory agree. The installer
rejects unsafe identity data, an unsafe fixed Node runtime, active or enabled
service state, unknown releases, modified managed files, and lock conflicts.

The systemd unit fixes `atlas-manager:atlas-manager`, supplies
`atlas-manager-power` as a supplementary group, uses `Restart=no`, and keeps
the helper-compatible privilege model. Installation does not create or modify
accounts, group membership, configuration secrets, helper files, RTC state,
D-Bus state, or service activation. Physical deployment and real-effect
certification remain deferred.

### Deployment host qualification

The deployment bundle also contains the separate root-run
`atlas-manager-host-qualification` executable. It is read-only and fixed-path:
it validates Linux amd64, safe parents and systemd directories, the exact Node
runtime, bounded account files, bundle integrity, deployment capacity, and
managed state. It emits no account IDs, account-file contents, environment
contents, host identifiers, or raw operating-system errors. It does not create
or acquire locks, repair state, invoke systemd, start a service, execute the
installer, or inspect or execute the power helper. The power-helper
qualification executable remains an independent authority.
