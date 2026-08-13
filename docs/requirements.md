# Atlas Manager — Initial Requirements

## Document status

- Status: Baseline (implemented through `1.0.0` general availability)
- Version: 0.1
- Author: Gustavo Pinto
- Last updated: 2026-08-11

The requirements below reflect the initial functional and non-functional
scope; they were delivered through the `1.0.0` GA release. See
`docs/capabilities.md` for the current, capability-by-capability
implementation status and `docs/roadmap.md` for scope planned beyond `1.0.0`.

## 1. Purpose

This document translates the Atlas Manager product vision into initial
functional, non-functional, and security requirements.

The requirements describe expected system behavior and constraints without
defining unnecessary implementation details.

## 2. Requirement conventions

Requirements use the following identifiers:

- `FR`: Functional Requirement
- `NFR`: Non-Functional Requirement
- `SEC`: Security Requirement

Priority levels:

- `Must`: required for the first stable release;
- `Should`: important, but may be delivered after the core capability;
- `Could`: optional or future enhancement.

## 3. Functional requirements

### 3.1 Server health

#### FR-001 — General server status

Priority: Must

The system shall provide a general health status for the Atlas server.

#### FR-002 — System resource information

Priority: Must

The system shall provide information about CPU, memory, disk usage, uptime,
and available temperature sensors.

#### FR-003 — Service health

Priority: Must

The system shall provide the current status of registered services.

#### FR-004 — External dependency checks

Priority: Should

The system should verify selected external dependencies, such as internet
connectivity, DNS resolution, and public application availability.

### 3.2 Service catalog and control

#### FR-005 — Registered service catalog

Priority: Must

The system shall maintain a catalog of services that it is allowed to
monitor and control.

#### FR-006 — Service status

Priority: Must

The system shall provide the status of each registered service.

#### FR-007 — Manual service control

Priority: Must

The system shall allow an authorized user to start, stop, and restart a
registered service.

#### FR-008 — Service drivers

Priority: Must

The system shall support service control through isolated drivers.

The initial drivers shall include:

- mock;
- PM2.

Docker and systemd drivers shall be added incrementally.

#### FR-009 — Restricted service targets

Priority: Must

The system shall only operate services explicitly registered in its
configuration or data store.

### 3.3 Service availability schedules

#### FR-010 — Availability modes

Priority: Must

Each registered service shall support one of the following availability
modes:

- always;
- scheduled;
- manual;
- disabled.

#### FR-011 — Weekly schedules

Priority: Must

The system shall allow weekly availability windows to be defined for each
service.

#### FR-012 — Timezone support

Priority: Must

Schedules shall use an explicitly configured timezone.

The initial deployment shall use `America/Sao_Paulo`.

#### FR-013 — Temporary overrides

Priority: Must

An authorized user shall be able to temporarily override a service schedule.

Examples include:

- keeping a service active until a specified time;
- starting a service for a limited duration;
- suspending its schedule;
- returning immediately to the normal schedule.

#### FR-014 — Duplicate execution prevention

Priority: Must

The scheduler shall prevent duplicate start or stop operations for the same
service and schedule occurrence.

#### FR-015 — Scheduled unavailability response

Priority: Should

The system should support a clear response or maintenance page when a public
service is intentionally unavailable.

### 3.4 Docker management

#### FR-016 — Docker resource status

Priority: Must

The system shall provide status information for allowlisted Docker
containers and Compose projects.

Docker resources may include application containers, databases, monitoring
tools, and other registered services.

#### FR-017 — Docker resource control

Priority: Must

An authorized user shall be able to start, stop, and restart allowlisted
containers and Compose projects.

#### FR-018 — Docker schedules

Priority: Must

Allowlisted Docker resources shall support availability schedules.

#### FR-019 — Docker health information

Priority: Must

The system shall expose available container health, uptime, image, and
resource usage information.

#### FR-020 — Limited Docker logs

Priority: Could

The system may provide limited logs for registered Docker resources.

#### FR-021 — Service dependencies

Priority: Must

The system shall support declared dependencies between registered services.

The system shall respect dependency order when starting or stopping related
services.

Dependency identifiers shall refer only to registered-service IDs. Unknown
targets, duplicate edges, self-dependencies, and circular graphs shall reject
startup configuration. Starts shall wait for each dependency's configured
runtime or health readiness before starting a dependent. Stops shall process
dependents before their dependencies. Scheduled operations shall apply the
same ordering while respecting each dependency's effective availability.

For example, it shall start a database container and wait for it to become
healthy before starting its dependent API.

When stopping the same group, it shall stop the API before stopping the
database container.

### 3.5 Power management

#### FR-022 — RTC information

Priority: Must

The system shall provide current RTC and wake-alarm information when
supported by the operating system.

`1.0.0` implements the software boundary through mock composition and the
fixed-resource Linux helper reader. Physical RTC observation on Atlas remains
a separately approved qualification gate and is not claimed by GA.

#### FR-023 — Mock power operations

Priority: Must

Power operations shall first be available through a mock driver that does
not alter the machine.

This mock path is the `1.0.0` default and remains the qualified production
configuration.

#### FR-024 — Wake-alarm scheduling

Priority: Must

The system shall be able to schedule the next supported RTC wake alarm.

The control plane, mock behavior, fixed helper protocol, and Linux backend are
implemented. Activating and qualifying a physical wake alarm on Atlas remains
a separate gate.

#### FR-025 — Safe shutdown routine

Priority: Must

The system shall support a controlled shutdown routine that can coordinate:

- active tasks;
- backups;
- service state;
- wake-alarm configuration;
- filesystem synchronization;
- event logging.

The readiness, preparation, occurrence-claim, wake-before-shutdown, audit, and
mock execution paths are implemented. A real physical shutdown remains
unactivated and unqualified.

#### FR-026 — Machine operating schedule

Priority: Must

The system shall support a configurable schedule for the Atlas machine.

The environment-owned scheduler policy and the persisted administrative
policy CRUD/preview control plane are implemented. Under ADR-033, the
persisted policy remains declarative and is not consumed by the physical
scheduler path; choosing that future authority requires a separate activation
decision. No physical schedule was qualified by `1.0.0`.

#### FR-027 — Independent service and machine schedules

Priority: Must

Service schedules and machine power schedules shall remain independent.

The system shall evaluate their interaction before powering off the machine.

The software keeps service and machine policies distinct and implements the
planning/readiness boundary. Authority for a future physical scheduler and its
Atlas qualification remain separately gated.

### 3.6 Backup management

#### FR-028 — Registered backup sources

Priority: Must

The system shall maintain a list of approved backup sources.

#### FR-029 — Manual backup execution

Priority: Must

An authorized user shall be able to start a registered backup operation.

#### FR-030 — Scheduled backups

Priority: Must

The system shall support scheduled backup operations.

#### FR-031 — Backup metadata

Priority: Must

The system shall record backup metadata, including:

- start time;
- end time;
- status;
- size;
- checksum, when available;
- error information.

#### FR-032 — Backup retention

Priority: Should

The system should support configurable backup retention policies.

### 3.7 Events and history

#### FR-033 — Operational event history

Priority: Must

The system shall record important operational events.

Examples include:

- server startup;
- shutdown;
- service operations;
- schedule executions;
- backup operations;
- failures;
- administrative actions.

#### FR-034 — Task execution history

Priority: Must

The system shall record the result and duration of scheduled tasks.

### 3.8 Administration

#### FR-035 — Administrative API

Priority: Must

The system shall provide an administrative API for supported operations.

#### FR-036 — Web dashboard

Priority: Should

The system should provide a web dashboard after the administrative API is
stable.

#### FR-037 — Command-line interface

Priority: Should

The system shall provide a general administrative command-line interface over
the same protected application capabilities used by the dashboard and API.

`1.0.0` delivers the packaged `atlas` CLI for health, services, schedules,
backups, events, machine policy, and read-only infrastructure diagnostics.
Its administrative transport uses Cloudflare Access human or service-token
identity and the same RBAC and audit boundaries as the HTTP API (ADR-027,
ADR-031, ADR-032, and ADR-034).

#### FR-038 — Health endpoint

Priority: Must

The system shall expose a lightweight health endpoint for deployment and
monitoring checks.

## 4. Non-functional requirements

#### NFR-001 — Supported environment

Priority: Must

The initial production environment shall be a Linux server running on the
Atlas Lenovo ThinkCentre.

#### NFR-002 — Type safety

Priority: Must

The application shall use strict TypeScript and avoid untyped application
interfaces.

#### NFR-003 — Modular organization

Priority: Must

The application shall use a feature-first modular-monolith organization.

#### NFR-004 — Testability

Priority: Must

Operating-system integrations shall be isolated behind testable interfaces
or adapters.

#### NFR-005 — Simulated implementations

Priority: Must

Dangerous integrations shall have mock implementations before production
drivers are enabled.

#### NFR-006 — Reliability

Priority: Must

A failed scheduled operation shall not terminate the entire application.

#### NFR-007 — Idempotency

Priority: Must

Repeated processing of the same schedule occurrence should not produce
duplicated destructive operations.

#### NFR-008 — Observability

Priority: Must

The application shall produce structured logs for important operations and
failures.

#### NFR-009 — Documentation

Priority: Must

User-visible behavior and architectural decisions shall be documented.

#### NFR-010 — Validation pipeline

Priority: Must

The project shall provide automated lint, test, and build commands.

#### NFR-011 — Deployment rollback

Priority: Must

The production deployment shall support rollback to a previously released
version.

#### NFR-012 — Local binding

Priority: Must

The production application shall bind only to a local interface unless a
documented requirement explicitly changes this behavior.

#### NFR-013 — Incremental delivery

Priority: Must

Capabilities shall be delivered in small, testable, and documented releases.

#### NFR-014 — Controlled degradation

Priority: Should

The application should continue providing unaffected read-only capabilities
when an optional integration is unavailable.

## 5. Security requirements

#### SEC-001 — Unprivileged application process

Priority: Must

The Express application shall not run as root.

#### SEC-002 — Least privilege

Priority: Must

Every operating-system, Docker, database, and service integration shall use
the minimum permissions required.

#### SEC-003 — No arbitrary commands

Priority: Must

The application shall not expose arbitrary shell, Docker, systemd, PM2, or
database command execution.

#### SEC-004 — Allowlists

Priority: Must

Privileged operations shall only target explicitly approved services,
containers, projects, databases, paths, and actions.

#### SEC-005 — Input validation

Priority: Must

All external input shall be validated before reaching application behavior
or infrastructure adapters.

#### SEC-006 — Secret management

Priority: Must

Secrets shall not be committed to Git or included in application logs.

#### SEC-007 — Docker access restriction

Priority: Must

The Express process shall not receive unrestricted access to the Docker
socket.

#### SEC-008 — Database credentials

Priority: Must

Database health checks and monitoring shall use credentials with restricted
permissions.

#### SEC-009 — Administrative authentication

Priority: Must

State-changing administrative operations shall require authentication and
authorization before public exposure.

#### SEC-010 — Audit trail

Priority: Must

Administrative and privileged operations shall generate audit events.

#### SEC-011 — Destructive operation confirmation

Priority: Must

High-risk operations such as shutdown, restoration, or destructive service
changes shall require explicit authorization and appropriate safeguards.

#### SEC-012 — Public ingress protection

Priority: Must

The production administrative interface shall be protected through the
approved public-ingress and access-control architecture.

## 6. Initial release scope

The first stable release should include:

- server health;
- registered service monitoring;
- PM2 service control;
- service availability schedules;
- temporary schedule overrides;
- allowlisted Docker monitoring and basic control;
- Docker container health and readiness checks;
- dependency ordering between applications and containers;
- machine power scheduling;
- RTC wake-alarm support;
- backup management;
- event history;
- protected administrative API;
- initial dashboard;
- CLI;
- documented deployment and rollback.

## 7. Future scope

The following capabilities may be considered after the first stable release:

- multiple managed servers;
- remote Atlas Manager agents;
- additional database engines;
- notification integrations;
- remote backup storage;
- community-created adapters;
- advanced metrics and observability;
- configuration import and export;
- richer maintenance pages;
- mobile-oriented administration.
- logical database backup and restoration;
- database-engine-specific administration;
- Docker Compose profile support, only after a concrete deployment use case,
  explicit configuration ownership, strict validation, safe fixed command
  construction, complete lifecycle semantics, and a separate security review.

Future-scope items are not requirements for version `1.0.0` unless they are
explicitly promoted into the roadmap.

# v0.7 backup orchestration delivery

Issue #281 completes registered backup targets, protected manual and scheduled
execution, persistent run metadata, atomic local filesystem artifacts,
checksums, bounded retention, administrative audit integration, shutdown
backup readiness, and dashboard visibility. Restoration, remote replication,
logical database backup, and physical execution remain out of scope.

# v0.8 event-history and auditing delivery

Issue #283 delivers bounded segmented persistence, chained record and segment
integrity, cross-process writer coordination, explicit v1 migration, anchored
retention, protected canonical export, and dashboard operational visibility.
Remote replication, external attestation, restore, SIEM delivery, and physical
deployment remain out of scope.
