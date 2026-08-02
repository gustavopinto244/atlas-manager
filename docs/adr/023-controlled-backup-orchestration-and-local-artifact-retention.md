# ADR-023 — Orchestrate approved backups through registered targets, atomic local artifacts, and persistent execution evidence

Status: Accepted

## Decision

Atlas Manager owns a bounded backup domain. Operators register immutable backup
targets, and manual or scheduled requests resolve only those targets. The first
delivery supports `mock` and `filesystem_tree` adapters. Filesystem backups use
standard-library traversal, reject links and special files, create a private
candidate artifact, write a canonical manifest with SHA-256 values, synchronize
it, and publish it with an atomic rename.

Run history is an append-only project-owned JSONL store. Started runs that do
not have a terminal record reconstruct as `interrupted`. Scheduled occurrences
are claimed by the immutable `(targetId, scheduledFor)` tuple and a persistent
cursor uses compare-and-set advancement. Retention considers only verified
managed successful artifacts and fails closed on unknown or modified artifacts.

Shutdown readiness consumes only the bounded states `ready`, `active`,
`interrupted`, and `unavailable`; it never starts, cancels, or prunes a backup.

Protected APIs and the dashboard expose target and run metadata, not backup
contents or paths. Every mutation uses the existing Cloudflare authentication,
fixed role authorization, and persistent administrative audit boundaries.

## Boundaries

Backup target registration, backup scheduling, backup execution, artifact
publication, metadata, retention, administrative auditing, and shutdown
readiness are separate responsibilities. Restoration, remote replication, and
logical database backup are separate future capabilities.

## Explicitly rejected

- caller-supplied source or destination paths;
- shell commands, archive tools, hooks, and caller-supplied commands;
- following symbolic links or copying special files;
- arbitrary extraction or automatic restoration;
- automatic deletion or adoption of unknown artifacts;
- backup contents in HTTP responses or dashboard views;
- treating backup success as proof of restore capability;
- using event history as the backup-run database;
- using backup-run metadata as a replacement for the audit trail;
- remote storage, cloud credentials, database dump tools, and physical execution.

Automated validation uses temporary sandbox roots, deterministic mock adapters,
and controlled filesystem fixtures. No real source tree, host, VM, helper,
RTC, D-Bus, or machine-power effect is used.
