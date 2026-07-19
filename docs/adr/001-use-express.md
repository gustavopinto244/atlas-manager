# ADR-001 — Use Express.js as the HTTP framework

## Status

Accepted

## Date

2026-07-18

## Context

Atlas Manager requires an HTTP framework to expose health information,
administrative operations, service controls, schedules, and future dashboard
APIs.

The project is also educational. Its primary developer is learning backend
engineering, architecture, testing, Linux automation, and deployment through
hands-on implementation.

The selected framework should:

- support TypeScript well;
- have a mature ecosystem;
- integrate easily with testing tools;
- avoid hiding HTTP concepts;
- support incremental modular organization;
- remain understandable to the project owner;
- be common enough to provide relevant professional experience.

## Considered options

### Express.js

Express.js is a minimal and widely adopted Node.js HTTP framework.

Advantages:

- mature and stable ecosystem;
- extensive documentation and community material;
- simple middleware model;
- familiar to the project owner;
- compatible with Vitest and Supertest;
- flexible enough for a feature-first modular monolith;
- does not impose a complex application structure.

Disadvantages:

- fewer built-in conventions;
- requires explicit validation, error handling, logging, and architecture;
- incorrect organization can produce tightly coupled code;
- some alternatives may provide better performance or stronger defaults.

### Fastify

Fastify provides strong performance, schema-based validation, and a plugin
architecture.

Advantages:

- high performance;
- structured plugin system;
- built-in schema-oriented features;
- good TypeScript support.

Disadvantages:

- less familiar to the project owner;
- introduces additional concepts before they are required;
- performance is not a current project bottleneck;
- could reduce focus on the underlying learning goals.

### Native Node.js HTTP server

Node.js can expose HTTP services without an external framework.

Advantages:

- minimal dependency surface;
- direct learning of Node.js HTTP primitives;
- maximum control.

Disadvantages:

- requires more infrastructure code;
- increases boilerplate;
- distracts from the primary product goals;
- provides less value for the project's intended professional stack.

## Decision

Atlas Manager will use Express.js as its HTTP framework.

Express will be responsible only for the HTTP delivery layer.

Business and application logic should not depend directly on Express.
Controllers will translate HTTP requests and responses, while services and
adapters will remain independently testable.

The project will use explicit supporting tools for concerns that Express does
not provide by default, including:

- Zod for external input validation;
- Pino for structured logging;
- Vitest for tests;
- Supertest for HTTP integration tests;
- centralized error handling;
- explicit environment validation.

## Consequences

### Positive consequences

- The project uses a framework already understood by its primary developer.
- Development can focus on architecture and product behavior.
- A large ecosystem is available for integration and troubleshooting.
- Express knowledge is transferable to many Node.js backend environments.
- The framework allows the project structure to evolve incrementally.

### Negative consequences

- The team must define and maintain its own architectural conventions.
- Validation and error handling require explicit implementation.
- Middleware ordering can introduce subtle errors.
- Express does not prevent poor separation of concerns.
- Performance may be lower than specialized alternatives, although this is
  not relevant to the expected workload.

## Review conditions

This decision may be reviewed if:

- Express becomes unsupported or unsuitable for the runtime;
- measured performance becomes a real bottleneck;
- a future requirement cannot be implemented safely or clearly with Express;
- the project evolves into a different architecture where another framework
  provides a demonstrated advantage.

Framework replacement must be based on evidence and recorded in a new ADR.

