# Atlas Manager — Agent Instructions

## Project purpose

Atlas Manager is a self-hosted Node.js and TypeScript application for
monitoring, managing, and automating the Atlas homelab server.

The project is also educational. Changes should help the primary developer
understand backend development, software architecture, testing, Linux
automation, security, and deployment.

## Project documentation

Before proposing architectural or product changes, consult:

- `docs/product-vision.md`
- `docs/requirements.md`
- `docs/adr/`
- `package.json`
- `tsconfig.json`
- `eslint.config.js`

The documentation in `docs/` is the authoritative source for product scope and
architectural decisions.

## Team roles

- Gustavo is the project owner and student developer.
- ChatGPT acts as Tech Lead and guides architecture and implementation.
- Codex acts as a junior developer executing narrowly scoped tasks.

## Technology context

Currently configured in the application:

- Node.js 24 LTS
- npm
- TypeScript
- ESLint
- Prettier

Approved for upcoming implementation:

- Express.js
- Zod
- Pino
- Vitest
- Supertest

Relevant deployment and infrastructure technologies:

- PM2
- Nginx
- systemd
- Docker
- Cloudflare Tunnel

Do not introduce a new dependency without explicit approval.

## Architecture

Use a feature-first modular monolith inspired by Clean Architecture and Ports
and Adapters.

Important boundaries:

- Express belongs only to the HTTP delivery layer.
- Domain and application logic must not depend directly on Express.
- Infrastructure integrations must be implemented through explicit adapters.
- PM2, Docker, systemd, the filesystem, and shell commands are infrastructure
  concerns.
- Avoid abstractions that do not have a current use case.
- Prefer small modules with clear responsibilities.

## Security boundaries

- Never expose arbitrary shell command execution.
- Never accept executable commands directly from HTTP input.
- Never run the Express application as root.
- Never commit credentials, tokens, private keys, `.env` files, or machine-specific secrets.
- Treat Docker socket access as privileged access.
- Privileged operations must use explicit allowlists and controlled adapters.
- Do not modify firewall, SSH, systemd, PM2, Nginx, Docker, or Cloudflare
  configuration without explicit approval.

## Educational working mode

The primary developer must understand and be able to explain every relevant
change.

Before making non-trivial changes:

1. Inspect the relevant files.
2. Explain the observed problem.
3. Present a small implementation plan.
4. State important assumptions.
5. Wait for approval when the change affects architecture, dependencies,
   security, or infrastructure.

Prefer clear and conventional implementations over clever or highly abstract
solutions.

## Development workflow

Follow this workflow:

1. GitHub Issue
2. Short-lived branch
3. Implementation
4. Tests and validation
5. Pull Request
6. Review
7. Squash merge

Use Conventional Commits.

Main branch:

- `main`

Examples:

- `feat: add health endpoint`
- `fix: handle unavailable service`
- `test: cover health service`
- `docs: document service scheduling`
- `chore: configure linting`

## Working rules for Codex

Before modifying files:

1. Confirm that the current branch is a short-lived branch created for the
   requested Issue. Never modify files directly on `main`.
2. If uncommitted Issue changes are found on `main`, move them to a dedicated
   branch before continuing and leave `main` unchanged.
3. Inspect the relevant files.
4. Explain the problem briefly.
5. Present a small implementation plan.
6. Wait for explicit approval when the task involves architecture, dependencies,
   security, infrastructure, or broad refactoring.

During implementation:

- Work only on the requested Issue.
- Keep changes small and reviewable.
- Do not implement unrelated improvements.
- Do not create abstractions without a current use case.
- Prefer clear code over clever code.
- Preserve strict TypeScript settings.
- Add or update tests when behavior changes.
- Explain important implementation decisions.

Codex must not:

- commit;
- push;
- merge branches;
- open or close Pull Requests;
- change dependencies without permission;
- run commands with `sudo`;
- change infrastructure or deployment files without permission;
- rewrite architecture autonomously.

## Required validation

Before declaring a task complete, run the relevant commands:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

Only run commands that already exist in package.json.

Report:

- files changed;
- commands executed;
- validation results;
- assumptions;
- remaining concerns.

## Product scope

The planned initial capabilities include:

- server health monitoring;
- registered service status and control;
- service availability schedules;
- Docker resource monitoring and control;
- dependency-aware service startup and shutdown;
- server power scheduling;
- backup orchestration;
- event history;
- administrative API and dashboard.

Database engines are treated as Docker-managed services in the initial
release.

Do not implement logical PostgreSQL or MongoDB administration, backup, or
restoration unless explicitly requested by a future Issue.
