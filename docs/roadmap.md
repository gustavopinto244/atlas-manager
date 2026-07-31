# Atlas Manager — Project Roadmap

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

Both slices perform no real RTC inspection, wake-alarm mutation, shutdown,
restart, suspend, hibernate, child-process execution, privileged operation,
HTTP administration, scheduler integration, or persistence.

### Planned scope

- server shutdown requests;
- scheduled shutdown;
- real RTC wake-alarm configuration;
- machine operating schedules;
- deterministic shutdown and wake planning;
- cancellation or replacement through a reviewed privileged adapter;
- safe confirmation and rejection behavior;
- administrative event recording;
- controlled privileged adapter.

The Node.js application must not run as root.

Power operations must not be implemented through unrestricted commands received
from HTTP input.

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

### Planned scope

- structured administrative events;
- operation source;
- target resource;
- timestamps;
- safe results and error information;
- event persistence;
- event-history queries;
- filtering and pagination;
- audit events for privileged operations;
- separation between event history and application logs.

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
