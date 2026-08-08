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

For continuity between agents, review `docs/agent-handoff.md` when it exists.
It records active uncommitted work, validation status, and safe next steps;
the current working tree remains authoritative if it differs.

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

### Implementation explanation style

Use a medium level of technical complexity when explaining implementations.
The explanation should be detailed enough for the primary developer to
understand and reproduce the reasoning without becoming a line-by-line code
commentary or an exhaustive discussion of language internals.

Implementation explanations should:

- begin with the problem solved and the resulting behavior;
- describe the responsibilities of the main files, types, and functions;
- explain important validation rules, data flow, architectural boundaries, and
  security decisions;
- include the reason behind non-obvious implementation choices and relevant
  tradeoffs;
- connect tests to the behavior and risks they protect;
- define unfamiliar technical terms briefly when they first appear;
- use small code examples only when they materially improve understanding;
- avoid unexplained jargon, unnecessary theory, and incidental implementation
  details that do not affect behavior or maintainability.

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

### Mandatory Git flow

Before starting a new change:

1. Check the working tree.
2. Switch to `main`.
3. Run `git pull origin main`.
4. Create a new branch for the requested work.
5. Perform all work on that branch.

Never begin a new implementation directly on an old branch without first
checking the repository state and following this flow.

### Authorized Git commands

The agent may normally use `git pull`, `git switch`, `git checkout`, and
`git add` when following the mandatory branch flow above. `git commit` and
`git push` each require explicit user authorization for the requested action;
do not commit or push merely because implementation and validation are complete.

Merging into `main`, force-pushing, creating tags, and creating releases remain
outside this flow and must not be done automatically.

### SSH access to Atlas

The agent may use the `atlas` SSH alias to inspect the physical Atlas host and
perform Atlas Manager work that is part of the requested task:

```bash
ssh atlas
ssh atlas '<command>'
```

Treat this as access to the real physical host. Apply special caution to
operations with physical effects, including power, shutdown, wake alarms, RTC,
or other potentially destructive actions.

## Working rules for Codex

Before modifying files:

1. Follow the mandatory Git flow. Never modify files directly on `main`.
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
