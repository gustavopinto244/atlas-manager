# Reinstallable package design

## Problem statement

The existing Atlas deployment bundle is reproducible and supports controlled
server installation, upgrade, rollback and uninstall, but it is intentionally
an operator-oriented Linux amd64 artifact with fixed production paths. The new
operator CLI also needs an easy installation path on another computer without
turning that computer into an Atlas server.

One artifact cannot safely satisfy both jobs. This plan defines two products:

1. **Atlas Server Bundle** — privileged Linux server deployment.
2. **Atlas Operator Client** — unprivileged `atlas` CLI for local or remote
   administration.

## Existing server bundle to preserve

The current server bundle already provides:

- deterministic Linux amd64 archive and internal checksums;
- manifest-bound installer and host qualification tools;
- side-by-side releases under `/opt/atlas-manager/releases`;
- atomic `/opt/atlas-manager/current` selection;
- disabled-first install, verification, rollback and uninstall;
- preservation of operator configuration and runtime state;
- dashboard assets, production dependencies and administrative contract.

It deliberately does not create identities, write the real environment,
enable/start systemd or activate power effects. A convenience layer must not
weaken those boundaries.

## Target package inventory

### Atlas Server Bundle

```text
atlas-manager-server_<version>_linux_amd64.tar.gz
  MANIFEST.json
  SHA256SUMS
  INSTALLATION.md
  atlas-manager-installer
  atlas-manager-host-qualification
  atlas-manager-runtime-identity-installer
  atlas-manager-runtime-configuration
  atlas-manager-service-lifecycle
  application/
  dashboard/
  config/
  systemd/
  contracts/
```

The first packaging slice may rename presentation artifacts, but must retain
the existing bundle format and installer verification semantics internally.

### Atlas Operator Client

Initial recommended delivery:

```text
atlas-operator_<version>_all.tgz
  package.json
  dist/cli/
  LICENSE
  README.md
  checksums
```

Installation modes:

```text
npm install --global ./atlas-operator_<version>_all.tgz
npm uninstall --global atlas-operator
```

This first mode requires a supported Node 24 runtime and provides the fastest
path using the existing `bin.atlas` contract. It must be generated from a
dedicated package manifest rather than publishing the entire private server
application package.

A later portability slice may add platform-specific standalone executables or
native packages after evaluating Node SEA, code signing, update semantics and
supported OS/architecture combinations. Do not promise Windows, macOS, `.deb`,
`.rpm` or automatic updates until each artifact has qualification coverage.

## Reinstallation semantics

### Client

- Installing the same version is idempotent and ends with `atlas --version`
  and `atlas doctor` smoke checks.
- Upgrade replaces only client package files.
- Uninstall removes only client files and generated links.
- Endpoint and credentials are not embedded in the package.
- A user-scoped installation under `~/.local` is preferred when global npm
  installation would require elevation.

### Server

- Same-version installation verifies managed content rather than mutating
  unknown state.
- Upgrade installs a new side-by-side release and atomically changes `current`.
- Rollback selects only a previously verified managed release.
- Uninstall preserves configuration, state, event history, backup records and
  scheduler stores by default.
- A future purge operation, if ever added, requires a separate ADR, explicit
  inventory and destructive confirmation. It is not part of this plan.

## Configuration UX

The package must never contain Access JWTs, principal IDs, sudo passwords,
Cloudflare credentials or production environment files.

The client should support:

- `ATLAS_BASE_URL` for endpoint selection;
- a real externally issued Access assertion only through protected process
  memory in the current transport;
- a future interactive Access login only after an ADR defines token storage,
  refresh, logout and OS credential-store behavior;
- `atlas config inspect` only after a schema and secret-redaction contract is
  designed.

The server bundle should provide a versioned example configuration and a
preflight that reports missing requirements without writing the real config.

## Integrity and supply-chain requirements

Every artifact must include or be accompanied by:

- source commit, semantic version, target platform and build toolchain;
- deterministic file manifest and SHA-256 checksums;
- production dependency inventory/SBOM;
- archive traversal and symlink safety validation;
- generated asset equivalence;
- installation, upgrade, rollback, reinstall and uninstall tests;
- release evidence proving Candidate A/B reproducibility;
- optional signatures only after key ownership and rotation are documented.

## Installer usability roadmap

1. Package the existing CLI independently with `npm pack` and smoke-test
   global and user-scoped installs in temporary prefixes.
2. Add a small unprivileged bootstrap command for client installation only;
   it must not accept secrets in arguments.
3. Add a server-side operator wrapper that sequences existing inspect,
   qualification, identity, disabled install and verify tools while preserving
   every confirmation and stop boundary.
4. Evaluate `.deb` only after file ownership, conffile behavior, systemd
   enablement policy, pre/post scripts and rollback semantics have ADR coverage.
5. Evaluate standalone client executables only after reproducibility and
   platform signing requirements are known.

## Package acceptance

`REINSTALLABLE_PACKAGE=PASS` requires clean-machine install, same-version
reinstall, upgrade, rollback and uninstall evidence for every claimed target.
The server package must additionally prove disabled-first behavior and state
preservation. The client package must prove no server files or privileged
operations are installed.
