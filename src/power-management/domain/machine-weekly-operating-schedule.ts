export const MACHINE_OPERATING_WEEKDAYS = Object.freeze([
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const);

export type MachineOperatingWeekday =
  (typeof MACHINE_OPERATING_WEEKDAYS)[number];

export interface MachineOperatingWindowInput {
  readonly dayOfWeek: string;
  readonly start: string;
  readonly end: string;
}

export interface MachineOperatingWindow {
  readonly dayOfWeek: MachineOperatingWeekday;
  readonly start: string;
  readonly end: string;
}

export interface MachineWeeklyOperatingScheduleInput {
  readonly windows: readonly MachineOperatingWindowInput[];
}

export interface MachineWeeklyOperatingSchedule {
  readonly windows: readonly MachineOperatingWindow[];
}

export type MachineWeeklyOperatingScheduleValidationErrorCode =
  | "invalid_record"
  | "invalid_field"
  | "missing_windows"
  | "invalid_windows"
  | "empty_windows"
  | "windows_limit_exceeded"
  | "invalid_window"
  | "invalid_day_of_week"
  | "invalid_local_time"
  | "zero_length_window"
  | "reversed_window"
  | "duplicate_window"
  | "overlapping_windows";

export class MachineWeeklyOperatingScheduleValidationError extends Error {
  public override readonly name =
    "MachineWeeklyOperatingScheduleValidationError";

  public constructor(
    public readonly code: MachineWeeklyOperatingScheduleValidationErrorCode,
  ) {
    super(`Invalid machine weekly operating schedule: ${code}`);
    Object.freeze(this);
  }
}

const WINDOW_FIELDS = Object.freeze(["dayOfWeek", "start", "end"] as const);
const SCHEDULE_FIELDS = Object.freeze(["windows"] as const);
const MAXIMUM_WINDOWS = 64;
const LOCAL_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const weekdayOrder = new Map<MachineOperatingWeekday, number>(
  MACHINE_OPERATING_WEEKDAYS.map((weekday, index) => [weekday, index]),
);

export function createMachineWeeklyOperatingSchedule(
  input: unknown,
): MachineWeeklyOperatingSchedule {
  if (!isRecord(input)) {
    throw new MachineWeeklyOperatingScheduleValidationError("invalid_record");
  }

  if (!hasExactFields(input, SCHEDULE_FIELDS)) {
    throw new MachineWeeklyOperatingScheduleValidationError("invalid_field");
  }

  const windows = input["windows"];
  if (!Array.isArray(windows)) {
    throw new MachineWeeklyOperatingScheduleValidationError("invalid_windows");
  }
  if (windows.length === 0) {
    throw new MachineWeeklyOperatingScheduleValidationError("empty_windows");
  }
  if (windows.length > MAXIMUM_WINDOWS) {
    throw new MachineWeeklyOperatingScheduleValidationError(
      "windows_limit_exceeded",
    );
  }

  const canonicalWindows = windows
    .map((window) => createMachineOperatingWindow(window))
    .sort(compareWindows);

  rejectDuplicateWindows(canonicalWindows);
  rejectOverlappingWindows(canonicalWindows);

  return Object.freeze({
    windows: Object.freeze(canonicalWindows),
  });
}

export function createMachineOperatingWindow(
  input: unknown,
): MachineOperatingWindow {
  if (!isRecord(input) || !hasExactFields(input, WINDOW_FIELDS)) {
    throw new MachineWeeklyOperatingScheduleValidationError("invalid_window");
  }

  const dayOfWeek = input["dayOfWeek"];
  if (!isMachineOperatingWeekday(dayOfWeek)) {
    throw new MachineWeeklyOperatingScheduleValidationError(
      "invalid_day_of_week",
    );
  }

  const start = input["start"];
  const end = input["end"];
  if (!isLocalTime(start) || !isLocalTime(end)) {
    throw new MachineWeeklyOperatingScheduleValidationError(
      "invalid_local_time",
    );
  }
  if (start === end) {
    throw new MachineWeeklyOperatingScheduleValidationError(
      "zero_length_window",
    );
  }
  if (start > end) {
    throw new MachineWeeklyOperatingScheduleValidationError("reversed_window");
  }

  return Object.freeze({ dayOfWeek, start, end });
}

function isMachineOperatingWeekday(
  value: unknown,
): value is MachineOperatingWeekday {
  return (
    typeof value === "string" &&
    (MACHINE_OPERATING_WEEKDAYS as readonly string[]).includes(value)
  );
}

function isLocalTime(value: unknown): value is string {
  return typeof value === "string" && LOCAL_TIME_PATTERN.test(value);
}

function compareWindows(
  left: MachineOperatingWindow,
  right: MachineOperatingWindow,
): number {
  const dayDifference =
    getWeekdayOrder(left.dayOfWeek) - getWeekdayOrder(right.dayOfWeek);
  if (dayDifference !== 0) {
    return dayDifference;
  }

  const startDifference = compareValues(left.start, right.start);
  return startDifference !== 0
    ? startDifference
    : compareValues(left.end, right.end);
}

function rejectDuplicateWindows(
  windows: readonly MachineOperatingWindow[],
): void {
  for (let index = 1; index < windows.length; index += 1) {
    const previous = windows[index - 1];
    const current = windows[index];
    if (
      previous !== undefined &&
      current !== undefined &&
      previous.dayOfWeek === current.dayOfWeek &&
      previous.start === current.start &&
      previous.end === current.end
    ) {
      throw new MachineWeeklyOperatingScheduleValidationError(
        "duplicate_window",
      );
    }
  }
}

function rejectOverlappingWindows(
  windows: readonly MachineOperatingWindow[],
): void {
  for (let index = 1; index < windows.length; index += 1) {
    const previous = windows[index - 1];
    const current = windows[index];
    if (
      previous !== undefined &&
      current !== undefined &&
      previous.dayOfWeek === current.dayOfWeek &&
      current.start < previous.end
    ) {
      throw new MachineWeeklyOperatingScheduleValidationError(
        "overlapping_windows",
      );
    }
  }
}

function getWeekdayOrder(dayOfWeek: MachineOperatingWeekday): number {
  const order = weekdayOrder.get(dayOfWeek);
  if (order === undefined) {
    throw new MachineWeeklyOperatingScheduleValidationError(
      "invalid_day_of_week",
    );
  }
  return order;
}

function compareValues(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function hasExactFields(
  input: Record<PropertyKey, unknown>,
  expectedFields: readonly string[],
): boolean {
  const keys = Reflect.ownKeys(input);
  return (
    keys.length === expectedFields.length &&
    expectedFields.every((field) => Object.hasOwn(input, field)) &&
    keys.every((key) => typeof key === "string" && expectedFields.includes(key))
  );
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}
