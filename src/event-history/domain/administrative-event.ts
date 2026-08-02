import { isCanonicalTimestamp } from "../../power-management/domain/canonical-timestamp.js";

export const ADMINISTRATIVE_EVENT_SOURCES = Object.freeze([
  "administrative",
  "automated",
  "system",
] as const);
export const ADMINISTRATIVE_EVENT_TARGET_KIND = "machine" as const;
export const ADMINISTRATIVE_EVENT_TARGET_ID = "atlas" as const;
export const ADMINISTRATIVE_EVENT_OPERATIONS = Object.freeze([
  "authorize_administrative_operation",
  "schedule_wake_alarm",
  "cancel_wake_alarm",
  "request_machine_shutdown",
  "prepare_machine_shutdown_occurrence",
  "execute_machine_shutdown_occurrence",
  "run_machine_power_scheduler_tick",
  "start_registered_service",
  "stop_registered_service",
  "restart_registered_service",
  "update_registered_service_availability",
  "remove_registered_service_availability",
  "run_registered_backup",
  "update_backup_schedule",
  "remove_backup_schedule",
  "update_backup_retention",
  "run_backup_retention_prune",
  "run_backup_scheduler_tick",
  "verify_event_history_integrity",
  "rotate_administrative_event_history",
  "update_administrative_event_history_retention",
  "prune_administrative_event_history",
  "create_administrative_event_history_export",
  "prune_administrative_event_history_exports",
  "recover_administrative_event_history_stale_lock",
  "migrate_administrative_event_history_v1",
  "read_event_history_retention",
  "list_event_history_exports",
  "read_event_history_export",
  "download_event_history_export",
  "read_administrative_security_posture",
] as const);
export const ADMINISTRATIVE_EVENT_STATUSES = Object.freeze([
  "started",
  "succeeded",
  "rejected",
  "failed",
] as const);
export const ADMINISTRATIVE_EVENT_MUTATION_OUTCOMES = Object.freeze([
  "scheduled",
  "replaced",
  "unchanged",
  "cancelled",
  "not_scheduled",
] as const);
export const ADMINISTRATIVE_EVENT_PREPARATION_OUTCOMES = Object.freeze([
  "not_required",
  "blocked",
  "prepared",
  "incomplete",
] as const);
export const ADMINISTRATIVE_EVENT_EXECUTION_OUTCOMES = Object.freeze([
  "not_due",
  "stale",
  "rejected",
  "preparation_incomplete",
  "duplicate",
  "executed",
] as const);
export const ADMINISTRATIVE_EVENT_SCHEDULER_OUTCOMES = Object.freeze([
  "initialized",
  "idle",
  "blocked",
  "incomplete",
  "advanced",
  "conflict",
] as const);

export type AdministrativeEventSourceKind =
  (typeof ADMINISTRATIVE_EVENT_SOURCES)[number];
export type AdministrativeEventOperation =
  (typeof ADMINISTRATIVE_EVENT_OPERATIONS)[number];
export type AdministrativeEventStatus =
  (typeof ADMINISTRATIVE_EVENT_STATUSES)[number];
export type AdministrativeEventMutationOutcome =
  (typeof ADMINISTRATIVE_EVENT_MUTATION_OUTCOMES)[number];
export type AdministrativeEventPreparationOutcome =
  (typeof ADMINISTRATIVE_EVENT_PREPARATION_OUTCOMES)[number];
export type AdministrativeEventExecutionOutcome =
  (typeof ADMINISTRATIVE_EVENT_EXECUTION_OUTCOMES)[number];
export type AdministrativeEventSchedulerOutcome =
  (typeof ADMINISTRATIVE_EVENT_SCHEDULER_OUTCOMES)[number];

export const ADMINISTRATIVE_AUTHORIZATION_REASON_CODES = Object.freeze([
  "credentials_absent",
  "credentials_invalid",
  "identity_provider_unavailable",
  "principal_unknown",
  "permission_denied",
  "role_assignment_unavailable",
  "authorization_policy_unavailable",
] as const);
export type AdministrativeAuthorizationReasonCode =
  (typeof ADMINISTRATIVE_AUTHORIZATION_REASON_CODES)[number];

export type AdministrativeEventFailureCode =
  | "backup_operation_failed"
  | "administrative_audit_failed"
  | "audit_failed_after_wake_alarm_mutation"
  | "audit_failed_after_shutdown_request"
  | "audit_failed_after_shutdown_execution"
  | "audit_failed_after_shutdown_preparation"
  | "audit_failed_after_scheduler_tick"
  | "claim_failed"
  | "wake_alarm_preparation_failed"
  | "shutdown_failed_after_wake_scheduled"
  | "preparation_dependency_failed"
  | "service_stop_failed"
  | "backup_completion_failed"
  | "filesystem_synchronization_failed"
  | "event_recording_failed"
  | "unexpected_execution_failure"
  | "clock_regression"
  | "interval_too_large"
  | "cursor_conflict"
  | "helper_unavailable"
  | "helper_installation_invalid"
  | "helper_timeout"
  | "helper_output_invalid"
  | "helper_operation_rejected"
  | "helper_operation_failed"
  | "helper_not_found"
  | "helper_not_regular_file"
  | "helper_symbolic_link_rejected"
  | "helper_owner_invalid"
  | "helper_not_executable"
  | "helper_parent_invalid"
  | "helper_inspection_failed"
  | "helper_start_failed"
  | "helper_io_failed"
  | "helper_exit_failed"
  | "helper_terminated"
  | "helper_stdout_too_large"
  | "helper_stderr_too_large"
  | "helper_protocol_invalid"
  | "unsupported_platform"
  | "backup_completion_unknown"
  | "filesystem_synchronization_unknown"
  | "confirmation_unavailable"
  | "event_recording_unavailable"
  | "readiness_dependency_failed"
  | "service_readiness_unavailable"
  | "service_required_during_offline_interval"
  | "service_failed"
  | "service_state_unknown"
  | "backup_state_unknown"
  | "filesystem_state_unknown"
  | "event_history_path_invalid"
  | "event_history_parent_invalid"
  | "event_history_file_invalid"
  | "event_history_permissions_unsafe"
  | "event_history_read_failed"
  | "event_history_write_failed"
  | "event_history_sync_failed"
  | "event_history_corrupted"
  | "event_history_capacity_exceeded"
  | "administrative_event_recording_failed";

export type AdministrativeEventSource = Readonly<{
  kind: AdministrativeEventSourceKind;
  actorId:
    | "unattributed-local"
    | "unauthenticated"
    | "machine-power-scheduler"
    | "atlas-manager"
    | `administrator:${string}`;
}>;
export type AdministrativeEventTarget = Readonly<{
  kind: "machine";
  id: "atlas";
}>;

export type AdministrativeEventDetails = Readonly<Record<string, unknown>>;

export interface AdministrativeEventInput {
  readonly attemptId: string;
  readonly occurredAt: string;
  readonly source: AdministrativeEventSource;
  readonly target: AdministrativeEventTarget;
  readonly operation: AdministrativeEventOperation;
  readonly status: AdministrativeEventStatus;
  readonly details?: AdministrativeEventDetails;
}

export interface AdministrativeEvent extends AdministrativeEventInput {
  readonly sequence: number;
}

export type AdministrativeEventValidationErrorCode =
  | "invalid_record"
  | "invalid_field"
  | "invalid_sequence"
  | "invalid_attempt_id"
  | "invalid_occurred_at"
  | "invalid_source"
  | "invalid_target"
  | "invalid_operation"
  | "invalid_status"
  | "invalid_details"
  | "invalid_failure_code";

export class AdministrativeEventValidationError extends Error {
  public override readonly name = "AdministrativeEventValidationError";

  public constructor(
    public readonly code: AdministrativeEventValidationErrorCode,
  ) {
    super(`Invalid administrative event: ${code}`);
    Object.freeze(this);
  }
}

export function createAdministrativeEventInput(
  input: unknown,
): AdministrativeEventInput {
  const record = requireRecord(input);
  assertFields(record, [
    "attemptId",
    "occurredAt",
    "source",
    "target",
    "operation",
    "status",
    "details",
  ]);
  const source = createSource(record["source"]);
  const target = createTarget(record["target"]);
  const operation = record["operation"];
  if (!isOperation(operation))
    throw new AdministrativeEventValidationError("invalid_operation");
  const status = record["status"];
  if (!isStatus(status))
    throw new AdministrativeEventValidationError("invalid_status");
  if (!isAttemptId(record["attemptId"]))
    throw new AdministrativeEventValidationError("invalid_attempt_id");
  if (!isCanonicalTimestamp(record["occurredAt"]))
    throw new AdministrativeEventValidationError("invalid_occurred_at");
  const details = Object.hasOwn(record, "details")
    ? createDetails(operation, status, record["details"])
    : undefined;
  return Object.freeze({
    attemptId: record["attemptId"],
    occurredAt: record["occurredAt"],
    source,
    target,
    operation,
    status,
    ...(details ? { details } : {}),
  });
}

export function createAdministrativeEvent(input: unknown): AdministrativeEvent {
  const record = requireRecord(input);
  assertFields(record, [
    "sequence",
    "attemptId",
    "occurredAt",
    "source",
    "target",
    "operation",
    "status",
    "details",
  ]);
  if (
    !Number.isSafeInteger(record["sequence"]) ||
    (record["sequence"] as number) < 1
  )
    throw new AdministrativeEventValidationError("invalid_sequence");
  const event = createAdministrativeEventInput({
    attemptId: record["attemptId"],
    occurredAt: record["occurredAt"],
    source: record["source"],
    target: record["target"],
    operation: record["operation"],
    status: record["status"],
    ...(Object.hasOwn(record, "details") ? { details: record["details"] } : {}),
  });
  return Object.freeze({ sequence: record["sequence"] as number, ...event });
}

export function createAdministrativeEventSource(
  input: unknown,
): AdministrativeEventSource {
  return createSource(input);
}

export function createAdministrativeEventTarget(
  input: unknown,
): AdministrativeEventTarget {
  return createTarget(input);
}

function createSource(input: unknown): AdministrativeEventSource {
  const record = requireRecord(input);
  assertFields(record, ["kind", "actorId"]);
  const kind = record["kind"];
  const actorId = record["actorId"];
  const verifiedAdministrator =
    typeof actorId === "string" &&
    /^administrator:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
      actorId,
    );
  if (
    (kind !== "administrative" && kind !== "automated" && kind !== "system") ||
    (kind === "administrative" &&
      actorId !== "unattributed-local" &&
      actorId !== "unauthenticated" &&
      !verifiedAdministrator) ||
    (kind === "automated" && actorId !== "machine-power-scheduler") ||
    (kind === "system" && actorId !== "atlas-manager")
  )
    throw new AdministrativeEventValidationError("invalid_source");
  return Object.freeze({
    kind,
    actorId: actorId as AdministrativeEventSource["actorId"],
  });
}

function createTarget(input: unknown): AdministrativeEventTarget {
  const record = requireRecord(input);
  assertFields(record, ["kind", "id"]);
  if (record["kind"] !== "machine" || record["id"] !== "atlas")
    throw new AdministrativeEventValidationError("invalid_target");
  return Object.freeze({ kind: "machine", id: "atlas" });
}

function createDetails(
  operation: AdministrativeEventOperation,
  status: AdministrativeEventStatus,
  input: unknown,
): AdministrativeEventDetails | undefined {
  if (input === undefined) {
    if (
      (operation === "cancel_wake_alarm" ||
        operation === "request_machine_shutdown") &&
      status === "started"
    )
      return undefined;
    throw new AdministrativeEventValidationError("invalid_details");
  }
  const record = requireRecord(input);
  if (operation === "authorize_administrative_operation") {
    if (status !== "succeeded" && status !== "rejected")
      throw new AdministrativeEventValidationError("invalid_details");
    assertAllowedKeys(record, [
      "requestedOperation",
      "permission",
      "decision",
      "reasonCode",
    ]);
    const requestedOperation = record["requestedOperation"];
    const permission = record["permission"];
    const decision = record["decision"];
    const validOperation = [
      "read_wake_alarm",
      "schedule_wake_alarm",
      "cancel_wake_alarm",
      "request_machine_shutdown",
      "prepare_machine_shutdown_occurrence",
      "execute_machine_shutdown_occurrence",
      "run_machine_power_scheduler_tick",
      "read_administrative_event_history",
      "read_registered_services",
      "read_registered_service",
      "start_registered_service",
      "stop_registered_service",
      "restart_registered_service",
      "read_registered_service_availability",
      "update_registered_service_availability",
      "remove_registered_service_availability",
      "run_registered_backup",
      "update_backup_schedule",
      "remove_backup_schedule",
      "update_backup_retention",
      "run_backup_retention_prune",
      "run_backup_scheduler_tick",
      "read_operations_overview",
      "read_administrative_dashboard",
      "read_administrative_security_posture",
      "verify_event_history_integrity",
      "rotate_administrative_event_history",
      "update_administrative_event_history_retention",
      "prune_administrative_event_history",
      "create_administrative_event_history_export",
      "prune_administrative_event_history_exports",
      "read_event_history_retention",
      "list_event_history_exports",
      "read_event_history_export",
      "download_event_history_export",
    ].includes(requestedOperation as string);
    const validPermission = [
      "power.wake.read",
      "power.wake.schedule",
      "power.wake.cancel",
      "power.shutdown.request",
      "power.shutdown.prepare",
      "power.shutdown.execute",
      "power.scheduler.tick",
      "event_history.read",
      "services.read",
      "services.start",
      "services.stop",
      "services.restart",
      "services.availability.read",
      "services.availability.write",
      "operations.read",
      "dashboard.read",
      "security.posture.read",
      "backups.targets.read",
      "backups.runs.read",
      "backups.run",
      "backups.schedule.read",
      "backups.schedule.write",
      "backups.retention.read",
      "backups.retention.write",
      "backups.retention.prune",
      "backups.scheduler.tick",
      "event_history.integrity.read",
      "event_history.rotation.run",
      "event_history.retention.read",
      "event_history.retention.write",
      "event_history.retention.prune",
      "event_history.exports.read",
      "event_history.exports.create",
      "event_history.exports.download",
      "event_history.exports.prune",
    ].includes(permission as string);
    const expected = {
      read_wake_alarm: "power.wake.read",
      schedule_wake_alarm: "power.wake.schedule",
      cancel_wake_alarm: "power.wake.cancel",
      request_machine_shutdown: "power.shutdown.request",
      prepare_machine_shutdown_occurrence: "power.shutdown.prepare",
      execute_machine_shutdown_occurrence: "power.shutdown.execute",
      run_machine_power_scheduler_tick: "power.scheduler.tick",
      read_administrative_event_history: "event_history.read",
      read_registered_services: "services.read",
      read_registered_service: "services.read",
      start_registered_service: "services.start",
      stop_registered_service: "services.stop",
      restart_registered_service: "services.restart",
      read_registered_service_availability: "services.availability.read",
      update_registered_service_availability: "services.availability.write",
      remove_registered_service_availability: "services.availability.write",
      run_registered_backup: "backups.run",
      update_backup_schedule: "backups.schedule.write",
      remove_backup_schedule: "backups.schedule.write",
      update_backup_retention: "backups.retention.write",
      run_backup_retention_prune: "backups.retention.prune",
      run_backup_scheduler_tick: "backups.scheduler.tick",
      read_operations_overview: "operations.read",
      read_administrative_dashboard: "dashboard.read",
      read_administrative_security_posture: "security.posture.read",
      verify_event_history_integrity: "event_history.integrity.read",
      rotate_administrative_event_history: "event_history.rotation.run",
      update_administrative_event_history_retention:
        "event_history.retention.write",
      prune_administrative_event_history: "event_history.retention.prune",
      create_administrative_event_history_export:
        "event_history.exports.create",
      prune_administrative_event_history_exports: "event_history.exports.prune",
      read_event_history_retention: "event_history.retention.read",
      list_event_history_exports: "event_history.exports.read",
      read_event_history_export: "event_history.exports.read",
      download_event_history_export: "event_history.exports.download",
    } as Record<string, string>;
    if (
      !validOperation ||
      !validPermission ||
      expected[requestedOperation as string] !== permission ||
      (decision !== "allowed" && decision !== "denied") ||
      (status === "succeeded" && decision !== "allowed") ||
      (status === "rejected" && decision !== "denied")
    )
      throw new AdministrativeEventValidationError("invalid_details");
    if (decision === "allowed") {
      if (Object.hasOwn(record, "reasonCode"))
        throw new AdministrativeEventValidationError("invalid_details");
      return Object.freeze({ requestedOperation, permission, decision });
    }
    const reasonCode = record["reasonCode"];
    if (
      typeof reasonCode !== "string" ||
      !(
        ADMINISTRATIVE_AUTHORIZATION_REASON_CODES as readonly string[]
      ).includes(reasonCode)
    )
      throw new AdministrativeEventValidationError("invalid_details");
    return Object.freeze({
      requestedOperation,
      permission,
      decision,
      reasonCode,
    });
  }
  if (
    operation === "run_registered_backup" ||
    operation === "update_backup_schedule" ||
    operation === "remove_backup_schedule" ||
    operation === "update_backup_retention" ||
    operation === "run_backup_retention_prune"
  ) {
    const targetId = record["targetId"];
    if (
      typeof targetId !== "string" ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(targetId) ||
      targetId.length > 64
    )
      throw new AdministrativeEventValidationError("invalid_details");
    if (status === "started") {
      if (!hasExactFields(record, ["targetId"]))
        throw new AdministrativeEventValidationError("invalid_details");
      return Object.freeze({ targetId });
    }
    if (status === "succeeded") {
      if (
        !hasExactFields(record, ["targetId", "outcome"]) ||
        record["outcome"] !== "succeeded"
      )
        throw new AdministrativeEventValidationError("invalid_details");
      return Object.freeze({ targetId, outcome: "succeeded" as const });
    }
    if (status === "failed") {
      if (
        !hasExactFields(record, ["targetId", "failureCode"]) ||
        typeof record["failureCode"] !== "string" ||
        !SAFE_FAILURE_CODES.has(record["failureCode"])
      )
        throw new AdministrativeEventValidationError("invalid_details");
      return Object.freeze({ targetId, failureCode: record["failureCode"] });
    }
    throw new AdministrativeEventValidationError("invalid_details");
  }
  if (operation === "run_backup_scheduler_tick") {
    if (status === "started") {
      if (!hasExactFields(record, []))
        throw new AdministrativeEventValidationError("invalid_details");
      return Object.freeze({});
    }
    if (
      status === "succeeded" &&
      hasExactFields(record, ["outcome"]) &&
      typeof record["outcome"] === "string"
    )
      return Object.freeze({ outcome: record["outcome"] });
    if (
      status === "failed" &&
      hasExactFields(record, ["failureCode"]) &&
      typeof record["failureCode"] === "string" &&
      SAFE_FAILURE_CODES.has(record["failureCode"])
    )
      return Object.freeze({ failureCode: record["failureCode"] });
    throw new AdministrativeEventValidationError("invalid_details");
  }
  if (
    operation === "verify_event_history_integrity" ||
    operation === "rotate_administrative_event_history" ||
    operation === "update_administrative_event_history_retention" ||
    operation === "prune_administrative_event_history" ||
    operation === "create_administrative_event_history_export" ||
    operation === "prune_administrative_event_history_exports" ||
    operation === "recover_administrative_event_history_stale_lock" ||
    operation === "migrate_administrative_event_history_v1" ||
    operation === "read_event_history_retention" ||
    operation === "list_event_history_exports" ||
    operation === "read_event_history_export" ||
    operation === "download_event_history_export"
  )
    return createEventHistoryOperationalDetails(record, status);
  if (
    operation === "start_registered_service" ||
    operation === "stop_registered_service" ||
    operation === "restart_registered_service" ||
    operation === "update_registered_service_availability" ||
    operation === "remove_registered_service_availability"
  ) {
    const serviceId = record["serviceId"];
    if (
      typeof serviceId !== "string" ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(serviceId) ||
      serviceId.length > 64
    )
      throw new AdministrativeEventValidationError("invalid_details");
    if (status === "started") {
      if (!hasExactFields(record, ["serviceId"]))
        throw new AdministrativeEventValidationError("invalid_details");
      return Object.freeze({ serviceId });
    }
    if (status === "succeeded") {
      if (
        !hasExactFields(record, ["serviceId", "outcome"]) ||
        record["outcome"] !== "succeeded"
      )
        throw new AdministrativeEventValidationError("invalid_details");
      return Object.freeze({ serviceId, outcome: "succeeded" as const });
    }
    if (status === "failed") {
      if (
        !hasExactFields(record, ["serviceId", "failureCode"]) ||
        record["failureCode"] !== "service_failed"
      )
        throw new AdministrativeEventValidationError("invalid_details");
      return Object.freeze({
        serviceId,
        failureCode: "service_failed" as const,
      });
    }
    throw new AdministrativeEventValidationError("invalid_details");
  }
  if (operation === "schedule_wake_alarm") {
    if (status === "started") {
      assertAllowedKeys(record, ["scheduledFor"]);
      const scheduledFor = requireTimestampField(record, "scheduledFor");
      return Object.freeze({ scheduledFor });
    }
    if (status === "succeeded") {
      const scheduledFor = requireTimestampField(record, "scheduledFor");
      const mutationOutcome = requireMutationOutcome(
        record,
        "mutationOutcome",
        ["scheduled", "replaced", "unchanged"],
      );
      return Object.freeze({ scheduledFor, mutationOutcome });
    }
    return failureDetails(record);
  }
  if (operation === "cancel_wake_alarm") {
    if (status === "started") {
      assertAllowedKeys(record, []);
      return Object.freeze({});
    }
    if (status === "succeeded") {
      const mutationOutcome = requireMutationOutcome(
        record,
        "mutationOutcome",
        ["cancelled", "not_scheduled"],
      );
      return Object.freeze({ mutationOutcome });
    }
    return failureDetails(record);
  }
  if (operation === "request_machine_shutdown") {
    if (status === "started") {
      assertAllowedKeys(record, []);
      return Object.freeze({});
    }
    if (status === "succeeded") {
      if (!hasExactFields(record, ["accepted"]) || record["accepted"] !== true)
        throw new AdministrativeEventValidationError("invalid_details");
      return Object.freeze({ accepted: true as const });
    }
    return failureDetails(record);
  }
  if (operation === "prepare_machine_shutdown_occurrence") {
    if (status === "started") {
      assertAllowedKeys(record, ["scheduledFor", "wakeScheduledFor"]);
      const scheduledFor = requireTimestampField(record, "scheduledFor");
      const wakeScheduledFor = requireTimestampField(
        record,
        "wakeScheduledFor",
      );
      return Object.freeze({ scheduledFor, wakeScheduledFor });
    }
    const allowed = [
      "preparationOutcome",
      "blockerCodes",
      "completedStepCount",
      "failureCode",
    ];
    assertAllowedKeys(record, allowed);
    const preparationOutcome = optionalPreparationOutcome(record);
    const blockerCodes = optionalBlockerCodes(record);
    const completedStepCount = optionalCount(record);
    const failureCode = optionalFailureCode(record);
    if (status === "succeeded") {
      if (
        preparationOutcome !== "not_required" &&
        preparationOutcome !== "prepared"
      )
        throw new AdministrativeEventValidationError("invalid_details");
      if (failureCode !== undefined)
        throw new AdministrativeEventValidationError("invalid_details");
    } else if (status === "rejected") {
      if (
        preparationOutcome !== "blocked" &&
        preparationOutcome !== "incomplete"
      )
        throw new AdministrativeEventValidationError("invalid_details");
      if (failureCode !== undefined)
        throw new AdministrativeEventValidationError("invalid_details");
    } else if (status === "failed") {
      return failureDetails(record);
    } else {
      throw new AdministrativeEventValidationError("invalid_details");
    }
    return freezeDefined({
      preparationOutcome,
      blockerCodes,
      completedStepCount,
      failureCode,
    });
  }
  if (operation === "execute_machine_shutdown_occurrence") {
    if (status === "started") {
      assertAllowedKeys(record, ["scheduledFor", "wakeScheduledFor"]);
      const scheduledFor = requireTimestampField(record, "scheduledFor");
      const wakeScheduledFor = requireTimestampField(
        record,
        "wakeScheduledFor",
      );
      return Object.freeze({ scheduledFor, wakeScheduledFor });
    }
    assertAllowedKeys(record, [
      "executionOutcome",
      "preparationOutcome",
      "wakeMutationOutcome",
      "shutdownAccepted",
      "failureCode",
      "blockerCodes",
    ]);
    if (status === "failed") return failureDetails(record);
    const executionOutcome = requireExecutionOutcome(record);
    const preparationOutcome = optionalPreparationOutcome(record);
    const wakeMutationOutcome = optionalMutationOutcome(
      record,
      "wakeMutationOutcome",
      ["scheduled", "replaced", "unchanged"],
    );
    const shutdownAccepted = optionalAccepted(record);
    const failureCode = optionalFailureCode(record);
    const blockerCodes = optionalBlockerCodes(record);
    if (status === "succeeded") {
      if (
        executionOutcome !== "executed" ||
        (preparationOutcome !== undefined &&
          preparationOutcome !== "not_required" &&
          preparationOutcome !== "prepared") ||
        !wakeMutationOutcome ||
        shutdownAccepted !== true ||
        failureCode !== undefined
      )
        throw new AdministrativeEventValidationError("invalid_details");
    } else if (status === "rejected") {
      if (failureCode !== undefined || shutdownAccepted !== undefined)
        throw new AdministrativeEventValidationError("invalid_details");
      if (
        executionOutcome === "preparation_incomplete" &&
        (preparationOutcome !== "incomplete" ||
          wakeMutationOutcome !== undefined ||
          blockerCodes !== undefined)
      )
        throw new AdministrativeEventValidationError("invalid_details");
      if (
        executionOutcome === "rejected" &&
        (!blockerCodes ||
          blockerCodes.length === 0 ||
          preparationOutcome !== undefined ||
          wakeMutationOutcome !== undefined)
      )
        throw new AdministrativeEventValidationError("invalid_details");
      if (
        executionOutcome !== "preparation_incomplete" &&
        executionOutcome !== "rejected" &&
        (preparationOutcome !== undefined ||
          wakeMutationOutcome !== undefined ||
          blockerCodes !== undefined)
      )
        throw new AdministrativeEventValidationError("invalid_details");
    } else {
      throw new AdministrativeEventValidationError("invalid_details");
    }
    return freezeDefined({
      executionOutcome,
      preparationOutcome,
      wakeMutationOutcome,
      shutdownAccepted,
      failureCode,
      blockerCodes,
    });
  }
  if (status === "started") {
    assertAllowedKeys(record, ["tickedThrough"]);
    const tickedThrough = requireTimestampField(record, "tickedThrough");
    return Object.freeze({ tickedThrough });
  }
  assertAllowedKeys(record, [
    "schedulerOutcome",
    "completedThrough",
    "tickedThrough",
    "occurrenceCount",
    "complete",
    "failureCode",
  ]);
  if (status === "failed") return failureDetails(record);
  const schedulerOutcome = requireSchedulerOutcome(record);
  const completedThrough = optionalTimestamp(record, "completedThrough");
  const tickedThrough = optionalTimestamp(record, "tickedThrough");
  const occurrenceCount = optionalCount(record);
  const complete = optionalBoolean(record, "complete");
  const failureCode = optionalFailureCode(record);
  if (status === "succeeded") {
    if (
      schedulerOutcome !== "initialized" &&
      schedulerOutcome !== "idle" &&
      schedulerOutcome !== "advanced"
    )
      throw new AdministrativeEventValidationError("invalid_details");
    if (failureCode !== undefined)
      throw new AdministrativeEventValidationError("invalid_details");
  } else if (status === "rejected") {
    if (
      schedulerOutcome !== "blocked" &&
      schedulerOutcome !== "incomplete" &&
      schedulerOutcome !== "conflict"
    )
      throw new AdministrativeEventValidationError("invalid_details");
    if (failureCode !== undefined)
      throw new AdministrativeEventValidationError("invalid_details");
  } else {
    throw new AdministrativeEventValidationError("invalid_details");
  }
  return freezeDefined({
    schedulerOutcome,
    completedThrough,
    tickedThrough,
    occurrenceCount,
    complete,
    failureCode,
  });
}

function createEventHistoryOperationalDetails(
  record: Record<string, unknown>,
  status: AdministrativeEventStatus,
): AdministrativeEventDetails {
  if (status === "started") {
    assertAllowedKeys(record, ["fromSequence", "throughSequence"]);
    for (const field of ["fromSequence", "throughSequence"]) {
      if (Object.hasOwn(record, field) && !isBoundedCount(record[field]))
        throw new AdministrativeEventValidationError("invalid_details");
    }
    return Object.freeze({
      ...(Object.hasOwn(record, "fromSequence")
        ? { fromSequence: record["fromSequence"] }
        : {}),
      ...(Object.hasOwn(record, "throughSequence")
        ? { throughSequence: record["throughSequence"] }
        : {}),
    });
  }
  if (status === "failed" || status === "rejected") {
    return failureDetails(record);
  }
  if (status !== "succeeded")
    throw new AdministrativeEventValidationError("invalid_details");
  assertAllowedKeys(record, [
    "outcome",
    "firstSequence",
    "lastSequence",
    "processedSegmentCount",
    "processedExportCount",
    "exportId",
  ]);
  if (Object.hasOwn(record, "outcome") && typeof record["outcome"] !== "string")
    throw new AdministrativeEventValidationError("invalid_details");
  for (const field of [
    "firstSequence",
    "lastSequence",
    "processedSegmentCount",
    "processedExportCount",
  ]) {
    if (Object.hasOwn(record, field) && !isBoundedCount(record[field]))
      throw new AdministrativeEventValidationError("invalid_details");
  }
  if (
    Object.hasOwn(record, "exportId") &&
    (typeof record["exportId"] !== "string" ||
      !/^[0-9a-f]{64}$/u.test(record["exportId"]))
  )
    throw new AdministrativeEventValidationError("invalid_details");
  return Object.freeze({ ...record });
}

function isBoundedCount(value: unknown): boolean {
  return (
    Number.isSafeInteger(value) &&
    (value as number) >= 0 &&
    (value as number) <= 100_000
  );
}

function failureDetails(
  record: Record<string, unknown>,
): AdministrativeEventDetails {
  assertAllowedKeys(record, ["failureCode"]);
  const failureCode = requireFailureCode(record);
  return Object.freeze({ failureCode });
}

function requireRecord(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    throw new AdministrativeEventValidationError("invalid_record");
  const prototype = Object.getPrototypeOf(input) as unknown;
  if (prototype !== Object.prototype && prototype !== null)
    throw new AdministrativeEventValidationError("invalid_record");
  return input as Record<string, unknown>;
}

function assertFields(
  record: Record<string, unknown>,
  optional: readonly string[],
): void {
  const keys = ownKeys(record);
  if (
    keys.some((key) => !optional.includes(key)) ||
    keys.length < optional.filter((key) => key !== "details").length
  )
    throw new AdministrativeEventValidationError("invalid_field");
}

function assertAllowedKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
): void {
  if (ownKeys(record).some((key) => !allowed.includes(key)))
    throw new AdministrativeEventValidationError("invalid_details");
}

function hasExactFields(
  record: Record<string, unknown>,
  fields: readonly string[],
): boolean {
  const keys = ownKeys(record);
  return (
    keys.length === fields.length && keys.every((key) => fields.includes(key))
  );
}

function ownKeys(record: Record<string, unknown>): string[] {
  const keys = Reflect.ownKeys(record);
  if (keys.some((key) => typeof key !== "string"))
    throw new AdministrativeEventValidationError("invalid_field");
  return keys as string[];
}

function isAttemptId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
      value,
    )
  );
}
function isOperation(value: unknown): value is AdministrativeEventOperation {
  return (
    typeof value === "string" &&
    (ADMINISTRATIVE_EVENT_OPERATIONS as readonly string[]).includes(value)
  );
}
function isStatus(value: unknown): value is AdministrativeEventStatus {
  return (
    typeof value === "string" &&
    (ADMINISTRATIVE_EVENT_STATUSES as readonly string[]).includes(value)
  );
}
function requireTimestampField(
  record: Record<string, unknown>,
  field: string,
): string {
  const value = record[field];
  if (!isCanonicalTimestamp(value))
    throw new AdministrativeEventValidationError("invalid_details");
  return value;
}
function optionalTimestamp(
  record: Record<string, unknown>,
  field: string,
): string | undefined {
  if (!Object.hasOwn(record, field)) return undefined;
  return requireTimestampField(record, field);
}
function optionalCount(record: Record<string, unknown>): number | undefined {
  if (
    !Object.hasOwn(record, "completedStepCount") &&
    !Object.hasOwn(record, "occurrenceCount")
  )
    return undefined;
  const field = Object.hasOwn(record, "completedStepCount")
    ? "completedStepCount"
    : "occurrenceCount";
  const value = record[field];
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 0 ||
    (value as number) > 100000
  )
    throw new AdministrativeEventValidationError("invalid_details");
  return value as number;
}
function optionalBoolean(
  record: Record<string, unknown>,
  field: string,
): boolean | undefined {
  if (!Object.hasOwn(record, field)) return undefined;
  if (typeof record[field] !== "boolean")
    throw new AdministrativeEventValidationError("invalid_details");
  return record[field];
}
function optionalAccepted(record: Record<string, unknown>): true | undefined {
  if (!Object.hasOwn(record, "shutdownAccepted")) return undefined;
  if (record["shutdownAccepted"] !== true)
    throw new AdministrativeEventValidationError("invalid_details");
  return true;
}
function requireMutationOutcome(
  record: Record<string, unknown>,
  field: string,
  allowed: readonly AdministrativeEventMutationOutcome[],
): AdministrativeEventMutationOutcome {
  const value = record[field];
  if (
    typeof value !== "string" ||
    !allowed.includes(value as AdministrativeEventMutationOutcome)
  )
    throw new AdministrativeEventValidationError("invalid_details");
  return value as AdministrativeEventMutationOutcome;
}
function optionalMutationOutcome(
  record: Record<string, unknown>,
  field: string,
  allowed: readonly AdministrativeEventMutationOutcome[],
): AdministrativeEventMutationOutcome | undefined {
  if (!Object.hasOwn(record, field)) return undefined;
  return requireMutationOutcome(record, field, allowed);
}
function optionalPreparationOutcome(
  record: Record<string, unknown>,
): AdministrativeEventPreparationOutcome | undefined {
  if (!Object.hasOwn(record, "preparationOutcome")) return undefined;
  const value = record["preparationOutcome"];
  if (
    typeof value !== "string" ||
    !(ADMINISTRATIVE_EVENT_PREPARATION_OUTCOMES as readonly string[]).includes(
      value,
    )
  )
    throw new AdministrativeEventValidationError("invalid_details");
  return value as AdministrativeEventPreparationOutcome;
}
function requireExecutionOutcome(
  record: Record<string, unknown>,
): AdministrativeEventExecutionOutcome {
  const value = record["executionOutcome"];
  if (
    typeof value !== "string" ||
    !(ADMINISTRATIVE_EVENT_EXECUTION_OUTCOMES as readonly string[]).includes(
      value,
    )
  )
    throw new AdministrativeEventValidationError("invalid_details");
  return value as AdministrativeEventExecutionOutcome;
}
function requireSchedulerOutcome(
  record: Record<string, unknown>,
): AdministrativeEventSchedulerOutcome {
  const value = record["schedulerOutcome"];
  if (
    typeof value !== "string" ||
    !(ADMINISTRATIVE_EVENT_SCHEDULER_OUTCOMES as readonly string[]).includes(
      value,
    )
  )
    throw new AdministrativeEventValidationError("invalid_details");
  return value as AdministrativeEventSchedulerOutcome;
}
function optionalBlockerCodes(
  record: Record<string, unknown>,
): readonly string[] | undefined {
  if (!Object.hasOwn(record, "blockerCodes")) return undefined;
  const values = record["blockerCodes"];
  if (!Array.isArray(values))
    throw new AdministrativeEventValidationError("invalid_details");
  const codes = values.map((value) => {
    if (
      typeof value !== "string" ||
      !ADMINISTRATIVE_EVENT_BLOCKER_CODES.has(value)
    )
      throw new AdministrativeEventValidationError("invalid_details");
    return value;
  });
  return Object.freeze(codes);
}
function optionalFailureCode(
  record: Record<string, unknown>,
): AdministrativeEventFailureCode | undefined {
  if (!Object.hasOwn(record, "failureCode")) return undefined;
  return requireFailureCode(record);
}
function requireFailureCode(
  record: Record<string, unknown>,
): AdministrativeEventFailureCode {
  const value = record["failureCode"];
  if (typeof value !== "string" || !SAFE_FAILURE_CODES.has(value))
    throw new AdministrativeEventValidationError("invalid_failure_code");
  return value as AdministrativeEventFailureCode;
}
function freezeDefined(
  values: Record<string, unknown>,
): AdministrativeEventDetails {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values))
    if (value !== undefined) output[key] = value;
  return Object.freeze(output);
}

const SAFE_FAILURE_CODES = new Set<string>([
  "backup_operation_failed",
  "administrative_audit_failed",
  "audit_failed_after_event_history_operation",
  "audit_failed_after_wake_alarm_mutation",
  "audit_failed_after_shutdown_request",
  "audit_failed_after_shutdown_execution",
  "audit_failed_after_shutdown_preparation",
  "audit_failed_after_scheduler_tick",
  "claim_failed",
  "wake_alarm_preparation_failed",
  "shutdown_failed_after_wake_scheduled",
  "preparation_dependency_failed",
  "service_stop_failed",
  "backup_completion_failed",
  "filesystem_synchronization_failed",
  "event_recording_failed",
  "unexpected_execution_failure",
  "clock_regression",
  "interval_too_large",
  "cursor_conflict",
  "helper_unavailable",
  "helper_installation_invalid",
  "helper_timeout",
  "helper_output_invalid",
  "helper_operation_rejected",
  "helper_operation_failed",
  "helper_not_found",
  "helper_not_regular_file",
  "helper_symbolic_link_rejected",
  "helper_owner_invalid",
  "helper_not_executable",
  "helper_parent_invalid",
  "helper_inspection_failed",
  "helper_start_failed",
  "helper_io_failed",
  "helper_exit_failed",
  "helper_terminated",
  "helper_stdout_too_large",
  "helper_stderr_too_large",
  "helper_protocol_invalid",
  "unsupported_platform",
  "backup_completion_unknown",
  "filesystem_synchronization_unknown",
  "confirmation_unavailable",
  "event_recording_unavailable",
  "readiness_dependency_failed",
  "service_readiness_unavailable",
  "service_required_during_offline_interval",
  "service_failed",
  "service_state_unknown",
  "backup_state_unknown",
  "filesystem_state_unknown",
  "event_history_path_invalid",
  "event_history_parent_invalid",
  "event_history_file_invalid",
  "event_history_permissions_unsafe",
  "event_history_read_failed",
  "event_history_write_failed",
  "event_history_sync_failed",
  "event_history_corrupted",
  "event_history_capacity_exceeded",
  "administrative_event_recording_failed",
]);

const ADMINISTRATIVE_EVENT_BLOCKER_CODES = new Set<string>([
  "not_due",
  "stale",
  "not_confirmed",
  "confirmation_unavailable",
  "active_tasks_present",
  "backup_in_progress",
  "backup_state_unknown",
  "filesystem_sync_required",
  "filesystem_state_unknown",
  "event_recording_unavailable",
  "service_readiness_unavailable",
  "readiness_dependency_failed",
  "service_required_during_offline_interval",
  "service_running",
  "service_failed",
  "service_state_unknown",
]);
