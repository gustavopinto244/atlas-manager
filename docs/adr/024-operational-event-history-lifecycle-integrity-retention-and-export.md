# ADR-024 — Operate administrative history through segmented append-only persistence, deterministic integrity chains, retention anchors, and canonical exports

Status: Accepted

## Decision

Administrative history uses a fixed, private v2 store under
`/var/lib/atlas-manager-event-history`. Records embed the existing immutable
administrative event model and add a canonical SHA-256 record chain. The active
JSON Lines segment is bounded and is sealed into an immutable segment with a
canonical manifest before a new active segment is published.

One atomic filesystem lock serializes writers and maintenance across processes.
Rotation, retention, export, and migration use transaction evidence. Unknown
files, unsafe metadata, interrupted transactions, broken chains, and stale
locks fail closed; stale locks are only removed by the explicit maintenance
action and confirmation.

Retention removes only complete verified sealed segments and writes a chained
retention anchor before deletion. Exports use an explicit retained sequence
range, canonical JSON Lines, content-derived identifiers, private manifests,
and protected same-origin download. The application never exposes arbitrary
paths, event contents outside the approved mapping, or backup artifacts.

## Boundaries

An administrative event is the domain fact. A v2 event-history record is its
durable chained representation. An active segment is writable; a sealed segment
and its manifest are immutable. The retention anchor records an intentional
sequence boundary. A canonical export is a bounded operator-created view, not
the audit store and not an application log.

This lifecycle is separate from application logs, backup-run metadata, and
external attestation. SHA-256 chaining provides deterministic integrity
evidence for the retained store. It does not provide external authenticity,
non-repudiation, protection against an attacker able to rewrite the complete
store and every anchor, trusted timestamping, third-party attestation, remote
archival, or legal evidentiary certification.

## Rejected alternatives

The implementation rejects unrestricted log access, arbitrary export or
persistence paths, arbitrary retention predicates, automatic corruption
repair, deletion of unknown files, silent truncation, automatic stale-lock
removal, multiple incompatible writers, event-history use as the backup-run
database, application-log use as audit history, and secrets or raw JWTs in
events and exports. Restore, remote shipping, SIEM integration, signing
services, trusted timestamps, physical deployment, and real power effects
remain separate work.
