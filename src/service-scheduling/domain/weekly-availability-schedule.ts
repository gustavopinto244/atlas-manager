import { ServiceScheduleValidationError } from "./service-schedule-validation-error.js";
import {
  SERVICE_SCHEDULE_WEEKDAYS,
  type ServiceScheduleWeekday,
} from "./service-schedule-weekday.js";
import {
  createWeeklyAvailabilityWindow,
  type WeeklyAvailabilityWindow,
  type WeeklyAvailabilityWindowInput,
} from "./weekly-availability-window.js";

export interface WeeklyAvailabilitySchedule {
  readonly windows: readonly WeeklyAvailabilityWindow[];
}

const MAXIMUM_WEEKLY_WINDOWS = 64;
const weekdayOrder = new Map<ServiceScheduleWeekday, number>(
  SERVICE_SCHEDULE_WEEKDAYS.map((weekday, index) => [weekday, index]),
);

export function createWeeklyAvailabilitySchedule(
  windows: readonly WeeklyAvailabilityWindowInput[],
): WeeklyAvailabilitySchedule {
  if (!isRuntimeArray(windows)) {
    throw new ServiceScheduleValidationError(
      "invalid_weekly_availability_window",
    );
  }

  if (windows.length === 0) {
    throw new ServiceScheduleValidationError(
      "empty_weekly_availability_schedule",
    );
  }

  if (windows.length > MAXIMUM_WEEKLY_WINDOWS) {
    throw new ServiceScheduleValidationError(
      "weekly_availability_schedule_limit_exceeded",
    );
  }

  const canonicalWindows = windows
    .map((window) => createWeeklyAvailabilityWindow(window))
    .sort(compareWindows);

  rejectOverlappingWindows(canonicalWindows);

  return Object.freeze({
    windows: Object.freeze(canonicalWindows),
  });
}

function isRuntimeArray(value: unknown): boolean {
  return Array.isArray(value);
}

function compareWindows(
  left: WeeklyAvailabilityWindow,
  right: WeeklyAvailabilityWindow,
): number {
  const weekdayDifference =
    getWeekdayOrder(left.weekday) - getWeekdayOrder(right.weekday);

  if (weekdayDifference !== 0) {
    return weekdayDifference;
  }

  const startDifference = compareCanonicalValues(left.start, right.start);

  if (startDifference !== 0) {
    return startDifference;
  }

  return compareCanonicalValues(left.end, right.end);
}

function compareCanonicalValues(left: string, right: string): number {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}

function getWeekdayOrder(weekday: ServiceScheduleWeekday): number {
  const order = weekdayOrder.get(weekday);

  if (order === undefined) {
    throw new ServiceScheduleValidationError("invalid_schedule_weekday");
  }

  return order;
}

function rejectOverlappingWindows(
  windows: readonly WeeklyAvailabilityWindow[],
): void {
  for (let index = 1; index < windows.length; index += 1) {
    const previous = windows[index - 1];
    const current = windows[index];

    if (
      previous !== undefined &&
      current !== undefined &&
      previous.weekday === current.weekday &&
      current.start < previous.end
    ) {
      throw new ServiceScheduleValidationError(
        "overlapping_weekly_availability_windows",
      );
    }
  }
}
