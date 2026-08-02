# Atlas Manager — Project Roadmap

Issue #254 delivers the reproducible helper distribution and operator-controlled
installation boundary for v0.6. Packaging does not complete the milestone:
host qualification, application-user enrollment, production wiring, and real
effect recovery remain later gates.

## Document purpose

This roadmap presents the intended development sequence for Atlas Manager.

It communicates direction and major milestones. It does not replace:

- `docs/product-vision.md`;
- `docs/requirements.md`;
- Architecture Decision Records;
- GitHub Issues and their acceptance criteria.

The roadmap may evolve as implementation reveals new requirements, risks, or
technical constraints.

Version numbers describe planned development stages and are not fixed release
dates.

## Current phase

Atlas Manager is beginning v0.6 — Power management after completing the v0.5
Docker-management milestone.

Completed milestones include:

- v0.1 — Project foundation;
- v0.2 — Server health;
- v0.3 — Service catalog and manual control;
- v0.4 — Service availability scheduling.

The v0.4 milestone delivered the complete service availability scheduling
persistence and recovery chain, including registered-service configuration,
availability schedule parsing, reconciliation occurrence generation, persistent
occurrence claim acquisition, controlled service operation execution,
reconciliation completeness evaluation, expired availability override pruning,
completed occurrence claim pruning, and compare-and-set scheduler cursor
advancement with comprehensive process-style reconstruction and recovery
coverage.

The v0.5 milestone introduces Docker containers as fully supported registered
services through a complete vertical slice covering Docker as an approved
service-management adapter, registered Docker-container configuration, safe
Docker CLI execution boundaries, generic registered-service status support,
Docker-specific health and resource details, start/stop/restart control,
dispatching integration, service-management composition integration,
availability scheduling integration, and file-backed scheduler coverage.

The administrative API and server-management capabilities have not yet been
implemented.

## Roadmap principles

Development should:

- implement one coherent capability at a time;
- use GitHub Issues with explicit acceptance criteria;
- introduce architecture incrementally;
- validate behavior through automated tests;
- treat privileged operations as security-sensitive;
- avoid abstractions without a concrete use case;
- record major architectural changes through ADRs;
- remain understandable to the primary developer.

## v0.1 — Project foundation

### Objective

Establish a reliable development foundation before introducing privileged
server-management behavior.

### Planned scope

- project and product documentation;
- Node.js and TypeScript configuration;
- static analysis and formatting;
- test infrastructure using Vitest and Supertest;
- initial Express application structure;
- environment-variable validation;
- structured logging;
- centralized error handling;
- application startup and shutdown behavior;
- initial composition root;
- continuous-integration validation.

### Completion indicators

- formatting, lint, type checking, build, and tests pass;
- the Express application starts and stops predictably;
- initial source boundaries reflect the documented architecture;
- no privileged server operation is exposed.

## v0.2 — Server health

### Objective

Provide safe visibility into the operational state of Atlas.

### Planned scope

- server uptime;
- memory usage;
- disk usage;
- CPU load;
- approved temperature information when available;
- project-defined server-health models;
- server-health application use case;
- HTTP health endpoint;
- safe error handling;
- unit and HTTP integration tests.

Server-health responses must not expose secrets, private paths, environment
values, or unnecessary system information.

## v0.3 — Service catalog and manual control

### Objective

Introduce a controlled model for identifying and managing approved services.

### Planned scope

- registered-service model;
- stable service identifiers;
- service catalog;
- supported-operation definitions;
- service status retrieval;
- manual start, stop, and restart operations;
- initial PM2 adapter;
- project-defined service-status models;
- allowlisted resource configuration;
- tests for supported and rejected operations.

External clients must use registered service identifiers rather than arbitrary
process names.

## v0.4 — Service availability scheduling (completed)

### Objective

Allow registered services to follow explicit availability policies.

### Planned scope

- availability modes:
  - `always`;
  - `scheduled`;
  - `manual`;
  - `disabled`;
- weekly schedules;
- explicit timezone handling;
- temporary overrides;
- override expiration and cancellation;
- scheduler execution.

The expected initial timezone is `America/Sao_Paulo`, but it must be configured
explicitly.

### Completion status

This milestone is completed. The implementation delivered the complete service
availability scheduling persistence and recovery chain with comprehensive
process-style reconstruction and recovery coverage across all scheduler
outcomes (idle, advanced, incomplete, conflict, rejected operation) and
recovery boundaries.

## v0.5 — Docker management (completed)

### Objective

Manage approved Docker resources through controlled project-level operations.

### Delivered scope

- registered Docker containers with health, resource details, and control;
- registered Docker Compose projects with aggregate status and whole-project control;
- controlled logs for Docker containers and Compose projects;
- safe no-shell Docker CLI execution with finite timeouts and bounded output;
- availability scheduling integration with file-backed scheduler compatibility;
- adapter-specific management configuration validation;
- dispatching and composition integration;
- registered-service dependency graphs with unknown-target and cycle rejection;
- deterministic dependency-aware start, stop, and restart orchestration;
- runtime and Docker/Compose health readiness confirmation;
- scheduler ordering and file-backed dependency reconstruction coverage.

### Completion status

This milestone is completed. The final acceptance audit and focused dependency
and readiness coverage passed with 105 test files and 1,892 tests. The
implementation, tests, security boundary, recovery behavior, and documentation
are reconciled.

Compose profiles are not an accepted v0.5 requirement and were not a milestone
blocker. They remain a future consideration only. A future profile capability
requires a concrete registered-service use case, exact configuration ownership,
strict profile-name validation, fixed command construction, supported status,
control, logs, and scheduling semantics, a separate security review, and a
dedicated Issue.

Atlas Manager is not intended to become a generic unrestricted Docker
administration platform.

Database engines are treated as Docker-managed services in the initial release.

This milestone does not include:

- logical PostgreSQL administration;
- logical MongoDB administration;
- arbitrary database queries;
- schema management;
- logical database backup or restoration.

## v0.6 — Power management (active)

### Objective

Provide controlled scheduling and execution of approved Atlas power
operations.

### Delivered first slice

- project-owned immutable RTC information;
- `unsupported`, `not_scheduled`, and `scheduled` wake-alarm observations;
- read-only RTC information use case with an application-owned clock;
- narrow machine-shutdown request contract;
- deterministic mock RTC reader;
- simulated mock shutdown controller;
- isolated power-management composition and tests.

### Delivered second slice

- independent deterministic next-wake-alarm queries;
- canonical schedule-input validation and strict future-time validation;
- mock initial scheduling, replacement, unchanged scheduling, and cancellation;
- immutable schedule and cancellation mutation results;
- one shared process-local mock wake-alarm state for RTC and alarm queries;
- integration coverage proving RTC observation synchronization.

### Delivered third slice

- project-owned `always_on`, `scheduled`, and `manual` machine operating policies;
- exact explicit `America/Sao_Paulo` timezone validation;
- immutable weekly machine operating windows with canonical ordering;
- deterministic half-open schedule evaluation through the runtime timezone database;
- immutable next-shutdown and next-wake planning with weekly wraparound;
- `getMachinePowerPlan` in the frozen power-management composition;
- complete domain, application, composition, and mock-first integration coverage.

All three slices perform no real RTC inspection, wake-alarm mutation, shutdown,
restart, suspend, hibernate, child-process execution, privileged operation,
HTTP administration, scheduler integration, or persistence.

### Planned scope

- persistent machine-power occurrence claims and process reconstruction;
- an explicit bounded machine-power scheduler tick;
- scheduled shutdown execution after explicit failure and confirmation design;
- real RTC wake-alarm configuration;
- cancellation or replacement through a reviewed privileged adapter;
- safe confirmation and rejection behavior;
- administrative event recording;
- controlled privileged adapter.

The Node.js application must not run as root.

Power operations must not be implemented through unrestricted commands received
from HTTP input.

### Delivered fourth slice

- project-owned machine-shutdown occurrences with deterministic tuple identity;
- process-local permanent claims with `claimed` and `duplicate` outcomes;
- explicit `not_due`, `stale`, `duplicate`, and `executed` results;
- wake-alarm preparation before simulated shutdown;
- explicit wake-failure and shutdown-after-wake partial-effect behavior;
- frozen composition capabilities for occurrence planning and execution.

This slice remains mock-first and explicitly invoked. It introduces no automatic
scheduler, persistence, retry, rollback, compensation, real RTC operation, or
real shutdown. v0.6 remains active.

### Delivered fifth slice

- file-backed machine shutdown occurrence claims and completed-claim pruning;
- file-backed machine-power scheduler cursors with compare-and-set progression;
- bounded `(completedThrough, tickedThrough]` interval generation;
- explicit scheduler ticks with safe initialization, blocked, incomplete,
  advanced, and conflict outcomes;
- process reconstruction and duplicate-protected recovery;
- documented crash windows and process-local mock wake-state limitations.

This remains an explicit mock-first capability. It adds no automatic loop,
process lifecycle integration, persistent wake-alarm state, real RTC operation,
real shutdown, service coordination, confirmation, or privileged adapter.

### Delivered safe-shutdown readiness slice

- public registered-service availability assessment for explicit UTC intervals;
- fail-closed machine shutdown readiness decisions;
- runtime service, schedule, active-task, backup, filesystem, and event blockers;
- explicit mock confirmation with a safe `not_confirmed` default;
- readiness enforcement before occurrence claims and effects;
- retryable scheduler incompleteness after readiness rejection.

This slice does not stop services, drain tasks, run backups, synchronize
filesystems, persist events, authenticate operators, or perform real power
operations. v0.6 remains active.

### Delivered mock safe-shutdown preparation slice

Supported blockers can be prepared explicitly through dependency-aware
registered-service stopping, active-task draining, backup completion,
filesystem synchronization, ordered in-memory events, and fresh final
readiness. Preparation remains retryable until the shutdown occurrence is
claimed. Real machine effects, event persistence, and automatic lifecycle
scheduling remain deferred. v0.6 remains active.

### Delivered secure Linux power-helper foundation

- accepted ADR-002 for a fixed privileged helper boundary;
- immutable version-1 helper requests and responses with strict operation,
  timestamp, state, transition, and failure-code validation;
- fixed root-owned helper installation inspection;
- bounded no-shell Linux transport with a fixed five-second timeout, minimal
  environment, sequential same-instance execution, and streaming output
  limits;
- helper-backed RTC, wake-alarm reader/controller, and machine-shutdown
  adapters with safe project-owned error translation;
- frozen adapter bundle and deterministic fake/fixture infrastructure;
- security-focused protocol, installation, transport, adapter, composition,
  and integration coverage.

This is an application-side foundation only. Issue #246 now supplies the
external helper source, but it remains uninstalled and not production-wired.
Authentication, authorization,
destructive confirmation, persistent administrative auditing, deployment and
permission validation, recovery procedures, supported Linux verification,
operator-visible failures, and helper security review remain activation gates.
Real RTC, wake-alarm, filesystem, and machine-shutdown effects remain
deferred. v0.6 remains active.

## v0.7 — Backup orchestration

### Objective

Coordinate approved infrastructure and application backup operations.

### Planned scope

- registered backup targets;
- backup requests;
- backup scheduling;
- controlled destination configuration;
- backup result reporting;
- timeout and failure handling;
- event recording;
- retention-policy support when explicitly defined;
- tests for backup orchestration.

Initial backups should focus on approved files, directories, volumes, and
application resources.

Engine-specific logical database backups remain outside the initial scope.

## v0.8 — Event history and auditing

### Objective

Provide traceability for administrative and automated operations.

### Delivered first slice

- structured administrative events;
- trusted operation sources and the exact Atlas machine target;
- internally generated attempt IDs and contiguous store-assigned sequences;
- immutable operation-specific results and safe failure details;
- deterministic in-memory event storage;
- explicitly configured append-only version-one JSON Lines persistence;
- strict process reconstruction, file permissions, and fail-closed corruption handling;
- bounded cursor queries, filters, and immutable pages;
- before-effect and terminal audit events for the six power operations;
- event-history readiness integrated with shutdown readiness;
- separation between event history and application logs.

Issue #236 adds the mock-first access-control foundation: immutable
administrative principals, deny-by-default authentication, fixed roles and
permissions, audited authorization decisions, protected power and event-history
facades, and verified actor propagation. It does not complete production
authentication or protected delivery.

The default remains in memory for non-HTTP compositions and file persistence
is explicit with fixed line and file bounds. Cross-process locking,
cryptographic tamper evidence, retention, and rotation remain future work.
Issue #240 delivers the first protected, authenticated, and authorization-
audited event-history HTTP read with bounded cursor filters and safe response
mapping. v0.8 remains active.

### Remaining v0.8 scope

- operational retention and export design;
- tamper-evidence and multi-process persistence design when required.

Events must not store credentials, tokens, private keys, or other secrets.

## v0.9 — Authentication and API hardening

### Objective

Protect administrative capabilities before broader remote use.

### Planned scope

- authentication mechanism;
- authorization policies;
- administrative-operation permissions;
- secure session or token handling;
- request-size limits;
- rate-limiting strategy when appropriate;
- security headers;
- safe cross-origin configuration;
- audit coverage;
- protection against repeated or conflicting operations;
- security tests and documentation.

The authentication strategy should be recorded through an ADR before
implementation.

ADR-003 and Issue #236 establish the mock-first foundation under this
milestone, but v0.9 remains active. Issue #238 selects the production-shaped
identity mechanism and Issue #240 delivers the first protected read-only HTTP
route. Remaining work includes broader protected delivery, verified
transport/proxy configuration, deployment ownership, and operator recovery
procedures.

Issue #238 delivers the production-shaped identity-verification foundation.
Cloudflare Access application JWTs are checked at the application boundary
with fixed issuer/audience binding, RS256 signatures, bounded JWKS retrieval,
controlled key caching and refresh, temporal validation, and human-only UUID
subjects. Issue #240 adds the first protected HTTP endpoint, explicit route
activation, loopback-only binding, request URL/body/query bounds, a global
60-per-60-second admission limit, four-request concurrency control, and
restrictive response headers. The route remains read-only and does not add
CORS, trusted-proxy behavior, power routes, or real effects. v0.9 remains
active because broader protected delivery and deployment validation are
deferred. v0.6 also remains active: no real helper or real power effect is
enabled.

## v1.0 — Initial stable release

### Objective

Deliver a documented and maintainable version suitable for managing approved
Atlas resources.

### Expected capabilities

- server-health monitoring;
- registered-service management;
- manual service control;
- availability schedules;
- temporary overrides;
- dependency-aware orchestration;
- approved Docker resource management;
- power scheduling;
- backup orchestration;
- event history;
- authenticated administrative API;
- administrative dashboard;
- tested deployment on Atlas;
- documented operational procedures.

### Stability expectations

The initial stable release should include:

- automated continuous-integration validation;
- tests for critical behavior;
- documented deployment and update procedures;
- structured logging;
- predictable error handling;
- security review of privileged operations;
- documented recovery and rollback procedures;
- no known exposure of arbitrary command execution.

## Future considerations

Possible future work includes:

- command-line administration;
- notification integrations;
- expanded monitoring;
- multiple host support;
- additional service-management adapters;
- engine-specific logical database backup and restoration;
- advanced authorization;
- external metrics integrations.

Future considerations are not commitments. They require separate requirements,
Issues, security reviews, and architectural decisions.

## Roadmap maintenance

Update this roadmap when:

- a major milestone is added, removed, or reordered;
- implementation substantially changes the expected scope;
- a major capability is completed;
- an accepted ADR changes the planned architecture.

Do not use this roadmap as a substitute for acceptance criteria.

Every implementation task must still be represented by a scoped GitHub Issue.

## Issue #242 delivery notes

The protected mock-first wake-alarm lifecycle advances v0.6 and v0.9 without
completing either milestone. It adds `power.wake.read`, the protected
`read_wake_alarm` operation, authenticated and authorization-audited GET/PUT/
DELETE delivery, strict request and response bounds, shared administrative
admission, and fail-fast mutation concurrency. Persistent audit history and
real-helper activation prerequisites remain required; no RTC or machine power
effect is enabled.

## Issue #244 delivery notes

Issue #244 advances v0.6, v0.8, and v0.9 without completing any of them. It
adds the disabled-by-default, loopback-only two-stage shutdown HTTP workflow:
`POST /admin/power/shutdown/preparations` and `POST
/admin/power/shutdown/executions`. The routes use separate confirmations,
fresh execution readiness, existing dependency-aware service preparation,
persistent occurrence claims, wake-before-simulated-shutdown ordering, shared
administrative admission, and one fail-fast power-operation gate. Preparation
may stop registered services. No helper, real RTC mutation, or real machine
shutdown is enabled, and partial effects are never rolled back or retried.

## Issue #246 delivery notes

Issue #246 advances v0.6 without completing it. ADR-005 adds a pinned,
standard-library-only Go helper module, strict one-request protocol handling,
an exact `04750` setuid installation inspection, a deny-all production backend,
shared protocol fixtures, and CI build/test coverage. The helper is not
installed or production-wired, and all RTC, wake-alarm, filesystem, process,
network, and machine-power effects remain deferred.

## Issue #248 delivery notes

Issue #248 advances v0.6 without completing it. ADR-006 adds a fixed `rtc0`
read-only sysfs backend for `read_rtc_information` and `read_wake_alarm`, with
bounded attributes, sysfs verification, canonical epoch parsing, and fixed
RTC-to-system-clock alignment validation. Wake and shutdown mutations remain
unsupported. The helper is not installed or wired into the application, and
CI uses deterministic fixtures instead of host RTC hardware.

## Issue #250 delivery notes

Issue #250 advances v0.6 without completing it. ADR-007 adds fixed Linux
wake-alarm scheduling and cancellation source code with nonblocking
cross-process coordination, absolute epoch-only writes, read-before-write and
read-after-write validation, idempotent outcomes, and explicit partial-effect
failures. The helper is not installed or wired into Atlas Manager; shutdown
and all HTTP behavior remain unchanged.

## Issue #252 delivery notes

Issue #252 advances v0.6 without completing it. ADR-008 adds the real helper
source backend for orderly shutdown through the fixed systemd-logind D-Bus
`PowerOff(false)` call. It adds fixed socket inspection, EXTERNAL
authentication, a three-second deadline, exclusive operation locking, safe
unsupported/rejected/failed mappings, and uncertain-acceptance handling. The
helper is still not installed or production-wired; Atlas Manager remains
mock-first and no HTTP or real host effect is activated.

## Issue #256 delivery notes

Issue #256 adds capability-based Linux host qualification and a documented
disabled-installation drill. The utility is read-only, requires effective
root, inspects fixed Linux/RTC/system-bus resources, validates an empty helper
group, and emits bounded reports. It does not install or execute the helper,
enroll users, call logind `PowerOff`, test firmware wake behavior, or enable
Atlas Manager. Operational evidence remains outside source control.

## Issue #258 delivery notes

Issue #258 delivers production-shaped composition only. The exact
`POWER_MANAGEMENT_BACKEND=mock` value remains the default, while the exact
`linux_helper` value selects one frozen complete Linux adapter bundle. No
helper request occurs during composition and helper failures do not fall back
to mock behavior. Administrative HTTP activation and scheduler execution are
independent. Host deployment, disabled-installation qualification, application
user enrollment, real helper activation, and real-effect certification remain
deferred.

## Issue #260 delivery notes

Issue #260 delivers strict production machine operating policy configuration.
`always_on` remains the default, `manual` disables automatic schedule
planning, and `scheduled` uses immutable canonical weekly windows in
`America/Sao_Paulo`. Policy selection is independent from helper backend,
administrative HTTP activation, and scheduler lifecycle. No automatic
machine-power scheduler exists yet; Atlas deployment, user enrollment, and
real-effect certification remain deferred.

## Issue #262 delivery notes

Issue #262 delivers policy-bound scheduler confirmation. An explicitly invoked
tick may confirm only an exact shutdown occurrence regenerated from the same
immutable configured policy used for planning. Direct and administrative
shutdown confirmations remain separate, and readiness and preparation remain
authoritative. No automatic scheduler loop, helper activation, host drill, or
real power effect is introduced.

The automatic machine-power scheduler lifecycle, Atlas deployment,
application-user enrollment, and real-effect certification remain deferred.

## Issue #264 delivery notes

Issue #264 delivers the disabled-by-default machine-power scheduler lifecycle.
Exact `MACHINE_POWER_SCHEDULER_ENABLED=true` requires persistent cursor, claim,
and event-history files, starts only after HTTP listening, runs the existing
tick at a fixed 60-second one-shot cadence, prevents overlap, and terminates
fail-closed on blocked, incomplete, conflict, or failed outcomes. The default
remains disabled and mock-first; helper deployment, application-user
enrollment, Atlas host qualification, and real-effect certification remain
deferred.
