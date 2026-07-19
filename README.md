# Atlas Manager

Atlas Manager is a self-hosted Node.js and TypeScript application for
monitoring, managing, and automating the Atlas homelab server.

The project is also an educational environment for learning backend
development, software architecture, testing, Linux automation, security, and
deployment through practical implementation.

## Project status

Atlas Manager is currently in its initial foundation phase.

The repository currently includes:

- product vision and initial requirements;
- the architectural decision to use Express.js;
- Node.js and TypeScript configuration;
- ESLint and Prettier configuration;
- coding-agent instructions.

The administrative API and server-management features have not been
implemented yet.

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
- Prettier.

Approved for upcoming implementation:

- Express.js;
- Zod;
- Pino;
- Vitest;
- Supertest.

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

Stop the development process with `Ctrl+C`.

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
│   └── main.ts
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
