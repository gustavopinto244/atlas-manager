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

Atlas Manager is currently in the project-foundation phase.

Completed foundation work includes:

- initial product vision;
- initial product requirements;
- the decision to use Express.js;
- Node.js and TypeScript initialization;
- ESLint and Prettier configuration;
- coding-agent instructions;
- project README;
- high-level architecture documentation;
- contribution workflow;
- project glossary.

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

## v0.4 — Service availability scheduling

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
- scheduler execution;
- dependency-aware startup and shutdown;
- circular-dependency detection;
- dependency readiness confirmation.

The expected initial timezone is `America/Sao_Paulo`, but it must be configured
explicitly.

## v0.5 — Docker management

### Objective

Manage approved Docker resources through controlled project-level operations.

### Planned scope

- Docker container registration;
- container status;
- start, stop, and restart operations;
- Docker health information;
- limited approved logs;
- Docker-backed registered services;
- Docker service scheduling;
- dependency relationships involving Docker resources;
- controlled Docker adapter;
- safe timeout and error handling.

Atlas Manager is not intended to become a generic unrestricted Docker
administration platform.

Database engines are treated as Docker-managed services in the initial release.

This milestone does not include:

- logical PostgreSQL administration;
- logical MongoDB administration;
- arbitrary database queries;
- schema management;
- logical database backup or restoration.

## v0.6 — Power management

### Objective

Provide controlled scheduling and execution of approved Atlas power
operations.

### Planned scope

- server shutdown requests;
- scheduled shutdown;
- RTC wake-alarm configuration;
- wake-schedule validation;
- cancellation or replacement of scheduled operations;
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

