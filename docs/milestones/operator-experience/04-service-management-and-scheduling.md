# Service management and scheduling plan

## Existing model

Registered services already abstract mock, PM2, Docker and Docker Compose
through dispatching status, control, readiness and log ports. Dependency-aware
orchestration and readiness checks are application concerns, not UI concerns.

Availability modes already exist:

- `always`
- `scheduled`
- `manual`
- `disabled`

Weekly schedule, weekday, local time, timezone, evaluator and next-transition
calculator are strict domain types with extensive tests.

## Important distinction

The current `/admin/services/:serviceId/availability` resource manages runtime
availability overrides. It does not persistently edit the base policy loaded
from `REGISTERED_SERVICES_JSON`.

The milestone must not relabel overrides as schedules. Add a separate schedule
capability with clear ownership.

## Required application additions

1. `RegisteredServiceAvailabilityPolicyStore` port.
2. File-backed and in-memory implementations with atomic writes and recovery
   behavior.
3. `GetRegisteredServiceSchedule`.
4. `SetRegisteredServiceSchedule`.
5. `RemoveRegisteredServiceSchedule` with defined fallback semantics.
6. `PreviewRegisteredServiceSchedule` using the existing evaluator and
   transition calculator.
7. An explicit catalog/policy overlay so registered identity and management
   configuration stay environment-owned while schedule edits persist safely.

Do not mutate the environment JSON file from the application.

## Proposed protected resources

- `GET /admin/services/:serviceId/schedule`
- `PUT /admin/services/:serviceId/schedule`
- `DELETE /admin/services/:serviceId/schedule`
- `POST /admin/services/:serviceId/schedule/previews`
- `GET /admin/services/:serviceId/logs`

Exact route IDs, permissions, confirmations, limits and response schemas must
be accepted in the API plan before implementation. Preview is read-only even
though POST carries a candidate policy.

## Preview contract

Return at least:

- current status and effective availability;
- configured mode and timezone;
- normalized weekly windows;
- current evaluation instant;
- next and following transitions;
- active override and expiry, if any;
- reconciliation scheduler status/cursor health;
- source (`environment`, `persisted_override`, `candidate_preview`).

## CLI mapping

- `atlas services list`
- `atlas services status <id>`
- `atlas services start|stop|restart <id>`
- `atlas services logs <id> [--follow]`
- `atlas services schedule show <id>`
- `atlas services schedule set <id> ...`
- `atlas services schedule always|manual|disable <id>`
- `atlas services schedule remove <id>`
- `atlas services schedule preview <id> ...`

CLI weekday syntax is converted to the canonical domain input; it is not a
second schedule language.

## Dashboard mapping

Services show type, status, readiness, uptime where available, effective mode,
next transition, dependencies and resources. All adapters share one visual and
schedule path. Technology-specific details are optional diagnostics, not
separate scheduling features.

`WeeklyScheduleEditor` produces candidate input for backend validation. The
timeline receives normalized windows and transitions from API DTOs.

## Audit and concurrency

- Start/stop/restart continue through the service mutation gate.
- Schedule update/removal receive dedicated administrative operations,
  permissions and event-history entries.
- Audit records normalized policy metadata, target and outcome; never secrets.
- A conflict cannot be presented as success; clients reread authoritative
  state after mutation.

## Regression gates

Preserve all existing policy, occurrence, cursor, claim, conflict, retry,
duplicate-prevention, override-pruning and Compose scheduling tests. Add store
recovery, API contract, CLI and dashboard tests without simplifying the domain.
