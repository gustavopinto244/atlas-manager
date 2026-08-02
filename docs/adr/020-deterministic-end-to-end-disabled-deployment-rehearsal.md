# ADR-020 — Validate the complete disabled deployment lifecycle through a deterministic sandbox rehearsal

Status: Accepted

## Context

Atlas Manager has separate boundaries for bundle construction, host
qualification, runtime identity preparation, disabled installation, release
switching, verification, rollback, and uninstall. Focused tests validate those
boundaries individually, but a deployment decision also depends on their
composition.

The physical Atlas host, a virtual machine, real account databases, systemd,
the power helper, RTC, and D-Bus are out of scope for development validation.
The project therefore needs one deterministic shared-state rehearsal that
exercises the disabled lifecycle without touching production resources.

## Decision

Add a Go integration rehearsal in the standard-library-only `deployment`
module. It uses the existing production packages with injected synthetic
platform, filesystem, account-command, Node.js, systemd, and capacity
observations. It builds two valid releases through the real bundle builder,
then runs qualification, identity preparation, disabled installation, upgrade,
rollback, uninstall, and all corresponding verification actions.

The rehearsal records canonical step classifications, SHA-256 report digests,
a deterministic evidence chain, filesystem snapshots, and per-step mutation
allowlists. Temporary paths and private account data never enter the evidence.

Failure scenarios cover rollback, interrupted identity preparation, staging
failures, modified releases, service contamination, runtime activity, unknown
artifacts, lock conflicts, and sandbox escape attempts. The rehearsal itself
is test infrastructure, not a production operator command.

## Boundaries

The rehearsal is distinct from focused unit tests, package integration tests,
bundle reproducibility checks, and packaged application smoke tests. It proves
disabled deployment lifecycle composition only. It does not perform physical
host qualification, physical identity preparation, physical installation,
service enablement or startup, production configuration, helper installation,
Linux power activation, or real-effect certification.

The synthetic account executor verifies the exact fixed production command
arguments and never invokes `groupadd`, `groupdel`, `useradd`, or `userdel`.
Systemd remains represented by injected markers; no systemd command executes.
The application and helper are never executed.

## Consequences

The deployment lifecycle now has a repeatable cross-boundary regression test
and bounded evidence suitable for CI artifacts. Production packages remain
the owners of their contracts, so the rehearsal cannot silently become a
second implementation. The test is intentionally more involved than a unit
test because it verifies filesystem mutation scope, lock separation, release
retention, identity survival after uninstall, and deterministic output.
