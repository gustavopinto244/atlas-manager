import { isCanonicalTimestamp } from "../../power-management/domain/canonical-timestamp.js";

export interface AdministrativeEventHistoryQuery {
  readonly afterSequence: number;
  readonly limit: number;
  readonly source?: "administrative" | "automated" | "system";
  readonly operation?:
    | "authorize_administrative_operation"
    | "schedule_wake_alarm"
    | "cancel_wake_alarm"
    | "request_machine_shutdown"
    | "prepare_machine_shutdown_occurrence"
    | "execute_machine_shutdown_occurrence"
    | "run_machine_power_scheduler_tick";
  readonly status?: "started" | "succeeded" | "rejected" | "failed";
  readonly attemptId?: string;
  readonly occurredFrom?: string;
  readonly occurredTo?: string;
}

export type AdministrativeEventHistoryQueryErrorCode =
  | "invalid_record"
  | "invalid_field"
  | "invalid_after_sequence"
  | "invalid_limit"
  | "invalid_source"
  | "invalid_operation"
  | "invalid_status"
  | "invalid_attempt_id"
  | "invalid_occurred_from"
  | "invalid_occurred_to"
  | "invalid_time_interval";

export class AdministrativeEventHistoryQueryError extends Error {
  public override readonly name = "AdministrativeEventHistoryQueryError";
  public constructor(
    public readonly code: AdministrativeEventHistoryQueryErrorCode,
  ) {
    super(`Invalid administrative event-history query: ${code}`);
    Object.freeze(this);
  }
}

export function createAdministrativeEventHistoryQuery(
  input: unknown = {},
): AdministrativeEventHistoryQuery {
  if (!isRecord(input))
    throw new AdministrativeEventHistoryQueryError("invalid_record");
  const record = input;
  const allowed = [
    "afterSequence",
    "limit",
    "source",
    "operation",
    "status",
    "attemptId",
    "occurredFrom",
    "occurredTo",
  ];
  if (
    Reflect.ownKeys(record).some(
      (key) => typeof key !== "string" || !allowed.includes(key),
    )
  )
    throw new AdministrativeEventHistoryQueryError("invalid_field");
  const afterSequence = record["afterSequence"] ?? 0;
  const limit = record["limit"] ?? 50;
  if (!Number.isSafeInteger(afterSequence) || (afterSequence as number) < 0)
    throw new AdministrativeEventHistoryQueryError("invalid_after_sequence");
  if (
    !Number.isSafeInteger(limit) ||
    (limit as number) < 1 ||
    (limit as number) > 100
  )
    throw new AdministrativeEventHistoryQueryError("invalid_limit");
  const source = record["source"];
  if (
    source !== undefined &&
    source !== "administrative" &&
    source !== "automated" &&
    source !== "system"
  )
    throw new AdministrativeEventHistoryQueryError("invalid_source");
  const operations = [
    "authorize_administrative_operation",
    "schedule_wake_alarm",
    "cancel_wake_alarm",
    "request_machine_shutdown",
    "prepare_machine_shutdown_occurrence",
    "execute_machine_shutdown_occurrence",
    "run_machine_power_scheduler_tick",
  ];
  const operation = record["operation"];
  if (operation !== undefined && !operations.includes(operation as string))
    throw new AdministrativeEventHistoryQueryError("invalid_operation");
  const status = record["status"];
  if (
    status !== undefined &&
    status !== "started" &&
    status !== "succeeded" &&
    status !== "rejected" &&
    status !== "failed"
  )
    throw new AdministrativeEventHistoryQueryError("invalid_status");
  if (record["attemptId"] !== undefined && !isAttemptId(record["attemptId"]))
    throw new AdministrativeEventHistoryQueryError("invalid_attempt_id");
  if (
    record["occurredFrom"] !== undefined &&
    !isCanonicalTimestamp(record["occurredFrom"])
  )
    throw new AdministrativeEventHistoryQueryError("invalid_occurred_from");
  if (
    record["occurredTo"] !== undefined &&
    !isCanonicalTimestamp(record["occurredTo"])
  )
    throw new AdministrativeEventHistoryQueryError("invalid_occurred_to");
  if (
    record["occurredFrom"] !== undefined &&
    record["occurredTo"] !== undefined &&
    typeof record["occurredFrom"] === "string" &&
    typeof record["occurredTo"] === "string" &&
    record["occurredFrom"] >= record["occurredTo"]
  )
    throw new AdministrativeEventHistoryQueryError("invalid_time_interval");
  return Object.freeze({
    afterSequence: afterSequence as number,
    limit: limit as number,
    ...(source !== undefined ? { source } : {}),
    ...(operation !== undefined ? { operation } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(record["attemptId"] !== undefined
      ? { attemptId: record["attemptId"] }
      : {}),
    ...(record["occurredFrom"] !== undefined
      ? { occurredFrom: record["occurredFrom"] }
      : {}),
    ...(record["occurredTo"] !== undefined
      ? { occurredTo: record["occurredTo"] }
      : {}),
  }) as AdministrativeEventHistoryQuery;
}

function isAttemptId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
      value,
    )
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}
