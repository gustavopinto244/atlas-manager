import { isCanonicalTimestamp } from "./canonical-timestamp.js";
import {
  createWakeAlarmMutationResult,
  type WakeAlarmMutationOutcome,
} from "./wake-alarm-mutation-result.js";
import {
  createWakeAlarmState,
  type WakeAlarmState,
} from "./wake-alarm-state.js";

export const LinuxPowerHelperProtocolVersion = 1 as const;
export const LINUX_POWER_HELPER_PROTOCOL_VERSION =
  LinuxPowerHelperProtocolVersion;
export const LINUX_POWER_HELPER_OPERATIONS = Object.freeze([
  "read_rtc_information",
  "read_wake_alarm",
  "schedule_wake_alarm",
  "cancel_wake_alarm",
  "request_shutdown",
] as const);

export const LINUX_POWER_HELPER_FAILURE_CODES = Object.freeze([
  "operation_unsupported",
  "operation_rejected",
  "operation_failed",
  "state_unavailable",
] as const);

export type LinuxPowerHelperOperation =
  (typeof LINUX_POWER_HELPER_OPERATIONS)[number];
export type LinuxPowerHelperFailureCode =
  (typeof LINUX_POWER_HELPER_FAILURE_CODES)[number];

export type LinuxPowerHelperRequest =
  | Readonly<{
      version: 1;
      operation: "read_rtc_information";
      requestedAt: string;
    }>
  | Readonly<{
      version: 1;
      operation: "read_wake_alarm";
      requestedAt: string;
    }>
  | Readonly<{
      version: 1;
      operation: "schedule_wake_alarm";
      requestedAt: string;
      scheduledFor: string;
    }>
  | Readonly<{
      version: 1;
      operation: "cancel_wake_alarm";
      requestedAt: string;
    }>
  | Readonly<{
      version: 1;
      operation: "request_shutdown";
      requestedAt: string;
    }>;

export type LinuxPowerHelperResponse =
  LinuxPowerHelperSuccessResponse | LinuxPowerHelperFailureResponse;

export type LinuxPowerHelperSuccessResponse =
  | Readonly<{
      version: 1;
      operation: "read_rtc_information";
      outcome: "success";
      result: Readonly<{
        rtcTime: string;
        wakeAlarm: WakeAlarmState;
      }>;
    }>
  | Readonly<{
      version: 1;
      operation: "read_wake_alarm";
      outcome: "success";
      result: WakeAlarmState;
    }>
  | Readonly<{
      version: 1;
      operation: "schedule_wake_alarm";
      outcome: "success";
      result: LinuxPowerHelperMutationResponseResult;
    }>
  | Readonly<{
      version: 1;
      operation: "cancel_wake_alarm";
      outcome: "success";
      result: LinuxPowerHelperMutationResponseResult;
    }>
  | Readonly<{
      version: 1;
      operation: "request_shutdown";
      outcome: "success";
      result: Readonly<{ accepted: true }>;
    }>;

export interface LinuxPowerHelperMutationResponseResult {
  readonly before: WakeAlarmState;
  readonly after: WakeAlarmState;
  readonly outcome: WakeAlarmMutationOutcome;
}

export type LinuxPowerHelperFailureResponse = Readonly<{
  version: 1;
  operation: LinuxPowerHelperOperation;
  outcome: "rejected" | "failed";
  code: LinuxPowerHelperFailureCode;
}>;

export type LinuxPowerHelperProtocolErrorCode =
  | "invalid_record"
  | "invalid_field"
  | "invalid_version"
  | "unsupported_version"
  | "invalid_operation"
  | "invalid_requested_at"
  | "invalid_scheduled_for"
  | "invalid_schedule_range"
  | "invalid_outcome"
  | "invalid_code"
  | "operation_mismatch"
  | "invalid_result"
  | "invalid_result_field"
  | "invalid_result_state"
  | "invalid_result_transition"
  | "invalid_response"
  | "invalid_utf8"
  | "multiple_response_lines"
  | "empty_response"
  | "trailing_response_data"
  | "request_too_large";

export class LinuxPowerHelperProtocolError extends Error {
  public override readonly name = "LinuxPowerHelperProtocolError";

  public constructor(public readonly code: LinuxPowerHelperProtocolErrorCode) {
    super(`Invalid Linux power-helper protocol data: ${code}`);
    Object.freeze(this);
  }
}

export function createLinuxPowerHelperRequest(
  input: unknown,
): LinuxPowerHelperRequest {
  if (!isRecord(input)) {
    throw new LinuxPowerHelperProtocolError("invalid_record");
  }

  const version = input["version"];
  if (typeof version !== "number" || !Number.isInteger(version)) {
    throw new LinuxPowerHelperProtocolError("invalid_version");
  }
  if (version !== LINUX_POWER_HELPER_PROTOCOL_VERSION) {
    throw new LinuxPowerHelperProtocolError("unsupported_version");
  }

  const operation = input["operation"];
  if (!isLinuxPowerHelperOperation(operation)) {
    throw new LinuxPowerHelperProtocolError("invalid_operation");
  }

  const requestedAt = input["requestedAt"];
  if (!isCanonicalTimestamp(requestedAt)) {
    throw new LinuxPowerHelperProtocolError("invalid_requested_at");
  }

  if (operation === "schedule_wake_alarm") {
    if (
      !hasExactFields(input, [
        "version",
        "operation",
        "requestedAt",
        "scheduledFor",
      ])
    ) {
      throw new LinuxPowerHelperProtocolError("invalid_field");
    }
    const scheduledFor = input["scheduledFor"];
    if (!isCanonicalTimestamp(scheduledFor)) {
      throw new LinuxPowerHelperProtocolError("invalid_scheduled_for");
    }
    if (scheduledFor <= requestedAt) {
      throw new LinuxPowerHelperProtocolError("invalid_schedule_range");
    }
    return Object.freeze({
      version: 1,
      operation,
      requestedAt,
      scheduledFor,
    });
  }

  if (!hasExactFields(input, ["version", "operation", "requestedAt"])) {
    throw new LinuxPowerHelperProtocolError("invalid_field");
  }

  return Object.freeze({ version: 1, operation, requestedAt });
}

export function createReadRtcInformationRequest(
  requestedAt: string,
): LinuxPowerHelperRequest {
  return createLinuxPowerHelperRequest({
    version: 1,
    operation: "read_rtc_information",
    requestedAt,
  });
}

export function createReadWakeAlarmRequest(
  requestedAt: string,
): LinuxPowerHelperRequest {
  return createLinuxPowerHelperRequest({
    version: 1,
    operation: "read_wake_alarm",
    requestedAt,
  });
}

export function createScheduleWakeAlarmRequest(
  requestedAt: string,
  scheduledFor: string,
): LinuxPowerHelperRequest {
  return createLinuxPowerHelperRequest({
    version: 1,
    operation: "schedule_wake_alarm",
    requestedAt,
    scheduledFor,
  });
}

export function createCancelWakeAlarmRequest(
  requestedAt: string,
): LinuxPowerHelperRequest {
  return createLinuxPowerHelperRequest({
    version: 1,
    operation: "cancel_wake_alarm",
    requestedAt,
  });
}

export function createRequestShutdownRequest(
  requestedAt: string,
): LinuxPowerHelperRequest {
  return createLinuxPowerHelperRequest({
    version: 1,
    operation: "request_shutdown",
    requestedAt,
  });
}

export function serializeLinuxPowerHelperRequest(
  input: LinuxPowerHelperRequest,
): string {
  const request = createLinuxPowerHelperRequest(input);
  const json = JSON.stringify(request);
  const serialized = `${json}\n`;
  if (Buffer.byteLength(serialized, "utf8") > 4096) {
    throw new LinuxPowerHelperProtocolError("request_too_large");
  }
  return serialized;
}

export function createLinuxPowerHelperResponse(
  input: unknown,
  expectedOperationOrRequest?:
    LinuxPowerHelperOperation | LinuxPowerHelperRequest,
): LinuxPowerHelperResponse {
  if (!isRecord(input)) {
    throw new LinuxPowerHelperProtocolError("invalid_record");
  }
  const fields = Object.keys(input);
  if (
    fields.some(
      (field) =>
        field !== "version" &&
        field !== "operation" &&
        field !== "outcome" &&
        field !== "result" &&
        field !== "code",
    )
  ) {
    throw new LinuxPowerHelperProtocolError("invalid_field");
  }

  const version = input["version"];
  if (version !== 1) {
    throw new LinuxPowerHelperProtocolError(
      typeof version === "number" && Number.isInteger(version)
        ? "unsupported_version"
        : "invalid_version",
    );
  }
  const operation = input["operation"];
  if (!isLinuxPowerHelperOperation(operation)) {
    throw new LinuxPowerHelperProtocolError("invalid_operation");
  }
  const expectedOperation =
    typeof expectedOperationOrRequest === "string"
      ? expectedOperationOrRequest
      : expectedOperationOrRequest?.operation;
  if (expectedOperation !== undefined && operation !== expectedOperation) {
    throw new LinuxPowerHelperProtocolError("operation_mismatch");
  }

  const outcome = input["outcome"];
  if (outcome !== "success" && outcome !== "rejected" && outcome !== "failed") {
    throw new LinuxPowerHelperProtocolError("invalid_outcome");
  }

  if (outcome === "success") {
    if (
      fields.length !== 4 ||
      !Object.hasOwn(input, "result") ||
      Object.hasOwn(input, "code")
    ) {
      throw new LinuxPowerHelperProtocolError("invalid_field");
    }
    return createSuccessResponse(
      operation,
      input["result"],
      expectedOperationOrRequest,
    );
  }

  if (
    fields.length !== 4 ||
    !Object.hasOwn(input, "code") ||
    Object.hasOwn(input, "result")
  ) {
    throw new LinuxPowerHelperProtocolError("invalid_field");
  }
  const code = input["code"];
  if (!isLinuxPowerHelperFailureCode(code)) {
    throw new LinuxPowerHelperProtocolError("invalid_code");
  }
  return Object.freeze({ version: 1, operation, outcome, code });
}

export function parseLinuxPowerHelperResponse(
  serialized: Buffer | string,
  expectedOperation: LinuxPowerHelperOperation | LinuxPowerHelperRequest,
): LinuxPowerHelperResponse {
  let text: string;
  try {
    text =
      typeof serialized === "string"
        ? serialized
        : new TextDecoder("utf-8", { fatal: true }).decode(serialized);
  } catch {
    throw new LinuxPowerHelperProtocolError("invalid_utf8");
  }
  if (text.length === 0 || text.trim().length === 0) {
    throw new LinuxPowerHelperProtocolError("empty_response");
  }
  if (text.includes("\r") || text.split("\n").length > 2) {
    throw new LinuxPowerHelperProtocolError("multiple_response_lines");
  }
  if (text.endsWith("\n") && text.slice(0, -1).includes("\n")) {
    throw new LinuxPowerHelperProtocolError("multiple_response_lines");
  }
  const trimmed = text.trim();
  if (trimmed !== text && !text.endsWith("\n")) {
    throw new LinuxPowerHelperProtocolError("trailing_response_data");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    throw new LinuxPowerHelperProtocolError("invalid_response");
  }
  return createLinuxPowerHelperResponse(parsed, expectedOperation);
}

function createSuccessResponse(
  operation: LinuxPowerHelperOperation,
  result: unknown,
  expectedOperationOrRequest?:
    LinuxPowerHelperOperation | LinuxPowerHelperRequest,
): LinuxPowerHelperSuccessResponse {
  if (operation === "read_rtc_information") {
    if (
      !isRecord(result) ||
      !hasExactFields(result, ["rtcTime", "wakeAlarm"])
    ) {
      throw new LinuxPowerHelperProtocolError("invalid_result_field");
    }
    if (!isCanonicalTimestamp(result["rtcTime"])) {
      throw new LinuxPowerHelperProtocolError("invalid_result");
    }
    let wakeAlarm: WakeAlarmState;
    try {
      wakeAlarm = createWakeAlarmState(result["wakeAlarm"]);
    } catch {
      throw new LinuxPowerHelperProtocolError("invalid_result_state");
    }
    return Object.freeze({
      version: 1,
      operation,
      outcome: "success",
      result: Object.freeze({
        rtcTime: result["rtcTime"],
        wakeAlarm,
      }),
    });
  }

  if (operation === "read_wake_alarm") {
    let wakeAlarm: WakeAlarmState;
    try {
      wakeAlarm = createWakeAlarmState(result);
    } catch {
      throw new LinuxPowerHelperProtocolError("invalid_result_state");
    }
    return Object.freeze({
      version: 1,
      operation,
      outcome: "success",
      result: wakeAlarm,
    });
  }

  if (operation === "request_shutdown") {
    if (
      !isRecord(result) ||
      !hasExactFields(result, ["accepted"]) ||
      result["accepted"] !== true
    ) {
      throw new LinuxPowerHelperProtocolError("invalid_result");
    }
    return Object.freeze({
      version: 1,
      operation,
      outcome: "success",
      result: Object.freeze({ accepted: true as const }),
    });
  }

  if (
    !isRecord(result) ||
    !hasExactFields(result, ["before", "after", "outcome"])
  ) {
    throw new LinuxPowerHelperProtocolError("invalid_result_field");
  }
  let before: WakeAlarmState;
  let after: WakeAlarmState;
  try {
    before = createWakeAlarmState(result["before"]);
    after = createWakeAlarmState(result["after"]);
  } catch {
    throw new LinuxPowerHelperProtocolError("invalid_result_state");
  }
  const outcome = result["outcome"];
  if (
    outcome !== "scheduled" &&
    outcome !== "replaced" &&
    outcome !== "unchanged" &&
    outcome !== "cancelled" &&
    outcome !== "not_scheduled"
  ) {
    throw new LinuxPowerHelperProtocolError("invalid_result");
  }

  try {
    createWakeAlarmMutationResult({
      operation: operation === "schedule_wake_alarm" ? "schedule" : "cancel",
      requestedAt: "1970-01-01T00:00:00.000Z",
      outcome,
      before,
      after,
    });
  } catch {
    throw new LinuxPowerHelperProtocolError("invalid_result_transition");
  }

  if (
    operation === "schedule_wake_alarm" &&
    typeof expectedOperationOrRequest !== "string" &&
    expectedOperationOrRequest?.operation === "schedule_wake_alarm" &&
    (after.state !== "scheduled" ||
      after.scheduledFor !== expectedOperationOrRequest.scheduledFor)
  ) {
    throw new LinuxPowerHelperProtocolError("invalid_result_transition");
  }

  return Object.freeze({
    version: 1,
    operation,
    outcome: "success",
    result: Object.freeze({ before, after, outcome }),
  });
}

function isLinuxPowerHelperOperation(
  value: unknown,
): value is LinuxPowerHelperOperation {
  return (
    typeof value === "string" &&
    (LINUX_POWER_HELPER_OPERATIONS as readonly string[]).includes(value)
  );
}

function isLinuxPowerHelperFailureCode(
  value: unknown,
): value is LinuxPowerHelperFailureCode {
  return (
    typeof value === "string" &&
    (LINUX_POWER_HELPER_FAILURE_CODES as readonly string[]).includes(value)
  );
}

function hasExactFields(
  input: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const fields = Object.keys(input);
  return (
    fields.length === expected.length &&
    fields.every((field) => expected.includes(field))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}
