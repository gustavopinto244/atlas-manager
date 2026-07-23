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

Stop the development process with `Ctrl+C`.

## Environment configuration

Atlas Manager validates its environment configuration before starting the HTTP
server. Both supported variables are optional:

| Variable    | Default     | Purpose                            |
| ----------- | ----------- | ---------------------------------- |
| `HOST`      | `127.0.0.1` | Address used by the HTTP listener  |
| `PORT`      | `3000`      | TCP port used by the HTTP listener |
| `LOG_LEVEL` | `info`      | Minimum structured logging level   |

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
