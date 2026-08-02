# ADR-017 — Distribute Atlas Manager through a reproducible disabled deployment bundle

Status: Accepted

## Decision

Atlas Manager is distributed as a fixed `linux/amd64` tarball containing the
compiled application, production-only npm dependencies, a strict manifest,
SHA-256 inventory, license material, a disabled systemd unit, a safe
environment template, and the operator-only Go installer. The bundle builder
uses isolated temporary workspaces, explicit release metadata, pinned tool
versions, `npm ci --omit=dev --ignore-scripts`, and normalized archive metadata.

The installer discovers its bundle beside its own executable and exposes only
`inspect-bundle`, `install-disabled`, `verify-disabled`, `rollback-disabled`,
and `uninstall-disabled`. Production paths, the Node executable, the systemd
unit, and the runtime identity are fixed in code. Test constructors may inject
sandbox roots, identity fixtures, and runtime checks; production CLI arguments
cannot select those values.

## Independent gates

This decision separates:

```text
application build
application deployment bundle
operator-run installation
runtime user and group definition
systemd service definition
systemd service enablement
application configuration
Linux helper installation
Linux power-effects activation
host qualification
real-effect certification
```

This delivery completes only the application artifact, disabled installation
contract, systemd runtime contract, and file-level upgrade/rollback contract.
It does not create accounts or groups, enroll `atlas-manager-power`, install
the helper, create the real environment file, enable or start systemd,
activate Linux effects, qualify Atlas, or certify a real effect.

## Disabled contract

The unit runs as `atlas-manager:atlas-manager` with
`SupplementaryGroups=atlas-manager-power`, uses `/usr/bin/node`, and has
`Restart=no`. The installer never invokes systemd, creates enablement links,
starts or restarts the service, or reads the contents of the operator-owned
environment file. Upgrade and rollback change only managed release files and
the `current` selector; configuration, application state, event history,
scheduler cursors, occurrence claims, users, groups, and the helper remain
outside the mutation scope.

## Security

The manifest and checksum inventory are closed, canonical, traversal-free,
and reject symbolic links, hard links, and nonregular files. Installation is
serialized by a fixed nonblocking lock and refuses active or enabled service
state, unsafe managed state, unknown releases, modified files, and unsafe
runtime identity or Node.js prerequisites. Checksums provide integrity only;
signing, provenance, publication, physical deployment, host qualification,
and real-effect certification remain later gates.
