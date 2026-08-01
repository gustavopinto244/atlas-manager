# ADR-005 — Implement the Linux power helper as a group-gated setuid compiled executable

## Status

Accepted

## Date

2026-08-01

## Context

Atlas Manager is an unprivileged Node.js application. ADR-002 established a
fixed, no-shell transport, but root ownership of a file does not make a
process started by an unprivileged user privileged. Before any operating-
system power effect is reviewed, the executable privilege boundary itself
must be explicit, testable, and deployable without granting root to the
complete application.

## Considered options

### Running Atlas Manager as root

Rejected. HTTP delivery, dependencies, service management, and unrelated
features must remain unprivileged.

### An unrestricted sudo command

Rejected. The application must not accept arbitrary commands, arguments,
paths, or executables, and it must not invoke `sudo`, `su`, `sh`, or `bash`.

### Linux file capabilities

Rejected for the first helper implementation. Broad capabilities such as
`CAP_SYS_ADMIN` create a larger and less reviewable privilege surface than
the fixed operation protocol.

### A long-running privileged daemon

Deferred. A daemon would require a new socket, peer-credential, lifecycle,
recovery, and concurrency design rather than the reviewed one-process
transport.

### A compiled setuid-root executable

Accepted for the current fixed-process design. The helper is a standalone
memory-safe Go ELF executable, owned by root, executable only by a dedicated
non-root Atlas power group, setuid-root, non-writable by group and others,
short-lived, no-argument, strict-input, strict-output, and deny-all until
future backend Issues are reviewed.

## Decision

The helper is built as a pinned Go module with `CGO_ENABLED=0` and installed
only by a later operator-controlled procedure at:

```text
/usr/local/libexec/atlas-manager-power-helper
```

The intended installed state is root owner, dedicated group
`atlas-manager-power`, and mode `04750`. The group ID is installation-specific
and is never compiled into the binary or supplied by application input. The
application-side inspector checks the exact mode, root ownership, nonzero
helper group, process group membership, and safe root-owned parent directory;
it never repairs the installation.

The helper handles exactly one bounded version-one JSON request and writes one
canonical response. It accepts no arguments, environment configuration,
working-directory configuration, shell, child process, network, filesystem,
RTC, systemd, D-Bus, or real power operation. Its production backend rejects
all five valid operations with `operation_unsupported`. Invalid input exits
with fixed code `64` and internal startup failures with fixed code `70`, with
empty stdout/stderr for those failures.

## Consequences

The Node.js runtime and npm dependency tree remain outside the privileged
boundary. The helper has a small standard-library-only codebase, a strict
cross-language protocol corpus, deterministic deny-all behavior, and no
installation or production wiring. A setuid executable remains high-risk
security-sensitive code: any future backend change requires review of parser,
startup, privilege, resource, filesystem, and recovery behavior.

The helper cannot perform useful power work after this ADR. Real RTC, wake,
and shutdown effects remain deferred, and the application continues using its
mock/simulated composition.

## Review conditions

Before installing or enabling the helper, separately review the package and
ownership procedure, supported Linux distributions, deployment group
membership, rollback and recovery, operator-visible failures, and the first
read-only Linux backend. Each real effect requires its own fixed-resource
backend review. No generic file reader, command launcher, debug mode, shell,
or arbitrary device path may be introduced.
