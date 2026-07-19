# Contributing to Atlas Manager

Thank you for contributing to Atlas Manager.

Atlas Manager is both a self-hosted server-management application and an
educational software-engineering project. Contributions should improve the
product while keeping the implementation understandable, secure, focused, and
reviewable.

## Project context

Before contributing, read the documentation relevant to the task:

- [Project README](README.md)
- [Product vision](docs/product-vision.md)
- [Initial requirements](docs/requirements.md)
- [High-level architecture](docs/architecture.md)
- [Architecture Decision Records](docs/adr/)
- [Coding-agent instructions](AGENTS.md)

The documentation under `docs/` is the authoritative source for product scope
and architectural decisions.

## Development requirements

The project currently requires:

- Git;
- Node.js 24 LTS;
- npm.

The repository includes a `.nvmrc` file. With NVM installed, select the
supported runtime using:

```bash
nvm install
nvm use
```

Install the project dependencies with:

```bash
npm install
```

## Contribution workflow

Atlas Manager follows an Issue-first workflow:

1. create or select a GitHub Issue;
2. confirm the task scope and acceptance criteria;
3. create a short-lived branch from the latest `main`;
4. implement only the requested scope;
5. run the relevant validations;
6. review the staged changes;
7. open a Pull Request;
8. review the Pull Request;
9. squash and merge into `main`;
10. update the local repository and delete the completed branch.

Changes should not be implemented directly on `main`.

## GitHub numbering

GitHub Issues and Pull Requests share the same numeric sequence inside the
repository.

For example:

```text
Issue #17
Pull Request #18
Issue #19
Pull Request #20
```

The Pull Request description must reference the number of the related Issue,
not the number of the Pull Request itself.

Example:

```md
## Related issue

Closes #17
```

Always confirm the real Issue number before opening the Pull Request.

## Starting a task

Before creating a branch, update the local `main`:

```bash
git switch main
git pull origin main
```

Create a short-lived branch related to the Issue:

```bash
git switch -c <branch-name>
```

Examples:

```text
feat/server-health
fix/service-status-timeout
test/health-use-case
docs/add-contributing-guide
chore/configure-testing
refactor/service-catalog
```

Recommended branch prefixes include:

- `feat/` for product functionality;
- `fix/` for bug fixes;
- `test/` for test-related work;
- `docs/` for documentation;
- `chore/` for tooling and maintenance;
- `refactor/` for internal restructuring without intended behavior changes.

Branch names should be short, lowercase, and separated with hyphens.

## Scope control

Each branch and Pull Request should address one coherent Issue.

Contributors should:

- implement only the requested acceptance criteria;
- avoid unrelated cleanup;
- avoid speculative abstractions;
- keep changes small enough to review;
- document relevant assumptions;
- create a separate Issue for newly discovered work.

A useful improvement discovered during implementation should not automatically
be included in the current Pull Request.

## Dependencies

Do not add, remove, downgrade, or upgrade dependencies without explicit
approval.

A proposed dependency change should explain:

- the problem being solved;
- the considered alternatives;
- why the dependency is appropriate;
- maintenance and security implications;
- runtime or bundle implications when relevant;
- compatibility with the supported Node.js and TypeScript versions.

Major technology decisions may require an Architecture Decision Record.

Do not use options such as:

```text
--force
--legacy-peer-deps
```

merely to bypass an unresolved dependency compatibility problem.

## Code style

The project uses:

- strict TypeScript;
- ESM modules;
- ESLint for static analysis;
- Prettier for formatting.

Prefer:

- explicit and readable code;
- small modules with clear responsibilities;
- project-defined types at architectural boundaries;
- dependency injection through constructors or explicit factory functions;
- type-only imports when appropriate;
- predictable error handling;
- simple implementations that solve a current requirement.

Avoid:

- unnecessary type assertions;
- `any` without a documented reason;
- framework-specific types in application or domain logic;
- hidden side effects;
- arbitrary shell-command construction;
- abstractions without a current use case;
- unrelated refactoring during a scoped task.

## Architecture

Contributions must respect the boundaries defined in
`docs/architecture.md`.

Important rules include:

- Express belongs only to the HTTP delivery layer;
- application and domain logic must not depend directly on Express;
- external systems must be accessed through explicit ports and adapters;
- infrastructure adapters must not decide business policies;
- privileged operations must be narrow, explicit, and controlled;
- dependencies should point toward application and domain rules.

Major architectural changes require discussion and may require a new ADR.

## Security-sensitive changes

Changes involving any of the following require explicit review before
implementation:

- shell commands;
- filesystem writes;
- Docker control;
- PM2 control;
- systemd services;
- server shutdown or wake scheduling;
- backup execution;
- authentication or authorization;
- credentials or environment variables;
- Nginx, Cloudflare, SSH, or firewall configuration;
- elevated operating-system permissions.

The application must never:

- expose unrestricted shell execution;
- accept arbitrary executable commands through HTTP input;
- concatenate untrusted input into shell commands;
- accept arbitrary service names or filesystem paths;
- run the Express process as root;
- expose unrestricted Docker socket operations.

Never commit:

- `.env` files;
- access tokens;
- passwords;
- private keys;
- Cloudflare credentials;
- machine-specific secrets;
- production configuration containing sensitive values.

## Available validation commands

Run the relevant validation commands before opening a Pull Request:

```bash
npm run format:check
npm run lint
npm run typecheck
npm run build
```

Use the following command to apply Prettier formatting:

```bash
npm run format
```

Use the following command to apply supported ESLint fixes:

```bash
npm run lint:fix
```

Only run scripts that currently exist in `package.json`.

Automated tests will become part of the required validation process after the
testing infrastructure is introduced.

## Reviewing changes

Before staging files, inspect the working tree:

```bash
git status
git diff
```

Files may be added individually when tighter scope control is useful:

```bash
git add <file>
```

Using the following command is acceptable after reviewing all changes:

```bash
git add .
```

Before committing, review exactly what is staged:

```bash
git status
git diff --staged --check
git diff --staged
```

Confirm that:

- every staged file belongs to the current Issue;
- no credentials or secrets are present;
- no generated files are present;
- no unrelated changes are present.

Generated directories such as `node_modules/` and `dist/` must not be
committed.

## Commit messages

Atlas Manager uses Conventional Commits.

Format:

```text
type: concise description
```

Examples:

```text
feat: add server health endpoint
fix: handle unavailable Docker service
test: cover dependency startup order
docs: document contribution workflow
chore: configure test tooling
refactor: isolate service management port
```

Common types include:

- `feat`;
- `fix`;
- `test`;
- `docs`;
- `chore`;
- `refactor`;
- `perf`;
- `build`;
- `ci`.

Commit messages should describe the resulting change, not the process used to
create it.

## Pull Requests

A Pull Request should contain:

- a clear title using Conventional Commits;
- a summary of the implemented changes;
- the related Issue using `Closes #<issue-number>`;
- validation results;
- relevant assumptions or limitations;
- security or architectural considerations when applicable.

Example:

```md
## Summary

Adds the initial server health use case and HTTP endpoint.

The change includes:

- server health data collection;
- an application use case;
- HTTP response mapping;
- validation for the exposed response.

## Related issue

Closes #<issue-number>

## Validation

- [x] `npm run format:check`
- [x] `npm run lint`
- [x] `npm run typecheck`
- [x] `npm run build`

## Notes

- The endpoint exposes only approved non-sensitive system information.
```

Before merging, review the **Files changed** tab and confirm that every changed
file belongs to the related Issue.

## Review expectations

Review should verify that:

- the acceptance criteria are satisfied;
- the change remains within the agreed scope;
- architectural boundaries are respected;
- security-sensitive behavior is controlled;
- errors are handled predictably;
- tests are added when behavior changes and testing infrastructure is
  available;
- documentation is updated when necessary;
- no secrets or generated files are included;
- the primary developer understands the implementation.

A change that works but cannot be reasonably explained or maintained is not
considered complete.

## Merge strategy

Pull Requests should normally use **Squash and merge**.

The squash commit should use a clear Conventional Commit message.

After merging:

```bash
git switch main
git pull origin main
git branch -d <branch-name>
git push origin --delete <branch-name>
```

Confirm the final state:

```bash
git status
git log --oneline --decorate -5
```

The working tree should be clean, and the merged change should appear in the
history of `main`.

## Coding agents

Coding agents must follow `AGENTS.md`.

Agent-generated changes must receive the same human review as manually written
changes.

Unless explicitly authorized, an agent must not:

- broaden the Issue scope;
- add or change dependencies;
- create commits;
- push branches;
- open or merge Pull Requests;
- close Issues;
- modify infrastructure or deployment configuration;
- run privileged commands;
- make architectural decisions independently.

The contributor remains responsible for understanding and validating all
agent-generated changes.

## Definition of Done

A contribution is complete when:

- the related Issue and acceptance criteria are satisfied;
- the implementation remains within the agreed scope;
- relevant validation commands pass;
- behavior changes include appropriate tests when testing is available;
- architecture and security boundaries are respected;
- documentation is updated where necessary;
- no credentials, secrets, or generated files are included;
- staged changes have been reviewed;
- the Pull Request clearly explains the change;
- the primary developer can explain the relevant implementation decisions;
- the Pull Request has been reviewed and squash-merged.
