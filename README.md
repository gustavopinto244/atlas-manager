# Atlas Manager

Atlas Manager is a self-hosted Node.js and TypeScript application for
monitoring, managing, and automating the Atlas homelab server.

The project is also an educational environment for learning backend
development, software architecture, testing, Linux automation, security, and
deployment through practical implementation.

## Project status

Atlas Manager is currently implementing the server-health and registered-
service foundations.

The repository currently includes:

- product vision and initial requirements;
- the architectural decision to use Express.js;
- Node.js and TypeScript configuration;
- ESLint and Prettier configuration;
- coding-agent instructions;
- an initial Express application with liveness and server-health endpoints;
- host uptime, memory, CPU, temperature, and disk monitoring;
- a validated registered-service model and controlled in-memory catalog;
- deterministic mock and read-only PM2 service-status adapters;
- HTTP integration testing with Vitest and Supertest.

Service control and the administrative API have not been implemented yet. The
current health endpoints do not report Docker, PM2, systemd, database, or
managed-service health.

## Planned capabilities

The planned initial release includes:

- server health monitoring;
- registered service status and control;
- service availability schedules;
- Docker resource monitoring and control;
- dependency-aware service startup and shutdown;
- server power scheduling;
- backup orchestration;
- event history;
- an administrative API;
- an administrative dashboard.

Database engines are treated as Docker-managed services in the initial release.

Logical PostgreSQL or MongoDB administration, backup, and restoration are
outside the initial scope.

### Service availability modes

Work on `v0.4 — Service availability scheduling` has started with the domain
vocabulary for the approved modes: `always`, `scheduled`, `manual`, and
`disabled`. The model provides exact runtime validation only.

The immutable weekly schedule model uses the lowercase weekday identifiers
`monday`, `tuesday`, `wednesday`, `thursday`, `friday`, `saturday`, and
`sunday`, plus canonical minute-precision local times in `HH:mm` format. Its
availability windows use half-open `[start, end)` semantics. Zero-length,
overnight, and overlapping windows are rejected, while adjacent windows are
accepted. Schedules contain between 1 and 64 windows and return them in
canonical weekday and time order.

The scheduling domain also approves exactly one explicit timezone identifier:
`America/Sao_Paulo`. Validation is exact and case-sensitive, accepts no aliases,
does not infer the host timezone, and provides no implicit default.

An immutable availability-policy model combines these existing validators.
`always`, `manual`, and `disabled` policies contain no timezone or weekly
schedule. A `scheduled` policy requires the approved `America/Sao_Paulo`
timezone and a valid non-empty weekly schedule.

Policies can be evaluated at an explicit instant. `always` produces the
`available` expectation, while `manual` and `disabled` preserve those explicit
states. A `scheduled` policy produces `available` or `unavailable` by evaluating
its half-open, minute-precision windows in `America/Sao_Paulo`. Conversion uses
the Node.js runtime timezone database rather than a fixed UTC offset.

The scheduling domain also defines immutable temporary overrides with the
canonical kinds `keep_available` and `suspend_schedule`. Every override requires
a canonical millisecond-precision UTC expiration timestamp later than an
explicit reference instant.

Policies can be evaluated with a validated override or `null` when none exists.
Overrides are active strictly before expiration; expired overrides delegate to
normal policy evaluation. For non-disabled policies, active `keep_available`
produces `available`, while active `suspend_schedule` produces `manual`.
`disabled` always has higher precedence. Override evaluation introduces no
storage, cancellation, scheduler, or automatic service control.

Service management defines an application port for associating at most one
active override with each exact registered-service identifier. Its initial
adapter stores only in process memory: saving replaces the existing association,
and removing a missing association is an idempotent success. Expired overrides
are not removed or evaluated automatically. The store is not connected to
production composition, HTTP creation or cancellation flows, and all stored
state is lost with the adapter instance or process.

An application use case can set or replace an override after resolving the
service through the registered-service catalog. It obtains the reference
instant from the injected application clock, delegates construction to the
scheduling-domain factory, saves under the catalog-owned service ID, and returns
the exact canonical override. Setting an override performs no immediate service
operation or policy-compatibility check.

A separate cancellation use case resolves the service through the catalog and
removes its stored override association using the catalog-owned ID. Removal is
idempotent for known services, including repeated cancellation when no override
is stored, and returns no domain result. Cancellation uses no clock, performs no
availability evaluation or immediate service operation.

Service-management composition exposes both set and cancel commands backed by
one private override store per composition instance. The default store is in
memory, and a custom implementation can be injected through the composition
seam. Setting uses the existing composition clock; cancellation does not. The
temporary state is isolated between composition instances and is lost when its
instance or process is discarded.

An application query resolves a registered service through the catalog, reads
its stored override, obtains one instant from the injected clock, and delegates
effective availability calculation to the existing domain evaluator. It returns
only `available`, `unavailable`, `manual`, or `disabled`. Missing and expired
overrides fall back to the base policy without deleting stored state. The query
does not retrieve actual service status or execute a service operation, and is
exposed through service-management composition. It shares the same catalog,
private override store, and clock used by the existing capabilities, so set,
cancel, and query observe one consistent override state. Independent composition
instances remain isolated. No active-override data query, scheduler, automatic
service operation, or HTTP override endpoint exists yet.

A pure reconciliation decision model compares an effective availability
expectation with an observed runtime state. Only `available + stopped` selects
`start`, and only `unavailable + running` selects `stop`. Already satisfied
states, `manual`, `disabled`, `failed`, and `unknown` produce an explicit
no-operation decision; reconciliation never selects `restart`. The model
retrieves no status and executes no control. Scheduler execution and duplicate
execution prevention are not implemented yet.

A read-only application use case plans availability reconciliation for one
catalog-owned service. It reads the stored override and current runtime state,
then obtains one instant from the application clock and delegates effective
availability and reconciliation rules to the existing domain functions. The
result is `execute start`, `execute stop`, or `none`. Planning does not inspect
supported operations, mutate override state, execute service control, or prevent
duplicate execution. It is not connected to a scheduler or HTTP delivery.

Service-management composition exposes reconciliation planning as an on-demand
internal capability. It shares the catalog, private override store, dispatching
status reader, and application clock with the existing capabilities, so set,
replacement, cancellation, status, effective availability, and planning observe
consistent dependencies. Planning still only returns `execute start`, `execute
stop`, or `none`; it does not inspect supported operations or execute control.
No scheduler, duplicate-execution protection, or HTTP endpoint exists yet.

Service-management composition exposes an explicit reconciliation execution
use case as an on-demand internal capability. It reuses the exact planning and
manual-control capabilities exposed by the same composition instance, so
planning and execution share catalog, override, status, and clock behavior,
while manual control and reconciliation execution share allowlist and controller
behavior. A `none` decision performs no service operation; `execute start` and
`execute stop` delegate through existing control and return its canonical
result. Reconciliation never selects `restart`, and failures propagate without
retries. Repeated explicit calls are not deduplicated. Execution must not be
scheduled automatically until duplicate-execution protection exists; no
scheduler or HTTP endpoint exists yet.

A canonical immutable reconciliation occurrence identifies scheduled intent by
the exact tuple of registered-service ID, `start` or `stop`, and canonical UTC
`scheduledFor` instant. Equality compares all three fields exactly, so scheduled
time remains distinct from processing or control-completion time. The model
does not generate transitions, execute operations, or provide occurrence
storage, claims, locks, or leases. Duplicate-execution prevention is therefore
not complete, no scheduler loop exists, and reconciliation execution remains
explicitly invoked.

Implicit current-time acquisition, environment or registered-service
configuration integration, automatic reconciliation, default policies, scheduler
execution, override execution, and automatic service control are not implemented
yet.

## Technology context

Currently configured:

- Node.js 24 LTS;
- npm;
- TypeScript;
- ESLint;
- Prettier;
- Express.js;
- Vitest;
- Supertest.

Approved for upcoming implementation:

- Zod;
- Pino.

Relevant infrastructure technologies include:

- PM2;
- Nginx;
- systemd;
- Docker;
- Cloudflare Tunnel.

## Requirements

For local development, install:

- Node.js 24;
- npm;
- Git.

Using NVM is recommended because the repository includes a `.nvmrc` file.

## Local development

Clone the repository and enter the project directory:

```bash
git clone https://github.com/gustavopinto244/atlas-manager.git
cd atlas-manager
```

Select the expected Node.js version:

```bash
nvm install
nvm use
```

Install the dependencies:

```bash
npm install
```

Run the development entry point:

```bash
npm run dev
```

### Health endpoints

While the application is running, access `GET /health/live` at
`http://127.0.0.1:3000/health/live` to verify that the HTTP process is alive. A
successful response has HTTP status 200 and the following JSON body:

```json
{
  "status": "ok"
}
```

This endpoint reports only whether the Atlas Manager HTTP process is alive. It
does not collect or expose health information about the Atlas host.

Access `GET /health/server` at
`http://127.0.0.1:3000/health/server` to retrieve the approved operational
metrics collected from the host. A successful response has HTTP status 200 and
the following structure:

```json
{
  "capturedAt": "2026-07-20T12:00:00.000Z",
  "uptimeSeconds": 7200,
  "memory": {
    "totalBytes": 8000000000,
    "freeBytes": 2000000000,
    "usedBytes": 6000000000,
    "usagePercentage": 75
  },
  "cpu": {
    "usagePercentage": 23.5,
    "temperatureCelsius": 47.25
  },
  "cpuLoadAverage": {
    "oneMinute": 0.42,
    "fiveMinutes": 0.31,
    "fifteenMinutes": 0.24
  },
  "disk": {
    "totalBytes": 240000000000,
    "availableBytes": 90000000000,
    "usedBytes": 150000000000,
    "usagePercentage": 62.5
  }
}
```

The timestamp uses ISO 8601, uptime uses seconds, memory values use bytes,
memory usage is a percentage from 0 through 100, CPU utilization is a
percentage from 0 through 100, and CPU load averages are dimensionless values
for their stated time windows. `cpu.temperatureCelsius` reports the approved
CPU package sensor in degrees Celsius, or `null` when that optional sensor is
unavailable. The disk object
represents the root filesystem: `totalBytes` is its total capacity,
`availableBytes` is the capacity available to the unprivileged Atlas Manager
process, `usedBytes` is total capacity minus available capacity, and
`usagePercentage` is the used proportion from 0 through 100. The monitored
path is an infrastructure detail and is not returned. This endpoint does not
expose hostnames, usernames, network configuration, process listings,
environment variables, credentials, filesystem paths, mount information, or
device identifiers.

Neither health endpoint represents Docker, PM2, systemd, database, or managed-
service health.

### Registered-service status infrastructure

The service-management feature can retrieve project-defined runtime states
through isolated adapters. PM2 is the first production status integration. It
uses the registered service's catalog-owned external resource identifier only
inside the infrastructure boundary and translates PM2 statuses into
`running`, `stopped`, `failed`, or `unknown`.

The PM2 integration executes only the fixed read-only `pm2 jlist` operation
without a shell. Its execution time and output size are bounded. Raw PM2
statuses, process metadata, paths, environment values, and complete process
list output are not part of the application contract.

A narrow infrastructure dispatcher selects the explicitly injected `mock` or
`pm2` status reader using only the registered service's validated management
adapter. The application use case remains independent of concrete readers.
Reader mappings cannot be registered or replaced dynamically, and failures
continue to originate from the selected reader without fallback. No HTTP
endpoint or production service catalog is configured for this capability.

### Registered-service control infrastructure

Service control is separate from status retrieval. The application control
flow resolves a catalog-owned service by its stable identifier and permits only
the `start`, `stop`, or `restart` operations explicitly included in that
service's supported-operation allowlist before delegating to infrastructure.
The safe completion result contains only the stable service identifier,
approved operation, and completion timestamp.

The deterministic mock controller changes no host or simulated status state.
PM2 is the first real service-control adapter. It resolves the registered
external resource identifier through an exact `pm2 jlist` name match, validates
the selected internal PM2 ID, and executes only `start`, `stop`, or `restart`
against that ID. Both PM2 process boundaries use direct execution without a
shell, a fixed five-second timeout, and a bounded 1 MiB output buffer.

Successful delegation means only that the adapter operation completed without
reporting a failure; it does not imply service health, readiness, reachability,
or a resulting runtime state. Raw PM2 data and internal IDs are not part of the
application result.

A narrow infrastructure dispatcher selects the explicitly injected `mock` or
`pm2` controller using only the registered service's validated management
adapter. Controller mappings are fixed after construction and cannot be
registered or replaced dynamically. The application use case remains
independent of concrete controllers, continues to enforce supported operations
before dispatch, and receives controller-specific failures unchanged without
fallback. No HTTP endpoint, production service configuration, or production
control composition is introduced.

### Service-management composition

A feature-level composition factory assembles `ListRegisteredServices`,
`GetRegisteredServiceStatus`, and `ControlRegisteredService` behind a frozen
capability bundle. All three use cases share one environment-created catalog.
Status and control share one application clock, while PM2 status and control
share one bounded process-list executor.

The factory explicitly assembles the mock and PM2 adapters with their status
and controller dispatchers. Construction performs only bounded configuration
parsing and object creation: it does not execute PM2, retrieve status, control a
service, start HTTP, or register signal handlers. The capability bundle exposes
only the three application use cases.

This feature composition is not connected to `main.ts`, `createApp`, or HTTP
delivery. Production startup integration remains a separate future Issue.

Stop the development process with `Ctrl+C`.

## Environment configuration

Atlas Manager validates its environment configuration before starting the HTTP
server. The supported variables are optional:

| Variable                   | Default     | Purpose                            |
| -------------------------- | ----------- | ---------------------------------- |
| `HOST`                     | `127.0.0.1` | Address used by the HTTP listener  |
| `PORT`                     | `3000`      | TCP port used by the HTTP listener |
| `LOG_LEVEL`                | `info`      | Minimum structured logging level   |
| `REGISTERED_SERVICES_JSON` | `[]`        | Deployment-owned service allowlist |

The repository includes a safe `.env.example` documenting these variables. The
application reads variables from the process environment; it does not load
`.env` files automatically.

Start the development process with custom values:

```bash
HOST=0.0.0.0 PORT=8080 npm run dev
```

Or configure the compiled production entry point:

```bash
npm run build
HOST=0.0.0.0 PORT=8080 npm start
```

`PORT` must be an integer from `1` through `65535`. Invalid configuration stops
startup before the server begins listening.

### Registered-service catalog configuration

`REGISTERED_SERVICES_JSON` is a deployment-owned JSON array used to construct a
validated, immutable registered-service catalog. An absent variable or explicit
`[]` produces an empty catalog; an empty string is invalid. Each entry must
contain exactly `id`, `displayName`, `managementAdapter`,
`externalResourceId`, `supportedOperations`, and `availabilityPolicy`. The
previous five-field entry shape is no longer valid, and no policy default is
selected.

```json
[
  {
    "id": "example-service",
    "displayName": "Example Service",
    "managementAdapter": "mock",
    "externalResourceId": "example-service-target",
    "supportedOperations": ["readStatus", "start", "stop", "restart"],
    "availabilityPolicy": {
      "mode": "manual"
    }
  }
]
```

Non-scheduled policies use exactly one of the modes `always`, `manual`, or
`disabled` and contain no scheduling fields. A scheduled entry has this nested
policy shape:

```json
{
  "availabilityPolicy": {
    "mode": "scheduled",
    "timezone": "America/Sao_Paulo",
    "windows": [
      {
        "weekday": "monday",
        "start": "09:00",
        "end": "17:00"
      }
    ]
  }
}
```

Every scheduled policy requires the explicit `America/Sao_Paulo` timezone and
at least one valid weekly window. Policy association does not create a
scheduler or automatic start and stop behavior; existing manual status and
control flows remain unchanged.

Approved adapters are `mock` and `pm2`. Approved operations are `readStatus`,
`start`, `stop`, and `restart`, and every service must include `readStatus`.
Duplicate stable IDs and duplicate external resources under the same adapter
are rejected. The configuration is limited to 100 services and 65,536 UTF-8
bytes.

Configuration is loaded only through the explicit feature loader and cannot be
registered or reloaded through HTTP at runtime. Changes will require an
application restart after a future startup-composition Issue connects the
feature capability bundle to the running application. No production services
are configured, and service management remains absent from `main.ts`.

### Structured logging

Atlas Manager writes application lifecycle events as newline-delimited JSON
using Pino. The initial supported levels are `trace`, `debug`, `info`, `warn`,
`error`, `fatal`, and `silent`. The default level is `info`.

For example, start the application with debug-level logging:

```bash
LOG_LEVEL=debug npm start
```

Successful startup writes an `http_server_started` event containing the
configured host and port. Startup logging does not include the complete process
environment. HTTP request logging is not configured.

## HTTP error responses

HTTP errors use a stable JSON envelope:

```json
{
  "error": {
    "code": "route_not_found",
    "message": "Route not found"
  }
}
```

Unknown routes return status `404` with code `route_not_found`. Unexpected
failures return status `500` with code `internal_error` and the message
`Internal server error`. Responses never include raw errors, stack traces, or
internal paths.

Unexpected HTTP failures produce a structured `http_request_failed` log event
containing only the request method, path, and error type. Request bodies,
headers, cookies, query contents, and complete error stacks are not logged.

## Graceful shutdown

The production process handles `SIGINT` and `SIGTERM`. When either signal is
received, Atlas Manager stops accepting new HTTP connections, waits for the
listener to close, and then allows the process to terminate naturally.

Use `Ctrl+C` to send `SIGINT` during local development. Process managers and
operating systems may send `SIGTERM`.

A successful shutdown emits the structured lifecycle events
`application_shutdown_started` and `application_shutdown_completed`. A closure
failure emits `application_shutdown_failed` and sets a non-zero process exit
code. Repeated termination signals share the shutdown already in progress and
do not close the server more than once.

## Continuous integration

GitHub Actions automatically validates Pull Requests targeting `main` and
pushes merged into `main`. The CI workflow installs dependencies with `npm ci`
on Node.js 24, then checks formatting, linting, types, tests, and the production
build. A failure in any step fails the workflow.

The same validation commands remain available locally in the following
sections.

## Available scripts

### Development

```bash
npm run dev
```

Runs the TypeScript entry point in watch mode using `tsx`.

### Type checking

```bash
npm run typecheck
```

Checks the TypeScript code without generating build files.

### Build

```bash
npm run build
```

Compiles the TypeScript source code from `src/` into `dist/`.

### Production entry point

```bash
npm start
```

Runs the compiled JavaScript entry point from `dist/`.

Run `npm run build` before using this command.

### Lint

```bash
npm run lint
```

Checks the project using ESLint.

```bash
npm run lint:fix
```

Automatically fixes supported ESLint issues.

### Formatting

```bash
npm run format
```

Formats supported project files using Prettier.

```bash
npm run format:check
```

Checks formatting without modifying files.

### Tests

```bash
npm test
```

Runs the test suite once using Vitest.

```bash
npm run test:watch
```

Runs Vitest in watch mode and executes affected tests again when project files
change.

## Repository structure

```text
atlas-manager/
├── docs/
│   ├── adr/
│   ├── product-vision.md
│   └── requirements.md
├── src/
│   ├── config/
│   │   └── environment.ts
│   ├── http/
│   │   ├── errors/
│   │   ├── middleware/
│   │   └── create-app.ts
│   ├── logging/
│   │   └── logger.ts
│   ├── lifecycle/
│   │   └── graceful-shutdown.ts
│   └── main.ts
├── tests/
│   ├── config/
│   │   └── environment.test.ts
│   ├── http/
│   │   └── app.test.ts
│   ├── logging/
│   │   └── logger.test.ts
│   ├── lifecycle/
│   │   └── graceful-shutdown.test.ts
│   └── test-infrastructure.test.ts
├── AGENTS.md
├── eslint.config.js
├── package.json
├── tsconfig.json
└── README.md
```

Generated directories such as `node_modules/` and `dist/` are not versioned.

## Documentation

Detailed project context is available in:

- [Product vision](docs/product-vision.md)
- [Initial requirements](docs/requirements.md)
- [High-level architecture](docs/architecture.md)
- [Project glossary](docs/glossary.md)
- [Project roadmap](docs/roadmap.md)
- [Security model](docs/security-model.md)
- [Architecture Decision Records](docs/adr/)
- [Coding-agent instructions](AGENTS.md)

## Development workflow

The project follows this workflow:

1. GitHub Issue;
2. short-lived branch;
3. scoped implementation;
4. automated validation;
5. Pull Request;
6. review;
7. squash merge.

Commit messages follow the Conventional Commits convention.
