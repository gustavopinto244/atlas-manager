# Atlas Manager capability matrix

This matrix records the source state at the current milestone commit. “Partial” means some backend or
presentation support exists but the end-to-end operator capability is not
complete. Update this file in every capability commit.

| Capability                    | CLI     | Dashboard | API                | Domain/backend                    | Authorization                     | Confirmation                 | Audit            | Scheduler            | Status                             |
| ----------------------------- | ------- | --------- | ------------------ | --------------------------------- | --------------------------------- | ---------------------------- | ---------------- | -------------------- | ---------------------------------- |
| Health                        | No      | Partial   | Yes                | Yes                               | health public; overview protected | No                           | No               | No                   | Partial                            |
| Administrative overview       | No      | Partial   | Yes                | Yes                               | `operations.read`                 | No                           | authorization    | reports state        | Partial; current auth divergence   |
| Service list/status           | No      | Partial   | Yes                | Yes                               | `services.read`                   | No                           | authorization    | effective policy     | Partial; current auth divergence   |
| Service start/stop/restart    | No      | Partial   | Yes                | Yes                               | operation-specific                | exact string                 | started/terminal | reconciliation-aware | Partial                            |
| Service logs                  | No      | No        | No                 | Yes                               | not defined                       | No                           | not defined      | No                   | Backend only                       |
| Availability overrides        | No      | Partial   | Yes                | Yes                               | read/write                        | update/remove exact          | Yes              | consumed             | Partial                            |
| Base service scheduling       | No      | No        | No                 | Domain/config only                | not defined                       | not defined                  | not defined      | Yes                  | Backend/config only                |
| Schedule preview              | No      | No        | No                 | Domain only                       | not defined                       | No                           | No               | evaluator            | Domain only                        |
| PM2/Docker/Compose control    | No      | Partial   | Shared service API | Yes                               | shared service RBAC               | shared                       | shared           | shared policy        | Partial                            |
| Backup targets/runs           | No      | Partial   | Yes                | Yes                               | backup read                       | No                           | authorization    | Yes                  | Partial; current auth divergence   |
| Backup run/schedule/retention | No      | Partial   | Yes                | Yes                               | granular                          | exact mutation confirmations | Yes              | Yes                  | Partial                            |
| Event history                 | No      | Partial   | Yes                | Yes                               | granular                          | mutation-dependent           | Yes              | retention only       | Partial                            |
| Security posture              | No      | No        | Yes                | Yes                               | `security.posture.read`           | No                           | authorization    | No                   | API only                           |
| Machine plan                  | No      | No        | No                 | Yes                               | not exposed                       | No                           | internal         | Yes                  | Domain only                        |
| Wake/shutdown                 | No      | No        | Feature-flagged    | Yes                               | power RBAC                        | exact/gated                  | Yes              | Yes                  | Implemented, deployed disabled     |
| Infrastructure diagnostics    | No      | No        | No                 | deployment tools only             | OS-level                          | No                           | evidence only    | No                   | Tooling only                       |
| Operator CLI                  | Partial | n/a       | n/a                | TypeScript parser/output contract | read-only transport pending       | n/a                          | n/a              | n/a                  | CLI-1 foundation; commands pending |

Detailed planning and source mappings are in
`docs/milestones/operator-experience-inventory.md`.
