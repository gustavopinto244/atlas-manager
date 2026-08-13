# Historical security review snapshot — Atlas Manager 1.0.0-rc.8

> **HISTORICAL SNAPSHOT.** This document reviews `1.0.0-rc.8` and preserves
> the conclusions available at that candidate. It is not the current v1/GA
> security review. Findings were subsequently reconciled through later
> candidates and GA. See the
> [final operational acceptance evidence](atlas-manager-1.0.0-final-operational-acceptance-evidence.md)
> and the
> [final 1.0.0 reconciliation and power-hardening review](../reviews/final-1.0.0-reconciliation-and-power-hardening.md).

Release candidate: `1.0.0-rc.8`.

| Area                                            | Result                                       | Evidence boundary                                                           |
| ----------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------- |
| Arbitrary commands and infrastructure adapters  | closed                                       | fixed adapters, bounded arguments, no caller command                        |
| Administrative route catalog                    | closed in application tests                  | registration helper and startup reconciliation                              |
| Cloudflare assertion authentication             | closed in deterministic tests                | real external ingress remains a physical gate                               |
| Fixed authorization and audit-before-effect     | closed in application tests                  | role claims do not assign roles                                             |
| Host, origin, Fetch Metadata, forwarded headers | closed in HTTP tests                         | loopback listener and `trust proxy=false` remain required                   |
| Backup and event-history persistence            | closed in Node tests                         | managed metadata and corruption fail closed                                 |
| Configuration replacement and rollback          | implemented; lifecycle qualification pending | Go unit/rehearsal support passes; end-to-end matrix remains mandatory       |
| Dashboard rendering and browser storage         | implemented; bundle equivalence pending      | no assertion or confirmation storage; source/runtime reconciliation remains |
| Dependency/license inventory                    | generated from production lock tree          | audit result is recorded by release evidence                                |
| Linux helper and real power effects             | physical_gate                                | helper is not installed or executed by the candidate                        |
| External authenticity, SIEM, remote archival    | accepted_with_documented_limit               | SHA-256 chains provide integrity evidence only                              |

No unresolved critical or high-severity software finding is accepted in the
source changes. The candidate is not marked qualified until the mandatory Go,
bundle, and full rehearsal gates execute successfully.

The CI workflow uses exact reviewed action release tags rather than immutable
commit SHAs. This is an accepted supply-chain limitation for this candidate;
SHA pinning is a follow-up maintenance task and does not weaken the
application’s runtime authorization or filesystem boundaries.

That limitation describes this historical snapshot. The post-GA reconciliation
pins the same reviewed action versions to their resolved immutable commit SHAs.
