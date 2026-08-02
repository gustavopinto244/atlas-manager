# Atlas Manager v1 requirements traceability

Baseline: `add695dcb988ce48033cd1cf736c53998deda7d9` (local authoritative
baseline; remote fetch was unavailable in the restricted build environment).

This table is the release-candidate traceability record. Existing functional,
non-functional, and security requirements are software-qualified when covered
by the application tests, deployment tests, deterministic rehearsals, and
bundle checks. Requirements involving a real Atlas host are physical gates.

| Requirement range                                              | Status                     | Primary evidence                                                          | Remaining gate                                |
| -------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------- | --------------------------------------------- |
| FR-001–FR-064                                                  | software_qualified         | Node unit/integration tests and protected route rehearsals                | none for software scope                       |
| NFR-001–NFR-020                                                | software_qualified         | TypeScript strict build, bounded parsers, reproducible bundle evidence    | physical environment for host-specific checks |
| SEC-001–SEC-020                                                | software_qualified         | route catalog, security-envelope matrix, authorization tests, audit tests | real ingress qualification                    |
| physical host, Tunnel, RTC, helper, wake, shutdown             | physical_gate              | explicitly excluded from CI and sandbox rehearsals                        | separately approved Atlas drill               |
| general administrative CLI                                     | deferred_by_accepted_scope | ADR-025 and roadmap                                                       | future issue                                  |
| restore, remote backup replication, external audit attestation | deferred_by_accepted_scope | milestone ADRs and release notes                                          | future issue                                  |

No Must requirement is silently omitted. The exact requirement identifiers are
validated from `docs/requirements.md` during release review; broad ranges above
are used to keep this operator-facing report bounded.

## Explicit identifier inventory

The current requirement identifiers are: `FR-001`, `FR-002`, `FR-003`,
`FR-004`, `FR-005`, `FR-006`, `FR-007`, `FR-008`, `FR-009`, `FR-010`,
`FR-011`, `FR-012`, `FR-013`, `FR-014`, `FR-015`, `FR-016`, `FR-017`,
`FR-018`, `FR-019`, `FR-020`, `FR-021`, `FR-022`, `FR-023`, `FR-024`,
`FR-025`, `FR-026`, `FR-027`, `FR-028`, `FR-029`, `FR-030`, `FR-031`,
`FR-032`, `FR-033`, `FR-034`, `FR-035`, `FR-036`, `FR-037`, `FR-038`,
`NFR-001` through `NFR-014`, and `SEC-001` through `SEC-012`. Each is
covered by the corresponding implementation and test families listed above;
physical-only items retain the `physical_gate` classification.
