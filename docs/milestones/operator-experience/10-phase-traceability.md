# Milestone phase traceability

This table maps every phase of the original milestone prompt to the planning
document that owns it. It is a coverage index, not evidence of implementation.

| Prompt phase | Subject                             | Planning owner                                              |
| ------------ | ----------------------------------- | ----------------------------------------------------------- |
| 0            | Architectural inventory             | `operator-experience-inventory.md`, current-state context   |
| 1            | ADR and experience contract         | ADR-027, security/API plan                                  |
| 2–4          | CLI executable, command tree and UX | CLI plan                                                    |
| 5–6          | Status and doctor                   | CLI plan, infrastructure diagnostics plan                   |
| 7            | Service-management CLI              | CLI plan, service-management plan                           |
| 8–9          | Schedule CLI and preview            | service-management plan, CLI plan                           |
| 10           | Dashboard shell                     | dashboard plan, ADR-027                                     |
| 11           | Overview                            | dashboard plan, infrastructure diagnostics plan             |
| 12           | Services page                       | dashboard plan, service-management plan                     |
| 13–14        | Weekly editor and schedule timeline | dashboard plan, service-management plan                     |
| 15           | PM2/Docker/Compose scheduling       | service-management plan                                     |
| 16–17        | Machine schedule model and preview  | machine plan and power-safety plan                          |
| 18           | Destructive-action UX               | dashboard plan, security/API plan                           |
| 19           | Capability matrix                   | `docs/capabilities.md`                                      |
| 20           | README                              | testing/documentation/release plan                          |
| 21           | Runbook v3                          | testing/documentation/release plan                          |
| 22           | CLI reference                       | CLI plan, testing/documentation/release plan                |
| 23           | Scheduling documentation            | service-management plan, testing/documentation/release plan |
| 24           | Dashboard documentation             | dashboard plan, testing/documentation/release plan          |
| 25           | Event-history coverage              | backups and event-history plan                              |
| 26           | Authorization UX and CLI boundary   | security/API plan, ADR-027, required follow-up ADR          |
| 27           | Dashboard API                       | security/API plan and per-feature plans                     |
| 28           | Accessibility                       | dashboard plan                                              |
| 29           | CLI tests                           | CLI plan                                                    |
| 30           | Dashboard tests                     | dashboard plan                                              |
| 31           | Scheduler regression                | service-management plan                                     |
| 32           | Power regression                    | machine plan and power-safety plan                          |
| 33           | Security regression                 | security/API plan                                           |
| 34–35        | Commits and documentation per slice | execution roadmap                                           |
| 36           | Full qualification                  | testing/documentation/release plan                          |
| 37           | Candidate A/B reproducibility       | testing/documentation/release plan                          |
| 38           | Host rehearsal                      | testing/documentation/release plan                          |
| 39           | Dashboard deployment validation     | dashboard plan, testing/documentation/release plan          |
| 40           | Operator acceptance                 | execution roadmap, testing/documentation/release plan       |
| 41           | Definition of Done                  | testing/documentation/release plan and final evidence       |

## Unresolved decisions that block implementation slices

| Decision                                                                           | Blocks                                 | Required artifact                                                         |
| ---------------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------- |
| Correct end-to-end Cloudflare assertion flow and remove current read bypass        | all dashboard/API work                 | security repair tests and deployment rehearsal                            |
| Local/remote CLI identity model                                                    | mutating CLI commands                  | ADR-028; authenticated transport implementation and security tests remain |
| Service policy persistence and precedence                                          | schedule mutation/API/editor           | store contract and tests                                                  |
| Machine policy persistence and precedence                                          | machine schedule mutation              | dedicated ADR                                                             |
| Runtime diagnostic implementation boundary (Node adapters versus shared Go report) | status/doctor/dashboard infrastructure | boundary decision in the diagnostic slice                                 |
| Final route additions and explicit route count                                     | API contract/release gates             | route proposal and updated contract snapshot                              |
