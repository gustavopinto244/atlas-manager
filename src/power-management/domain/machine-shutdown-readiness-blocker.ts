import { isCanonicalTimestamp } from "./canonical-timestamp.js";

export const MACHINE_SHUTDOWN_BLOCKER_CODES = Object.freeze([
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
] as const);
export type MachineShutdownBlockerCode =
  (typeof MACHINE_SHUTDOWN_BLOCKER_CODES)[number];
export type MachineShutdownBlockerArea =
  | "confirmation"
  | "services"
  | "active_tasks"
  | "backups"
  | "filesystem"
  | "event_recording";
export interface MachineShutdownReadinessBlocker {
  readonly area: MachineShutdownBlockerArea;
  readonly code: MachineShutdownBlockerCode;
  readonly serviceId?: string;
  readonly firstRequiredAt?: string;
  readonly activeTaskCount?: number;
}
export class MachineShutdownReadinessBlockerValidationError extends Error {
  public override readonly name =
    "MachineShutdownReadinessBlockerValidationError";
  public constructor(
    public readonly code:
      | "invalid_record"
      | "invalid_field"
      | "invalid_area"
      | "invalid_code"
      | "invalid_service_id"
      | "invalid_timestamp"
      | "invalid_task_count"
      | "invalid_detail",
  ) {
    super(`Invalid machine shutdown readiness blocker: ${code}`);
    Object.freeze(this);
  }
}
const AREAS = [
  "confirmation",
  "services",
  "active_tasks",
  "backups",
  "filesystem",
  "event_recording",
] as const;
export function createMachineShutdownReadinessBlocker(
  input: unknown,
): MachineShutdownReadinessBlocker {
  if (!isRecord(input))
    throw new MachineShutdownReadinessBlockerValidationError("invalid_record");
  const keys = Reflect.ownKeys(input);
  if (
    keys.some(
      (key) =>
        typeof key !== "string" ||
        ![
          "area",
          "code",
          "serviceId",
          "firstRequiredAt",
          "activeTaskCount",
        ].includes(key),
    )
  )
    throw new MachineShutdownReadinessBlockerValidationError("invalid_field");
  if (!AREAS.includes(input["area"] as (typeof AREAS)[number]))
    throw new MachineShutdownReadinessBlockerValidationError("invalid_area");
  if (
    !MACHINE_SHUTDOWN_BLOCKER_CODES.includes(
      input["code"] as MachineShutdownBlockerCode,
    )
  )
    throw new MachineShutdownReadinessBlockerValidationError("invalid_code");
  if (Object.hasOwn(input, "serviceId") && !isServiceId(input["serviceId"]))
    throw new MachineShutdownReadinessBlockerValidationError(
      "invalid_service_id",
    );
  if (
    Object.hasOwn(input, "firstRequiredAt") &&
    !isCanonicalTimestamp(input["firstRequiredAt"])
  )
    throw new MachineShutdownReadinessBlockerValidationError(
      "invalid_timestamp",
    );
  if (
    Object.hasOwn(input, "activeTaskCount") &&
    (!Number.isInteger(input["activeTaskCount"]) ||
      (input["activeTaskCount"] as number) < 1 ||
      (input["activeTaskCount"] as number) > 10000)
  )
    throw new MachineShutdownReadinessBlockerValidationError(
      "invalid_task_count",
    );
  return Object.freeze(input as unknown as MachineShutdownReadinessBlocker);
}
export function sortMachineShutdownReadinessBlockers(
  blockers: readonly MachineShutdownReadinessBlocker[],
): readonly MachineShutdownReadinessBlocker[] {
  const areaOrder = new Map<MachineShutdownBlockerArea, number>(
    AREAS.map((area, index) => [area, index]),
  );
  return Object.freeze(
    [...blockers].sort(
      (left, right) =>
        areaOrder.get(left.area)! - areaOrder.get(right.area)! ||
        (left.serviceId ?? "").localeCompare(right.serviceId ?? "") ||
        left.code.localeCompare(right.code) ||
        (left.firstRequiredAt ?? "").localeCompare(right.firstRequiredAt ?? ""),
    ),
  );
}
function isServiceId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value);
}
function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}
