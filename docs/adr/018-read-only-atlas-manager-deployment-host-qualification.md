# ADR-018 — Qualify Atlas Manager deployment hosts through a separate read-only executable

Status: Accepted

## Decision

Atlas Manager deployment assumptions are evaluated by the separate root-run
`atlas-manager-host-qualification` executable. It accepts only `qualify`,
`verify-prepared`, `verify-disabled-installation`, and `verify-removed`.
Every action uses fixed production resources, emits one bounded canonical JSON
report, and fails closed without creating a lock or changing host state.

## Independent gates

This decision separates:

```text
deployment bundle inspection
deployment host qualification
host preparation
runtime account and group creation
disabled application installation
systemd enablement and startup
Linux helper installation and qualification
Linux power-effects activation
real-effect certification
```

This delivery completes only application deployment qualification,
prepared-host verification, disabled-installation evidence, and removed-state
evidence. It does not create identities, install or execute the helper, invoke
systemd, start Atlas Manager, qualify the physical host, or certify effects.

## Fixed and read-only boundary

The production executable supports only Linux amd64, requires effective UID
zero, and inspects only the fixed Node.js path, account files, systemd paths,
deployment paths, configuration metadata, capacity, and bundle beside the
executable. It may execute only `/usr/bin/node --version`; it never executes
shells, npm, systemd commands, Atlas Manager, or the power helper.

Identity state is classified as absent, ready, or blocked. A completely absent
identity contract may produce `preparation_required`; partial or conflicting
identity state blocks. A passing `verify-prepared` report authorizes only a
separate operator decision to run `install-disabled`.

Qualification does not adopt or repair unmanaged files. It does not inspect
operator configuration contents or application state contents, and it does
not replace the separate power-helper host-qualification authority.
