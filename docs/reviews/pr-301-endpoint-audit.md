# PR #301 — endpoint audit

## Common enforced contract

All 45 administrative descriptors
below are registered through `registerAdministrativeRoute`, reconciled against
the runtime, protected by Host/origin validation, Cloudflare Access,
administrative-principal RBAC, security headers and shared admission. Each
section records the executable descriptor separately; handlers remain
authoritative where they add stricter domain validation. In the reviewed
profile, power remains mock-only and no lifecycle probe carries an assertion.

## Public health endpoints

### GET /health/live

Route ID: none. Activation: always. Authentication/authorization: none. Request:
bodyless GET. Response: exact JSON `{"status":"ok"}`. Side effects, audit and
power effects: none. Adversarial cases: redirect, non-200, non-JSON, oversized or
malformed payload, timeout and connection failure. Verdict: **PASS**.

### GET /health/server

Route ID: none. Activation: always. Authentication/authorization: none. Request:
bodyless GET. Response: bounded server-health JSON with all required fields.
Side effects, audit and power effects: none. Adversarial cases: redirect,
non-200, missing fields, malformed/oversized body, timeout and connection
failure. Verdict: **PASS**.

## Administrative endpoints

### GET /

Route ID: `dashboard.read`

Activation: `ADMINISTRATIVE_DASHBOARD_ENABLED`

Authentication: required Cloudflare Access assertion and administrative principal.

Authorization: operation `read_administrative_dashboard`; permission `dashboard.read`; backend RBAC authoritative.

Request schema: no body; target <= 4096 bytes.

Response schema: bounded `html` response.

Confirmation: `none`.

Gate: shared admission plus `none`.

Audit: `authorization_only`.

Replay: `read_only`.

Side effects: read-only application query and authorization audit only.

Power effect possibility: none in this endpoint.

Tests: authenticated dashboard integration, catalog and asset-generation suites.

PR #301 impact: direct.

Adversarial cases: unexpected body, query/target overflow, wrong method, Host/origin/assertion/principal failures and backend failure.

Verdict: **PASS**.

### GET /assets/:asset

Route ID: `dashboard.asset.read`

Activation: `ADMINISTRATIVE_DASHBOARD_ENABLED`

Authentication: required Cloudflare Access assertion and administrative principal.

Authorization: operation `read_administrative_dashboard`; permission `dashboard.read`; backend RBAC authoritative.

Request schema: no body; target <= 4096 bytes.

Response schema: bounded `asset` response.

Confirmation: `none`.

Gate: shared admission plus `none`.

Audit: `authorization_only`.

Replay: `read_only`.

Side effects: read-only application query and authorization audit only.

Power effect possibility: none in this endpoint.

Tests: authenticated dashboard integration, catalog and asset-generation suites.

PR #301 impact: direct.

Adversarial cases: unexpected body, query/target overflow, wrong method, Host/origin/assertion/principal failures and backend failure.

Verdict: **PASS**.

### GET /admin/event-history

Route ID: `event_history.read`

Activation: `ADMINISTRATIVE_EVENT_HISTORY_HTTP_ENABLED`

Authentication: required Cloudflare Access assertion and administrative principal.

Authorization: operation `read_administrative_event_history`; permission `event_history.read`; backend RBAC authoritative.

Request schema: no body; target <= 4096 bytes.

Response schema: bounded `json` response.

Confirmation: `none`.

Gate: shared admission plus `none`.

Audit: `authorization_only`.

Replay: `read_only`.

Side effects: read-only application query and authorization audit only.

Power effect possibility: none in this endpoint.

Tests: event-history route/integration/lifecycle suites and catalog reconciliation.

PR #301 impact: transitive security-envelope preservation.

Adversarial cases: unexpected body, query/target overflow, wrong method, Host/origin/assertion/principal failures and backend failure.

Verdict: **PASS**.

### GET /admin/power/wake-alarm

Route ID: `power.wake.read`

Activation: `ADMINISTRATIVE_WAKE_ALARM_HTTP_ENABLED`

Authentication: required Cloudflare Access assertion and administrative principal.

Authorization: operation `read_wake_alarm`; permission `power.wake.read`; backend RBAC authoritative.

Request schema: no body; target <= 4096 bytes.

Response schema: bounded `json` response.

Confirmation: `none`.

Gate: shared admission plus `none`.

Audit: `authorization_only`.

Replay: `read_only`.

Side effects: read-only application query and authorization audit only.

Power effect possibility: mock adapter only in this profile; backend=mock, effects=disabled and machine scheduler=false remain mandatory.

Tests: wake-alarm route/integration, catalog, audit and runtime-verification suites.

PR #301 impact: direct.

Adversarial cases: unexpected body, query/target overflow, wrong method, Host/origin/assertion/principal failures and backend failure.

Verdict: **FIXED**.

### PUT /admin/power/wake-alarm

Route ID: `power.wake.update`

Activation: `ADMINISTRATIVE_WAKE_ALARM_HTTP_ENABLED`

Authentication: required Cloudflare Access assertion and administrative principal.

Authorization: operation `schedule_wake_alarm`; permission `power.wake.schedule`; backend RBAC authoritative.

Request schema: strict JSON <= 512 bytes; application/json or application/json; charset=utf-8; encoding identity; duplicate and unknown keys rejected.

Response schema: bounded `json` response.

Confirmation: `none`.

Gate: shared admission plus `power_operation`.

Audit: `authorization_started_terminal`.

Replay: `state_recheck_required`.

Side effects: the protected application use case may mutate its named domain after validation, admission, authentication and authorization.

Power effect possibility: mock adapter only in this profile; backend=mock, effects=disabled and machine scheduler=false remain mandatory.

Tests: wake-alarm route/integration, catalog, audit and runtime-verification suites.

PR #301 impact: direct.

Adversarial cases: missing/wrong content type, encoding, oversized/duplicate/unknown/malformed body, confirmation mismatch, contention, replay, Host/origin/assertion/principal failures and backend failure.

Verdict: **FIXED**.

### DELETE /admin/power/wake-alarm

Route ID: `power.wake.delete`

Activation: `ADMINISTRATIVE_WAKE_ALARM_HTTP_ENABLED`

Authentication: required Cloudflare Access assertion and administrative principal.

Authorization: operation `cancel_wake_alarm`; permission `power.wake.cancel`; backend RBAC authoritative.

Request schema: no body; target <= 4096 bytes.

Response schema: bounded `json` response.

Confirmation: `none`.

Gate: shared admission plus `power_operation`.

Audit: `authorization_started_terminal`.

Replay: `state_recheck_required`.

Side effects: the protected application use case may mutate its named domain after validation, admission, authentication and authorization.

Power effect possibility: mock adapter only in this profile; backend=mock, effects=disabled and machine scheduler=false remain mandatory.

Tests: wake-alarm route/integration, catalog, audit and runtime-verification suites.

PR #301 impact: direct.

Adversarial cases: unexpected body, query/target overflow, wrong method, Host/origin/assertion/principal failures and backend failure.

Verdict: **FIXED**.

### POST /admin/power/shutdown/preparations

Route ID: `power.shutdown.prepare`

Activation: `ADMINISTRATIVE_SHUTDOWN_HTTP_ENABLED`

Authentication: required Cloudflare Access assertion and administrative principal.

Authorization: operation `prepare_machine_shutdown_occurrence`; permission `power.shutdown.prepare`; backend RBAC authoritative.

Request schema: strict JSON <= 1024 bytes; application/json or application/json; charset=utf-8; encoding identity; duplicate and unknown keys rejected.

Response schema: bounded `json` response.

Confirmation: `exact:confirm_shutdown_preparation`.

Gate: shared admission plus `power_operation`.

Audit: `authorization_started_terminal`.

Replay: `state_recheck_required`.

Side effects: the protected application use case may mutate its named domain after validation, admission, authentication and authorization.

Power effect possibility: mock adapter only in this profile; backend=mock, effects=disabled and machine scheduler=false remain mandatory.

Tests: shutdown route/integration, catalog, claims, audit and runtime-verification suites.

PR #301 impact: direct.

Adversarial cases: missing/wrong content type, encoding, oversized/duplicate/unknown/malformed body, confirmation mismatch, contention, replay, Host/origin/assertion/principal failures and backend failure.

Verdict: **FIXED**.

### POST /admin/power/shutdown/executions

Route ID: `power.shutdown.execute`

Activation: `ADMINISTRATIVE_SHUTDOWN_HTTP_ENABLED`

Authentication: required Cloudflare Access assertion and administrative principal.

Authorization: operation `execute_machine_shutdown_occurrence`; permission `power.shutdown.execute`; backend RBAC authoritative.

Request schema: strict JSON <= 1024 bytes; application/json or application/json; charset=utf-8; encoding identity; duplicate and unknown keys rejected.

Response schema: bounded `json` response.

Confirmation: `exact:confirm_shutdown_execution`.

Gate: shared admission plus `power_operation`.

Audit: `authorization_started_terminal`.

Replay: `state_recheck_required`.

Side effects: the protected application use case may mutate its named domain after validation, admission, authentication and authorization.

Power effect possibility: mock adapter only in this profile; backend=mock, effects=disabled and machine scheduler=false remain mandatory.

Tests: shutdown route/integration, catalog, claims, audit and runtime-verification suites.

PR #301 impact: direct.

Adversarial cases: missing/wrong content type, encoding, oversized/duplicate/unknown/malformed body, confirmation mismatch, contention, replay, Host/origin/assertion/principal failures and backend failure.

Verdict: **FIXED**.

### GET /admin/services

Route ID: `services.list`

Activation: `ADMINISTRATIVE_SERVICE_MANAGEMENT_HTTP_ENABLED`

Authentication: required Cloudflare Access assertion and administrative principal.

Authorization: operation `read_registered_services`; permission `services.read`; backend RBAC authoritative.

Request schema: no body; target <= 4096 bytes.

Response schema: bounded `json` response.

Confirmation: `none`.

Gate: shared admission plus `none`.

Audit: `authorization_only`.

Replay: `read_only`.

Side effects: read-only application query and authorization audit only.

Power effect possibility: none in this endpoint.

Tests: service-management HTTP/application/domain suites and catalog reconciliation.

PR #301 impact: transitive security-envelope preservation.

Adversarial cases: unexpected body, query/target overflow, wrong method, Host/origin/assertion/principal failures and backend failure.

Verdict: **PASS**.

### GET /admin/services/:serviceId

Route ID: `services.read`

Activation: `ADMINISTRATIVE_SERVICE_MANAGEMENT_HTTP_ENABLED`

Authentication: required Cloudflare Access assertion and administrative principal.

Authorization: operation `read_registered_service`; permission `services.read`; backend RBAC authoritative.

Request schema: no body; target <= 4096 bytes.

Response schema: bounded `json` response.

Confirmation: `none`.

Gate: shared admission plus `none`.

Audit: `authorization_only`.

Replay: `read_only`.

Side effects: read-only application query and authorization audit only.

Power effect possibility: none in this endpoint.

Tests: service-management HTTP/application/domain suites and catalog reconciliation.

PR #301 impact: transitive security-envelope preservation.

Adversarial cases: unexpected body, query/target overflow, wrong method, Host/origin/assertion/principal failures and backend failure.

Verdict: **PASS**.

### GET /admin/services/:serviceId/logs

Route ID: `services.logs.read`

Activation: `ADMINISTRATIVE_SERVICE_MANAGEMENT_HTTP_ENABLED`

Authentication: required Cloudflare Access assertion and administrative principal.

Authorization: operation `read_registered_service_logs`; permission `services.read`; backend RBAC authoritative.

Request schema: no body; target <= 4096 bytes.

Response schema: bounded `json` response.

Confirmation: `none`.

Gate: shared admission plus `none`.

Audit: `authorization_only`.

Replay: `read_only`.

Side effects: read-only application query and authorization audit only.

Power effect possibility: none in this endpoint.

Tests: service-management HTTP/application/domain suites and catalog reconciliation.

PR #301 impact: transitive security-envelope preservation.

Adversarial cases: unexpected body, query/target overflow, wrong method, Host/origin/assertion/principal failures and backend failure.

Verdict: **PASS**.

### POST /admin/services/:serviceId/actions/start

Route ID: `services.start`

Activation: `ADMINISTRATIVE_SERVICE_MANAGEMENT_HTTP_ENABLED`

Authentication: required Cloudflare Access assertion and administrative principal.

Authorization: operation `start_registered_service`; permission `services.start`; backend RBAC authoritative.

Request schema: strict JSON <= 8192 bytes; application/json or application/json; charset=utf-8; encoding identity; duplicate and unknown keys rejected.

Response schema: bounded `json` response.

Confirmation: `exact:confirm_registered_service_start`.

Gate: shared admission plus `service_mutation`.

Audit: `authorization_started_terminal`.

Replay: `state_recheck_required`.

Side effects: the protected application use case may mutate its named domain after validation, admission, authentication and authorization.

Power effect possibility: none in this endpoint.

Tests: service-management HTTP/application/domain suites and catalog reconciliation.

PR #301 impact: transitive security-envelope preservation.

Adversarial cases: missing/wrong content type, encoding, oversized/duplicate/unknown/malformed body, confirmation mismatch, contention, replay, Host/origin/assertion/principal failures and backend failure.

Verdict: **PASS**.

### POST /admin/services/:serviceId/actions/stop

Route ID: `services.stop`

Activation: `ADMINISTRATIVE_SERVICE_MANAGEMENT_HTTP_ENABLED`

Authentication: required Cloudflare Access assertion and administrative principal.

Authorization: operation `stop_registered_service`; permission `services.stop`; backend RBAC authoritative.

Request schema: strict JSON <= 8192 bytes; application/json or application/json; charset=utf-8; encoding identity; duplicate and unknown keys rejected.

Response schema: bounded `json` response.

Confirmation: `exact:confirm_registered_service_stop`.

Gate: shared admission plus `service_mutation`.

Audit: `authorization_started_terminal`.

Replay: `state_recheck_required`.

Side effects: the protected application use case may mutate its named domain after validation, admission, authentication and authorization.

Power effect possibility: none in this endpoint.

Tests: service-management HTTP/application/domain suites and catalog reconciliation.

PR #301 impact: transitive security-envelope preservation.

Adversarial cases: missing/wrong content type, encoding, oversized/duplicate/unknown/malformed body, confirmation mismatch, contention, replay, Host/origin/assertion/principal failures and backend failure.

Verdict: **PASS**.

### POST /admin/services/:serviceId/actions/restart

Route ID: `services.restart`

Activation: `ADMINISTRATIVE_SERVICE_MANAGEMENT_HTTP_ENABLED`

Authentication: required Cloudflare Access assertion and administrative principal.

Authorization: operation `restart_registered_service`; permission `services.restart`; backend RBAC authoritative.

Request schema: strict JSON <= 8192 bytes; application/json or application/json; charset=utf-8; encoding identity; duplicate and unknown keys rejected.

Response schema: bounded `json` response.

Confirmation: `exact:confirm_registered_service_restart`.

Gate: shared admission plus `service_mutation`.

Audit: `authorization_started_terminal`.

Replay: `state_recheck_required`.

Side effects: the protected application use case may mutate its named domain after validation, admission, authentication and authorization.

Power effect possibility: none in this endpoint.

Tests: service-management HTTP/application/domain suites and catalog reconciliation.

PR #301 impact: transitive security-envelope preservation.

Adversarial cases: missing/wrong content type, encoding, oversized/duplicate/unknown/malformed body, confirmation mismatch, contention, replay, Host/origin/assertion/principal failures and backend failure.

Verdict: **PASS**.

### GET /admin/services/:serviceId/availability

Route ID: `services.availability.read`

Activation: `ADMINISTRATIVE_SERVICE_AVAILABILITY_HTTP_ENABLED`

Authentication: required Cloudflare Access assertion and administrative principal.

Authorization: operation `read_registered_service_availability`; permission `services.availability.read`; backend RBAC authoritative.

Request schema: no body; target <= 4096 bytes.

Response schema: bounded `json` response.

Confirmation: `none`.

Gate: shared admission plus `none`.

Audit: `authorization_only`.

Replay: `read_only`.

Side effects: read-only application query and authorization audit only.

Power effect possibility: none in this endpoint.

Tests: service-management HTTP/application/domain suites and catalog reconciliation.

PR #301 impact: transitive security-envelope preservation.

Adversarial cases: unexpected body, query/target overflow, wrong method, Host/origin/assertion/principal failures and backend failure.

Verdict: **PASS**.

### GET /admin/services/:serviceId/schedule

Route ID: `services.schedule.read`

Activation: `ADMINISTRATIVE_SERVICE_SCHEDULE_HTTP_ENABLED`

Authentication: required Cloudflare Access assertion and administrative principal.

Authorization: operation `read_registered_service_schedule`; permission `services.availability.read`; backend RBAC authoritative.

Request schema: no body; target <= 4096 bytes.

Response schema: bounded `json` response.

Confirmation: `none`.

Gate: shared admission plus `none`.

Audit: `authorization_only`.

Replay: `read_only`.

Side effects: read-only application query and authorization audit only.

Power effect possibility: none in this endpoint.

Tests: service-management HTTP/application/domain suites and catalog reconciliation.

PR #301 impact: transitive security-envelope preservation.

Adversarial cases: unexpected body, query/target overflow, wrong method, Host/origin/assertion/principal failures and backend failure.

Verdict: **PASS**.

### GET /admin/services/:serviceId/availability/preview

Route ID: `services.availability.preview`

Activation: `ADMINISTRATIVE_SERVICE_AVAILABILITY_HTTP_ENABLED`

Authentication: required Cloudflare Access assertion and administrative principal.

Authorization: operation `read_registered_service_availability_preview`; permission `services.availability.read`; backend RBAC authoritative.

Request schema: no body; target <= 4096 bytes.

Response schema: bounded `json` response.

Confirmation: `none`.

Gate: shared admission plus `none`.

Audit: `authorization_only`.

Replay: `read_only`.

Side effects: read-only application query and authorization audit only.

Power effect possibility: none in this endpoint.

Tests: service-management HTTP/application/domain suites and catalog reconciliation.

PR #301 impact: transitive security-envelope preservation.

Adversarial cases: unexpected body, query/target overflow, wrong method, Host/origin/assertion/principal failures and backend failure.

Verdict: **PASS**.

### PUT /admin/services/:serviceId/availability

Route ID: `services.availability.update`

Activation: `ADMINISTRATIVE_SERVICE_AVAILABILITY_HTTP_ENABLED`

Authentication: required Cloudflare Access assertion and administrative principal.

Authorization: operation `update_registered_service_availability`; permission `services.availability.write`; backend RBAC authoritative.

Request schema: strict JSON <= 8192 bytes; application/json or application/json; charset=utf-8; encoding identity; duplicate and unknown keys rejected.

Response schema: bounded `json` response.

Confirmation: `exact:confirm_registered_service_availability_update`.

Gate: shared admission plus `service_mutation`.

Audit: `authorization_started_terminal`.

Replay: `state_recheck_required`.

Side effects: the protected application use case may mutate its named domain after validation, admission, authentication and authorization.

Power effect possibility: none in this endpoint.

Tests: service-management HTTP/application/domain suites and catalog reconciliation.

PR #301 impact: transitive security-envelope preservation.

Adversarial cases: missing/wrong content type, encoding, oversized/duplicate/unknown/malformed body, confirmation mismatch, contention, replay, Host/origin/assertion/principal failures and backend failure.

Verdict: **PASS**.

### DELETE /admin/services/:serviceId/availability

Route ID: `services.availability.delete`

Activation: `ADMINISTRATIVE_SERVICE_AVAILABILITY_HTTP_ENABLED`

Authentication: required Cloudflare Access assertion and administrative principal.

Authorization: operation `remove_registered_service_availability`; permission `services.availability.write`; backend RBAC authoritative.

Request schema: strict JSON <= 8192 bytes; application/json or application/json; charset=utf-8; encoding identity; duplicate and unknown keys rejected.

Response schema: bounded `json` response.

Confirmation: `exact:confirm_registered_service_availability_removal`.

Gate: shared admission plus `service_mutation`.

Audit: `authorization_started_terminal`.

Replay: `state_recheck_required`.

Side effects: the protected application use case may mutate its named domain after validation, admission, authentication and authorization.

Power effect possibility: none in this endpoint.

Tests: service-management HTTP/application/domain suites and catalog reconciliation.

PR #301 impact: transitive security-envelope preservation.

Adversarial cases: missing/wrong content type, encoding, oversized/duplicate/unknown/malformed body, confirmation mismatch, contention, replay, Host/origin/assertion/principal failures and backend failure.

Verdict: **PASS**.

### PUT /admin/services/:serviceId/schedule

Route ID: `services.schedule.update`

Activation: `ADMINISTRATIVE_SERVICE_SCHEDULE_HTTP_ENABLED`

Authentication: required Cloudflare Access assertion and administrative principal.

Authorization: operation `update_registered_service_schedule`; permission `services.availability.write`; backend RBAC authoritative.

Request schema: strict JSON <= 8192 bytes; application/json or application/json; charset=utf-8; encoding identity; duplicate and unknown keys rejected.

Response schema: bounded `json` response.

Confirmation: `exact:confirm_registered_service_schedule_update`.

Gate: shared admission plus `service_mutation`.

Audit: `authorization_started_terminal`.

Replay: `state_recheck_required`.

Side effects: the protected application use case may mutate its named domain after validation, admission, authentication and authorization.

Power effect possibility: none in this endpoint.

Tests: service-management HTTP/application/domain suites and catalog reconciliation.

PR #301 impact: transitive security-envelope preservation.

Adversarial cases: missing/wrong content type, encoding, oversized/duplicate/unknown/malformed body, confirmation mismatch, contention, replay, Host/origin/assertion/principal failures and backend failure.

Verdict: **PASS**.

### DELETE /admin/services/:serviceId/schedule

Route ID: `services.schedule.delete`

Activation: `ADMINISTRATIVE_SERVICE_SCHEDULE_HTTP_ENABLED`

Authentication: required Cloudflare Access assertion and administrative principal.

Authorization: operation `remove_registered_service_schedule`; permission `services.availability.write`; backend RBAC authoritative.

Request schema: strict JSON <= 8192 bytes; application/json or application/json; charset=utf-8; encoding identity; duplicate and unknown keys rejected.

Response schema: bounded `json` response.

Confirmation: `exact:confirm_registered_service_schedule_removal`.

Gate: shared admission plus `service_mutation`.

Audit: `authorization_started_terminal`.

Replay: `state_recheck_required`.

Side effects: the protected application use case may mutate its named domain after validation, admission, authentication and authorization.

Power effect possibility: none in this endpoint.

Tests: service-management HTTP/application/domain suites and catalog reconciliation.

PR #301 impact: transitive security-envelope preservation.

Adversarial cases: missing/wrong content type, encoding, oversized/duplicate/unknown/malformed body, confirmation mismatch, contention, replay, Host/origin/assertion/principal failures and backend failure.

Verdict: **PASS**.

### GET /admin/overview

Route ID: `operations.read`

Activation: `ADMINISTRATIVE_OVERVIEW_HTTP_ENABLED`

Authentication: required Cloudflare Access assertion and administrative principal.

Authorization: operation `read_operations_overview`; permission `operations.read`; backend RBAC authoritative.

Request schema: no body; target <= 4096 bytes.

Response schema: bounded `json` response.

Confirmation: `none`.

Gate: shared admission plus `none`.

Audit: `authorization_only`.

Replay: `read_only`.

Side effects: read-only application query and authorization audit only.

Power effect possibility: none in this endpoint.

Tests: administrative control-plane and authenticated dashboard suites.

PR #301 impact: direct.

Adversarial cases: unexpected body, query/target overflow, wrong method, Host/origin/assertion/principal failures and backend failure.

Verdict: **PASS**.

### GET /admin/backups/targets

Route ID: `backups.targets.read`

Activation: `ADMINISTRATIVE_BACKUP_HTTP_ENABLED`

Authentication: required Cloudflare Access assertion and administrative principal.

Authorization: operation `read_registered_backup_targets`; permission `backups.targets.read`; backend RBAC authoritative.

Request schema: no body; target <= 4096 bytes.

Response schema: bounded `json` response.

Confirmation: `none`.

Gate: shared admission plus `none`.

Audit: `authorization_only`.

Replay: `read_only`.

Side effects: read-only application query and authorization audit only.

Power effect possibility: none in this endpoint.

Tests: backup HTTP/application/rehearsal suites and catalog reconciliation.

PR #301 impact: transitive security-envelope preservation.

Adversarial cases: unexpected body, query/target overflow, wrong method, Host/origin/assertion/principal failures and backend failure.

Verdict: **PASS**.

### GET /admin/backups/targets/:targetId

Route ID: `backups.target.read`

Activation: `ADMINISTRATIVE_BACKUP_HTTP_ENABLED`

Authentication: required Cloudflare Access assertion and administrative principal.

Authorization: operation `read_registered_backup_target`; permission `backups.targets.read`; backend RBAC authoritative.

Request schema: no body; target <= 4096 bytes.

Response schema: bounded `json` response.

Confirmation: `none`.

Gate: shared admission plus `none`.

Audit: `authorization_only`.

Replay: `read_only`.

Side effects: read-only application query and authorization audit only.

Power effect possibility: none in this endpoint.

Tests: backup HTTP/application/rehearsal suites and catalog reconciliation.

PR #301 impact: transitive security-envelope preservation.

Adversarial cases: unexpected body, query/target overflow, wrong method, Host/origin/assertion/principal failures and backend failure.

Verdict: **PASS**.

### GET /admin/backups/runs

Route ID: `backups.runs.read`

Activation: `ADMINISTRATIVE_BACKUP_HTTP_ENABLED`

Authentication: required Cloudflare Access assertion and administrative principal.

Authorization: operation `read_backup_runs`; permission `backups.runs.read`; backend RBAC authoritative.

Request schema: no body; target <= 4096 bytes.

Response schema: bounded `json` response.

Confirmation: `none`.

Gate: shared admission plus `none`.

Audit: `authorization_only`.

Replay: `read_only`.

Side effects: read-only application query and authorization audit only.

Power effect possibility: none in this endpoint.

Tests: backup HTTP/application/rehearsal suites and catalog reconciliation.

PR #301 impact: transitive security-envelope preservation.

Adversarial cases: unexpected body, query/target overflow, wrong method, Host/origin/assertion/principal failures and backend failure.

Verdict: **PASS**.

### GET /admin/backups/runs/:runId

Route ID: `backups.run.read`

Activation: `ADMINISTRATIVE_BACKUP_HTTP_ENABLED`

Authentication: required Cloudflare Access assertion and administrative principal.

Authorization: operation `read_backup_run`; permission `backups.runs.read`; backend RBAC authoritative.

Request schema: no body; target <= 4096 bytes.

Response schema: bounded `json` response.

Confirmation: `none`.

Gate: shared admission plus `none`.

Audit: `authorization_only`.

Replay: `read_only`.

Side effects: read-only application query and authorization audit only.

Power effect possibility: none in this endpoint.

Tests: backup HTTP/application/rehearsal suites and catalog reconciliation.

PR #301 impact: transitive security-envelope preservation.

Adversarial cases: unexpected body, query/target overflow, wrong method, Host/origin/assertion/principal failures and backend failure.

Verdict: **PASS**.

### POST /admin/backups/targets/:targetId/runs

Route ID: `backups.run`

Activation: `ADMINISTRATIVE_BACKUP_HTTP_ENABLED`

Authentication: required Cloudflare Access assertion and administrative principal.

Authorization: operation `run_registered_backup`; permission `backups.run`; backend RBAC authoritative.

Request schema: strict JSON <= 8192 bytes; application/json or application/json; charset=utf-8; encoding identity; duplicate and unknown keys rejected.

Response schema: bounded `json` response.

Confirmation: `exact:confirm_registered_backup_run`.

Gate: shared admission plus `backup_operation`.

Audit: `authorization_started_terminal`.

Replay: `state_recheck_required`.

Side effects: the protected application use case may mutate its named domain after validation, admission, authentication and authorization.

Power effect possibility: none in this endpoint.

Tests: backup HTTP/application/rehearsal suites and catalog reconciliation.

PR #301 impact: transitive security-envelope preservation.

Adversarial cases: missing/wrong content type, encoding, oversized/duplicate/unknown/malformed body, confirmation mismatch, contention, replay, Host/origin/assertion/principal failures and backend failure.

Verdict: **PASS**.

### GET /admin/backups/targets/:targetId/schedule

Route ID: `backups.schedule.read`

Activation: `ADMINISTRATIVE_BACKUP_HTTP_ENABLED`

Authentication: required Cloudflare Access assertion and administrative principal.

Authorization: operation `read_backup_schedule`; permission `backups.schedule.read`; backend RBAC authoritative.

Request schema: no body; target <= 4096 bytes.

Response schema: bounded `json` response.

Confirmation: `none`.

Gate: shared admission plus `none`.

Audit: `authorization_only`.

Replay: `read_only`.

Side effects: read-only application query and authorization audit only.

Power effect possibility: none in this endpoint.

Tests: backup HTTP/application/rehearsal suites and catalog reconciliation.

PR #301 impact: transitive security-envelope preservation.

Adversarial cases: unexpected body, query/target overflow, wrong method, Host/origin/assertion/principal failures and backend failure.

Verdict: **PASS**.

### PUT /admin/backups/targets/:targetId/schedule

Route ID: `backups.schedule.update`

Activation: `ADMINISTRATIVE_BACKUP_HTTP_ENABLED`

Authentication: required Cloudflare Access assertion and administrative principal.

Authorization: operation `update_backup_schedule`; permission `backups.schedule.write`; backend RBAC authoritative.

Request schema: strict JSON <= 8192 bytes; application/json or application/json; charset=utf-8; encoding identity; duplicate and unknown keys rejected.

Response schema: bounded `json` response.

Confirmation: `exact:confirm_registered_backup_schedule_update`.

Gate: shared admission plus `backup_operation`.

Audit: `authorization_started_terminal`.

Replay: `state_recheck_required`.

Side effects: the protected application use case may mutate its named domain after validation, admission, authentication and authorization.

Power effect possibility: none in this endpoint.

Tests: backup HTTP/application/rehearsal suites and catalog reconciliation.

PR #301 impact: transitive security-envelope preservation.

Adversarial cases: missing/wrong content type, encoding, oversized/duplicate/unknown/malformed body, confirmation mismatch, contention, replay, Host/origin/assertion/principal failures and backend failure.

Verdict: **PASS**.

### DELETE /admin/backups/targets/:targetId/schedule

Route ID: `backups.schedule.delete`

Activation: `ADMINISTRATIVE_BACKUP_HTTP_ENABLED`

Authentication: required Cloudflare Access assertion and administrative principal.

Authorization: operation `remove_backup_schedule`; permission `backups.schedule.write`; backend RBAC authoritative.

Request schema: strict JSON <= 8192 bytes; application/json or application/json; charset=utf-8; encoding identity; duplicate and unknown keys rejected.

Response schema: bounded `json` response.

Confirmation: `exact:confirm_registered_backup_schedule_removal`.

Gate: shared admission plus `backup_operation`.

Audit: `authorization_started_terminal`.

Replay: `state_recheck_required`.

Side effects: the protected application use case may mutate its named domain after validation, admission, authentication and authorization.

Power effect possibility: none in this endpoint.

Tests: backup HTTP/application/rehearsal suites and catalog reconciliation.

PR #301 impact: transitive security-envelope preservation.

Adversarial cases: missing/wrong content type, encoding, oversized/duplicate/unknown/malformed body, confirmation mismatch, contention, replay, Host/origin/assertion/principal failures and backend failure.

Verdict: **PASS**.

### GET /admin/backups/targets/:targetId/retention

Route ID: `backups.retention.read`

Activation: `ADMINISTRATIVE_BACKUP_HTTP_ENABLED`

Authentication: required Cloudflare Access assertion and administrative principal.

Authorization: operation `read_backup_retention`; permission `backups.retention.read`; backend RBAC authoritative.

Request schema: no body; target <= 4096 bytes.

Response schema: bounded `json` response.

Confirmation: `none`.

Gate: shared admission plus `none`.

Audit: `authorization_only`.

Replay: `read_only`.

Side effects: read-only application query and authorization audit only.

Power effect possibility: none in this endpoint.

Tests: backup HTTP/application/rehearsal suites and catalog reconciliation.

PR #301 impact: transitive security-envelope preservation.

Adversarial cases: unexpected body, query/target overflow, wrong method, Host/origin/assertion/principal failures and backend failure.

Verdict: **PASS**.

### PUT /admin/backups/targets/:targetId/retention

Route ID: `backups.retention.update`

Activation: `ADMINISTRATIVE_BACKUP_HTTP_ENABLED`

Authentication: required Cloudflare Access assertion and administrative principal.

Authorization: operation `update_backup_retention`; permission `backups.retention.write`; backend RBAC authoritative.

Request schema: strict JSON <= 8192 bytes; application/json or application/json; charset=utf-8; encoding identity; duplicate and unknown keys rejected.

Response schema: bounded `json` response.

Confirmation: `exact:confirm_registered_backup_retention_update`.

Gate: shared admission plus `backup_operation`.

Audit: `authorization_started_terminal`.

Replay: `state_recheck_required`.

Side effects: the protected application use case may mutate its named domain after validation, admission, authentication and authorization.

Power effect possibility: none in this endpoint.

Tests: backup HTTP/application/rehearsal suites and catalog reconciliation.

PR #301 impact: transitive security-envelope preservation.

Adversarial cases: missing/wrong content type, encoding, oversized/duplicate/unknown/malformed body, confirmation mismatch, contention, replay, Host/origin/assertion/principal failures and backend failure.

Verdict: **PASS**.

### POST /admin/backups/targets/:targetId/retention/prunes

Route ID: `backups.retention.prune`

Activation: `ADMINISTRATIVE_BACKUP_HTTP_ENABLED`

Authentication: required Cloudflare Access assertion and administrative principal.

Authorization: operation `run_backup_retention_prune`; permission `backups.retention.prune`; backend RBAC authoritative.

Request schema: strict JSON <= 8192 bytes; application/json or application/json; charset=utf-8; encoding identity; duplicate and unknown keys rejected.

Response schema: bounded `json` response.

Confirmation: `exact:confirm_registered_backup_retention_prune`.

Gate: shared admission plus `backup_operation`.

Audit: `authorization_started_terminal`.

Replay: `state_recheck_required`.

Side effects: the protected application use case may mutate its named domain after validation, admission, authentication and authorization.

Power effect possibility: none in this endpoint.

Tests: backup HTTP/application/rehearsal suites and catalog reconciliation.

PR #301 impact: transitive security-envelope preservation.

Adversarial cases: missing/wrong content type, encoding, oversized/duplicate/unknown/malformed body, confirmation mismatch, contention, replay, Host/origin/assertion/principal failures and backend failure.

Verdict: **PASS**.

### POST /admin/backups/scheduler/ticks

Route ID: `backups.scheduler.tick`

Activation: `ADMINISTRATIVE_BACKUP_HTTP_ENABLED`

Authentication: required Cloudflare Access assertion and administrative principal.

Authorization: operation `run_backup_scheduler_tick`; permission `backups.scheduler.tick`; backend RBAC authoritative.

Request schema: strict JSON <= 8192 bytes; application/json or application/json; charset=utf-8; encoding identity; duplicate and unknown keys rejected.

Response schema: bounded `json` response.

Confirmation: `exact:confirm_backup_scheduler_tick`.

Gate: shared admission plus `backup_operation`.

Audit: `authorization_started_terminal`.

Replay: `claim_protected`.

Side effects: the protected application use case may mutate its named domain after validation, admission, authentication and authorization.

Power effect possibility: none in this endpoint.

Tests: backup HTTP/application/rehearsal suites and catalog reconciliation.

PR #301 impact: transitive security-envelope preservation.

Adversarial cases: missing/wrong content type, encoding, oversized/duplicate/unknown/malformed body, confirmation mismatch, contention, replay, Host/origin/assertion/principal failures and backend failure.

Verdict: **PASS**.

### GET /admin/event-history/integrity

Route ID: `event_history.integrity.read`

Activation: `ADMINISTRATIVE_EVENT_HISTORY_OPERATIONS_HTTP_ENABLED`

Authentication: required Cloudflare Access assertion and administrative principal.

Authorization: operation `verify_event_history_integrity`; permission `event_history.integrity.read`; backend RBAC authoritative.

Request schema: no body; target <= 4096 bytes.

Response schema: bounded `json` response.

Confirmation: `none`.

Gate: shared admission plus `none`.

Audit: `authorization_only`.

Replay: `read_only`.

Side effects: read-only application query and authorization audit only.

Power effect possibility: none in this endpoint.

Tests: event-history route/integration/lifecycle suites and catalog reconciliation.

PR #301 impact: transitive security-envelope preservation.

Adversarial cases: unexpected body, query/target overflow, wrong method, Host/origin/assertion/principal failures and backend failure.

Verdict: **PASS**.

### POST /admin/event-history/rotations

Route ID: `event_history.rotation.run`

Activation: `ADMINISTRATIVE_EVENT_HISTORY_OPERATIONS_HTTP_ENABLED`

Authentication: required Cloudflare Access assertion and administrative principal.

Authorization: operation `rotate_event_history`; permission `event_history.rotation.run`; backend RBAC authoritative.

Request schema: strict JSON <= 8192 bytes; application/json or application/json; charset=utf-8; encoding identity; duplicate and unknown keys rejected.

Response schema: bounded `json` response.

Confirmation: `exact:confirm_administrative_event_history_rotation`.

Gate: shared admission plus `event_history_maintenance`.

Audit: `authorization_started_terminal`.

Replay: `conflict_protected`.

Side effects: the protected application use case may mutate its named domain after validation, admission, authentication and authorization.

Power effect possibility: none in this endpoint.

Tests: event-history route/integration/lifecycle suites and catalog reconciliation.

PR #301 impact: transitive security-envelope preservation.

Adversarial cases: missing/wrong content type, encoding, oversized/duplicate/unknown/malformed body, confirmation mismatch, contention, replay, Host/origin/assertion/principal failures and backend failure.

Verdict: **PASS**.

### GET /admin/event-history/retention

Route ID: `event_history.retention.read`

Activation: `ADMINISTRATIVE_EVENT_HISTORY_OPERATIONS_HTTP_ENABLED`

Authentication: required Cloudflare Access assertion and administrative principal.

Authorization: operation `read_event_history_retention`; permission `event_history.retention.read`; backend RBAC authoritative.

Request schema: no body; target <= 4096 bytes.

Response schema: bounded `json` response.

Confirmation: `none`.

Gate: shared admission plus `none`.

Audit: `authorization_only`.

Replay: `read_only`.

Side effects: read-only application query and authorization audit only.

Power effect possibility: none in this endpoint.

Tests: event-history route/integration/lifecycle suites and catalog reconciliation.

PR #301 impact: transitive security-envelope preservation.

Adversarial cases: unexpected body, query/target overflow, wrong method, Host/origin/assertion/principal failures and backend failure.

Verdict: **PASS**.

### PUT /admin/event-history/retention

Route ID: `event_history.retention.update`

Activation: `ADMINISTRATIVE_EVENT_HISTORY_OPERATIONS_HTTP_ENABLED`

Authentication: required Cloudflare Access assertion and administrative principal.

Authorization: operation `update_event_history_retention`; permission `event_history.retention.write`; backend RBAC authoritative.

Request schema: strict JSON <= 8192 bytes; application/json or application/json; charset=utf-8; encoding identity; duplicate and unknown keys rejected.

Response schema: bounded `json` response.

Confirmation: `exact:confirm_administrative_event_history_retention_update`.

Gate: shared admission plus `event_history_maintenance`.

Audit: `authorization_started_terminal`.

Replay: `state_recheck_required`.

Side effects: the protected application use case may mutate its named domain after validation, admission, authentication and authorization.

Power effect possibility: none in this endpoint.

Tests: event-history route/integration/lifecycle suites and catalog reconciliation.

PR #301 impact: transitive security-envelope preservation.

Adversarial cases: missing/wrong content type, encoding, oversized/duplicate/unknown/malformed body, confirmation mismatch, contention, replay, Host/origin/assertion/principal failures and backend failure.

Verdict: **PASS**.

### POST /admin/event-history/retention/prunes

Route ID: `event_history.retention.prune`

Activation: `ADMINISTRATIVE_EVENT_HISTORY_OPERATIONS_HTTP_ENABLED`

Authentication: required Cloudflare Access assertion and administrative principal.

Authorization: operation `prune_event_history`; permission `event_history.retention.prune`; backend RBAC authoritative.

Request schema: strict JSON <= 8192 bytes; application/json or application/json; charset=utf-8; encoding identity; duplicate and unknown keys rejected.

Response schema: bounded `json` response.

Confirmation: `exact:confirm_administrative_event_history_retention_prune`.

Gate: shared admission plus `event_history_maintenance`.

Audit: `authorization_started_terminal`.

Replay: `conflict_protected`.

Side effects: the protected application use case may mutate its named domain after validation, admission, authentication and authorization.

Power effect possibility: none in this endpoint.

Tests: event-history route/integration/lifecycle suites and catalog reconciliation.

PR #301 impact: transitive security-envelope preservation.

Adversarial cases: missing/wrong content type, encoding, oversized/duplicate/unknown/malformed body, confirmation mismatch, contention, replay, Host/origin/assertion/principal failures and backend failure.

Verdict: **PASS**.

### GET /admin/event-history/exports

Route ID: `event_history.exports.read`

Activation: `ADMINISTRATIVE_EVENT_HISTORY_OPERATIONS_HTTP_ENABLED`

Authentication: required Cloudflare Access assertion and administrative principal.

Authorization: operation `list_event_history_exports`; permission `event_history.exports.read`; backend RBAC authoritative.

Request schema: no body; target <= 4096 bytes.

Response schema: bounded `json` response.

Confirmation: `none`.

Gate: shared admission plus `none`.

Audit: `authorization_only`.

Replay: `read_only`.

Side effects: read-only application query and authorization audit only.

Power effect possibility: none in this endpoint.

Tests: event-history route/integration/lifecycle suites and catalog reconciliation.

PR #301 impact: transitive security-envelope preservation.

Adversarial cases: unexpected body, query/target overflow, wrong method, Host/origin/assertion/principal failures and backend failure.

Verdict: **PASS**.

### POST /admin/event-history/exports

Route ID: `event_history.exports.create`

Activation: `ADMINISTRATIVE_EVENT_HISTORY_OPERATIONS_HTTP_ENABLED`

Authentication: required Cloudflare Access assertion and administrative principal.

Authorization: operation `create_event_history_export`; permission `event_history.exports.create`; backend RBAC authoritative.

Request schema: strict JSON <= 8192 bytes; application/json or application/json; charset=utf-8; encoding identity; duplicate and unknown keys rejected.

Response schema: bounded `json` response.

Confirmation: `exact:confirm_administrative_event_history_export`.

Gate: shared admission plus `event_history_maintenance`.

Audit: `authorization_started_terminal`.

Replay: `state_recheck_required`.

Side effects: the protected application use case may mutate its named domain after validation, admission, authentication and authorization.

Power effect possibility: none in this endpoint.

Tests: event-history route/integration/lifecycle suites and catalog reconciliation.

PR #301 impact: transitive security-envelope preservation.

Adversarial cases: missing/wrong content type, encoding, oversized/duplicate/unknown/malformed body, confirmation mismatch, contention, replay, Host/origin/assertion/principal failures and backend failure.

Verdict: **PASS**.

### GET /admin/event-history/exports/:exportId

Route ID: `event_history.export.read`

Activation: `ADMINISTRATIVE_EVENT_HISTORY_OPERATIONS_HTTP_ENABLED`

Authentication: required Cloudflare Access assertion and administrative principal.

Authorization: operation `read_event_history_export`; permission `event_history.exports.read`; backend RBAC authoritative.

Request schema: no body; target <= 4096 bytes.

Response schema: bounded `json` response.

Confirmation: `none`.

Gate: shared admission plus `none`.

Audit: `authorization_only`.

Replay: `read_only`.

Side effects: read-only application query and authorization audit only.

Power effect possibility: none in this endpoint.

Tests: event-history route/integration/lifecycle suites and catalog reconciliation.

PR #301 impact: transitive security-envelope preservation.

Adversarial cases: unexpected body, query/target overflow, wrong method, Host/origin/assertion/principal failures and backend failure.

Verdict: **PASS**.

### GET /admin/event-history/exports/:exportId/content

Route ID: `event_history.export.download`

Activation: `ADMINISTRATIVE_EVENT_HISTORY_OPERATIONS_HTTP_ENABLED`

Authentication: required Cloudflare Access assertion and administrative principal.

Authorization: operation `download_event_history_export`; permission `event_history.exports.download`; backend RBAC authoritative.

Request schema: no body; target <= 4096 bytes.

Response schema: bounded `download` response.

Confirmation: `none`.

Gate: shared admission plus `none`.

Audit: `authorization_only`.

Replay: `read_only`.

Side effects: read-only application query and authorization audit only.

Power effect possibility: none in this endpoint.

Tests: event-history route/integration/lifecycle suites and catalog reconciliation.

PR #301 impact: transitive security-envelope preservation.

Adversarial cases: unexpected body, query/target overflow, wrong method, Host/origin/assertion/principal failures and backend failure.

Verdict: **PASS**.

### POST /admin/event-history/exports/retention/prunes

Route ID: `event_history.exports.prune`

Activation: `ADMINISTRATIVE_EVENT_HISTORY_OPERATIONS_HTTP_ENABLED`

Authentication: required Cloudflare Access assertion and administrative principal.

Authorization: operation `prune_event_history_exports`; permission `event_history.exports.prune`; backend RBAC authoritative.

Request schema: strict JSON <= 8192 bytes; application/json or application/json; charset=utf-8; encoding identity; duplicate and unknown keys rejected.

Response schema: bounded `json` response.

Confirmation: `exact:confirm_administrative_event_history_export_prune`.

Gate: shared admission plus `event_history_maintenance`.

Audit: `authorization_started_terminal`.

Replay: `conflict_protected`.

Side effects: the protected application use case may mutate its named domain after validation, admission, authentication and authorization.

Power effect possibility: none in this endpoint.

Tests: event-history route/integration/lifecycle suites and catalog reconciliation.

PR #301 impact: transitive security-envelope preservation.

Adversarial cases: missing/wrong content type, encoding, oversized/duplicate/unknown/malformed body, confirmation mismatch, contention, replay, Host/origin/assertion/principal failures and backend failure.

Verdict: **PASS**.

### GET /admin/security/status

Route ID: `security.status.read`

Activation: `ADMINISTRATIVE_SECURITY_STATUS_HTTP_ENABLED`

Authentication: required Cloudflare Access assertion and administrative principal.

Authorization: operation `read_administrative_security_posture`; permission `security.posture.read`; backend RBAC authoritative.

Request schema: no body; target <= 4096 bytes.

Response schema: bounded `json` response.

Confirmation: `none`.

Gate: shared admission plus `none`.

Audit: `authorization_only`.

Replay: `read_only`.

Side effects: read-only application query and authorization audit only.

Power effect possibility: none in this endpoint.

Tests: route-specific security and catalog reconciliation suites.

PR #301 impact: transitive security-envelope preservation.

Adversarial cases: unexpected body, query/target overflow, wrong method, Host/origin/assertion/principal failures and backend failure.

Verdict: **PASS**.

## Runtime-probe boundary

The physical destination remains `127.0.0.1:3000`; only `request.Host` uses
the authority derived from `ADMINISTRATIVE_PUBLIC_ORIGIN`. Enabled mutation
probes carry valid future-dated mock bodies and exact confirmation strings, but
no assertion, and therefore must stop at the expected `401`/`403` envelope
before use-case execution. Disabled routes must return `404`. Wake cancellation
is bodyless in both catalog and handler.
