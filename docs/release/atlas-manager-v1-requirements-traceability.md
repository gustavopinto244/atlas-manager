# Atlas Manager v1 requirements traceability

Release candidate: `1.0.0-rc.2`
Baseline: the current source commit recorded by the release generators.
Scope: software-only qualification; physical gates are intentionally separate.

The table is generated from the normative identifiers in `docs/requirements.md`.
`implemented` means the software path exists and is covered by the relevant
tests; it does not claim that the full release gate has passed locally when a
required external tool is unavailable.

| ID      | Requirement                               | Status                     | Remaining gate                                      |
| ------- | ----------------------------------------- | -------------------------- | --------------------------------------------------- |
| FR-001  | General server status                     | implemented                | software qualification evidence and CI release gate |
| FR-002  | System resource information               | implemented                | software qualification evidence and CI release gate |
| FR-003  | Service health                            | implemented                | software qualification evidence and CI release gate |
| FR-004  | External dependency checks                | deferred_by_accepted_scope | future reviewed scope                               |
| FR-005  | Registered service catalog                | implemented                | software qualification evidence and CI release gate |
| FR-006  | Service status                            | implemented                | software qualification evidence and CI release gate |
| FR-007  | Manual service control                    | implemented                | software qualification evidence and CI release gate |
| FR-008  | Service drivers                           | implemented                | software qualification evidence and CI release gate |
| FR-009  | Restricted service targets                | implemented                | software qualification evidence and CI release gate |
| FR-010  | Availability modes                        | implemented                | software qualification evidence and CI release gate |
| FR-011  | Weekly schedules                          | implemented                | software qualification evidence and CI release gate |
| FR-012  | Timezone support                          | implemented                | software qualification evidence and CI release gate |
| FR-013  | Temporary overrides                       | implemented                | software qualification evidence and CI release gate |
| FR-014  | Duplicate execution prevention            | implemented                | software qualification evidence and CI release gate |
| FR-015  | Scheduled unavailability response         | deferred_by_accepted_scope | future reviewed scope                               |
| FR-016  | Docker resource status                    | implemented                | software qualification evidence and CI release gate |
| FR-017  | Docker resource control                   | implemented                | software qualification evidence and CI release gate |
| FR-018  | Docker schedules                          | implemented                | software qualification evidence and CI release gate |
| FR-019  | Docker health information                 | implemented                | software qualification evidence and CI release gate |
| FR-020  | Limited Docker logs                       | implemented                | software qualification evidence and CI release gate |
| FR-021  | Service dependencies                      | implemented                | software qualification evidence and CI release gate |
| FR-022  | RTC information                           | physical_gate              | separately approved physical Atlas qualification    |
| FR-023  | Mock power operations                     | implemented                | software qualification evidence and CI release gate |
| FR-024  | Wake-alarm scheduling                     | physical_gate              | separately approved physical Atlas qualification    |
| FR-025  | Safe shutdown routine                     | physical_gate              | separately approved physical Atlas qualification    |
| FR-026  | Machine operating schedule                | physical_gate              | separately approved physical Atlas qualification    |
| FR-027  | Independent service and machine schedules | physical_gate              | separately approved physical Atlas qualification    |
| FR-028  | Registered backup sources                 | implemented                | software qualification evidence and CI release gate |
| FR-029  | Manual backup execution                   | implemented                | software qualification evidence and CI release gate |
| FR-030  | Scheduled backups                         | implemented                | software qualification evidence and CI release gate |
| FR-031  | Backup metadata                           | implemented                | software qualification evidence and CI release gate |
| FR-032  | Backup retention                          | implemented                | software qualification evidence and CI release gate |
| FR-033  | Operational event history                 | implemented                | software qualification evidence and CI release gate |
| FR-034  | Task execution history                    | implemented                | software qualification evidence and CI release gate |
| FR-035  | Administrative API                        | implemented                | software qualification evidence and CI release gate |
| FR-036  | Web dashboard                             | implemented                | software qualification evidence and CI release gate |
| FR-037  | Command-line interface                    | deferred_by_accepted_scope | future reviewed scope                               |
| FR-038  | Health endpoint                           | implemented                | software qualification evidence and CI release gate |
| NFR-001 | Supported environment                     | implemented                | software qualification evidence and CI release gate |
| NFR-002 | Type safety                               | implemented                | software qualification evidence and CI release gate |
| NFR-003 | Modular organization                      | implemented                | software qualification evidence and CI release gate |
| NFR-004 | Testability                               | implemented                | software qualification evidence and CI release gate |
| NFR-005 | Simulated implementations                 | implemented                | software qualification evidence and CI release gate |
| NFR-006 | Reliability                               | implemented                | software qualification evidence and CI release gate |
| NFR-007 | Idempotency                               | implemented                | software qualification evidence and CI release gate |
| NFR-008 | Observability                             | implemented                | software qualification evidence and CI release gate |
| NFR-009 | Documentation                             | implemented                | software qualification evidence and CI release gate |
| NFR-010 | Validation pipeline                       | implemented                | software qualification evidence and CI release gate |
| NFR-011 | Deployment rollback                       | implemented                | software qualification evidence and CI release gate |
| NFR-012 | Local binding                             | implemented                | software qualification evidence and CI release gate |
| NFR-013 | Incremental delivery                      | implemented                | software qualification evidence and CI release gate |
| NFR-014 | Controlled degradation                    | implemented                | software qualification evidence and CI release gate |
| SEC-001 | Unprivileged application process          | implemented                | software qualification evidence and CI release gate |
| SEC-002 | Least privilege                           | implemented                | software qualification evidence and CI release gate |
| SEC-003 | No arbitrary commands                     | implemented                | software qualification evidence and CI release gate |
| SEC-004 | Allowlists                                | implemented                | software qualification evidence and CI release gate |
| SEC-005 | Input validation                          | implemented                | software qualification evidence and CI release gate |
| SEC-006 | Secret management                         | implemented                | software qualification evidence and CI release gate |
| SEC-007 | Docker access restriction                 | implemented                | software qualification evidence and CI release gate |
| SEC-008 | Database credentials                      | implemented                | software qualification evidence and CI release gate |
| SEC-009 | Administrative authentication             | implemented                | software qualification evidence and CI release gate |
| SEC-010 | Audit trail                               | implemented                | software qualification evidence and CI release gate |
| SEC-011 | Destructive operation confirmation        | implemented                | software qualification evidence and CI release gate |
| SEC-012 | Public ingress protection                 | implemented                | software qualification evidence and CI release gate |

Additional accepted scope boundaries:

| Scope                                            | Status                     | Evidence                                                      |
| ------------------------------------------------ | -------------------------- | ------------------------------------------------------------- |
| General administrative CLI                       | deferred_by_accepted_scope | ADR-025; narrow deployment and maintenance entrypoints remain |
| Backup restoration                               | deferred_by_accepted_scope | ADR-023; no restore route or capability                       |
| Remote backup replication                        | deferred_by_accepted_scope | ADR-023; local artifacts only                                 |
| External audit attestation                       | deferred_by_accepted_scope | ADR-024/025; hash chains provide integrity evidence only      |
| Physical Atlas deployment and real power effects | physical_gate              | release notes and operational runbooks                        |
