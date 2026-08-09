# ADR-030 — Start server installation orchestration with a read-only planner

Status: Accepted

## Context

Atlas Manager already has independently qualified tools for bundle integrity,
host qualification, runtime identity preparation, disabled installation,
runtime configuration and service lifecycle. The operator currently has to
understand their ordering and interpret several JSON reports manually.

A convenience installer that reimplements those checks or hides confirmations
would weaken the existing privilege and recovery boundaries. A shell wrapper
would also make report parsing, cancellation and tests fragile.

## Decision

Add a Go executable named `atlas-manager-server-installer` to the server bundle.
Its first contract supports only `inspect` and `plan`.

The binary resolves a closed allowlist of sibling executables and invokes only
their read-only actions without a shell:

```text
atlas-manager-installer inspect-bundle
atlas-manager-host-qualification qualify
atlas-manager-host-qualification verify-prepared
atlas-manager-host-qualification verify-disabled-installation
atlas-manager-host-qualification verify-removed
atlas-manager-runtime-identity-installer inspect
atlas-manager-runtime-configuration inspect
atlas-manager-administrative-runtime-configuration inspect
atlas-manager-service-lifecycle inspect
```

The orchestrator accepts bounded canonical JSON reports from report-producing
tools. Exit zero means the observation passed. Exit one with a valid report is
a blocked observation and remains useful evidence. Missing output, malformed
JSON, wrong action/schema, oversized output, signals or other execution errors
fail closed.

`plan` derives only an installation-state classification and a next boundary.
It never supplies a confirmation or invokes a mutation. Existing tools remain
the sole owners of validation, locks, filesystem changes, systemd interaction,
persistence, rollback and recovery.

## Privilege boundary

The orchestrator does not invoke `sudo`, accept passwords, read secrets or
elevate itself. It may be run without root, in which case root-required tools
report their blockers. A future mutation action will require a separate ADR
amendment and explicit elevation/confirmation UX.

No user-controlled executable path, action, environment override or request
argument is forwarded. Production binaries are resolved beside the planner.
Tests inject a runner and synthetic reports instead of invoking host tools.

## State model

The planner may classify:

- `preparation_required` — safe absent deployment needs explicit identity
  preparation;
- `disabled_installation_ready` — identity/host preparation permits a separate
  disabled install;
- `disabled_installation` — managed disabled deployment verified;
- `active_mock` — lifecycle reports the mock service active; deactivation is a
  separate boundary before deployment mutation;
- `removed` — managed application deployment is absent after removal;
- `blocked` — no safe next mutation can be proposed from current evidence.

The report never treats one blocked probe as several independent failures.
Hard failures are distinguished from an ordinary blocked host report.

## Consequences

- Operators gain one deterministic read-only entrypoint before any convenience
  mutation path exists.
- The server bundle gains one executable and corresponding manifest/checksum
  entry.
- Existing low-level commands remain available for break-glass diagnosis.
- Activation, Cloudflare, Nginx, PM2 and power effects are outside this binary.
- Install/reinstall/upgrade/rollback/uninstall mutation orchestration remains
  deferred until sandbox scenarios prove the plan contract.
