import { describe, expect, it, vi } from "vitest";

import { ServiceScheduleValidationError } from "../../../src/service-scheduling/domain/service-schedule-validation-error.js";
import { SERVICE_SCHEDULE_WEEKDAYS } from "../../../src/service-scheduling/domain/service-schedule-weekday.js";
import {
  createWeeklyAvailabilitySchedule,
  type WeeklyAvailabilitySchedule,
} from "../../../src/service-scheduling/domain/weekly-availability-schedule.js";
import type { WeeklyAvailabilityWindowInput } from "../../../src/service-scheduling/domain/weekly-availability-window.js";

function createFromRuntimeValue(value: unknown): WeeklyAvailabilitySchedule {
  return createWeeklyAvailabilitySchedule(
    value as readonly WeeklyAvailabilityWindowInput[],
  );
}

function createBoundedWindows(count: number): WeeklyAvailabilityWindowInput[] {
  return Array.from({ length: count }, (_, index) => {
    const weekday = SERVICE_SCHEDULE_WEEKDAYS[index % 7];
    const slot = Math.floor(index / 7) * 2;
    const start = `00:${String(slot).padStart(2, "0")}`;
    const end = `00:${String(slot + 1).padStart(2, "0")}`;

    if (weekday === undefined) {
      throw new Error("Expected a canonical weekday");
    }

    return { weekday, start, end };
  });
}

describe("WeeklyAvailabilitySchedule", () => {
  it("creates a deeply frozen schedule with one window", () => {
    const schedule = createWeeklyAvailabilitySchedule([
      { weekday: "monday", start: "09:00", end: "12:00" },
    ]);

    expect(schedule).toEqual({
      windows: [{ weekday: "monday", start: "09:00", end: "12:00" }],
    });
    expect(Object.isFrozen(schedule)).toBe(true);
    expect(Object.isFrozen(schedule.windows)).toBe(true);
    expect(Object.isFrozen(schedule.windows[0])).toBe(true);
  });

  it("sorts copies by weekday, start, and end without mutating input", () => {
    const input: WeeklyAvailabilityWindowInput[] = [
      { weekday: "wednesday", start: "14:00", end: "18:00" },
      { weekday: "monday", start: "13:00", end: "17:00" },
      { weekday: "monday", start: "08:00", end: "12:00" },
    ];
    const originalOrder = [...input];
    const schedule = createWeeklyAvailabilitySchedule(input);

    expect(schedule.windows).toEqual([
      { weekday: "monday", start: "08:00", end: "12:00" },
      { weekday: "monday", start: "13:00", end: "17:00" },
      { weekday: "wednesday", start: "14:00", end: "18:00" },
    ]);
    expect(input).toEqual(originalOrder);
    expect(schedule.windows[0]).not.toBe(input[2]);
  });

  it("copies source arrays and objects before freezing the aggregate", () => {
    const sourceWindow = {
      weekday: "monday",
      start: "09:00",
      end: "12:00",
    };
    const source = [sourceWindow];
    const schedule = createWeeklyAvailabilitySchedule(source);

    sourceWindow.weekday = "friday";
    sourceWindow.start = "10:00";
    source.push({ weekday: "sunday", start: "10:00", end: "11:00" });

    expect(schedule.windows).toEqual([
      { weekday: "monday", start: "09:00", end: "12:00" },
    ]);
  });

  it("accepts exactly 64 valid windows", () => {
    const schedule = createWeeklyAvailabilitySchedule(createBoundedWindows(64));

    expect(schedule.windows).toHaveLength(64);
  });

  it("rejects empty, oversized, and non-array schedules distinctly", () => {
    expect(() => createWeeklyAvailabilitySchedule([])).toThrowError(
      expect.objectContaining({
        code: "empty_weekly_availability_schedule",
      }),
    );
    expect(() =>
      createWeeklyAvailabilitySchedule(createBoundedWindows(65)),
    ).toThrowError(
      expect.objectContaining({
        code: "weekly_availability_schedule_limit_exceeded",
      }),
    );
    expect(() => createFromRuntimeValue({})).toThrowError(
      expect.objectContaining({
        code: "invalid_weekly_availability_window",
      }),
    );
  });

  it("rejects the complete schedule when any entry is invalid", () => {
    const input: unknown[] = [
      { weekday: "monday", start: "09:00", end: "12:00" },
      { weekday: "tuesday", start: "invalid-secret", end: "14:00" },
    ];

    expect(() => createFromRuntimeValue(input)).toThrowError(
      expect.objectContaining({ code: "invalid_schedule_local_time" }),
    );
  });

  it.each([
    [
      { weekday: "monday", start: "09:00", end: "12:00" },
      { weekday: "monday", start: "11:00", end: "14:00" },
    ],
    [
      { weekday: "monday", start: "09:00", end: "17:00" },
      { weekday: "monday", start: "09:00", end: "12:00" },
    ],
    [
      { weekday: "monday", start: "09:00", end: "17:00" },
      { weekday: "monday", start: "12:00", end: "13:00" },
    ],
    [
      { weekday: "monday", start: "09:00", end: "12:00" },
      { weekday: "monday", start: "09:00", end: "12:00" },
    ],
    [
      { weekday: "monday", start: "11:00", end: "14:00" },
      { weekday: "monday", start: "09:00", end: "12:00" },
    ],
    [
      { weekday: "monday", start: "07:00", end: "08:00" },
      { weekday: "monday", start: "09:00", end: "12:00" },
      { weekday: "monday", start: "11:59", end: "14:00" },
    ],
  ])("rejects overlapping or duplicate windows", (...windows) => {
    expect(() => createWeeklyAvailabilitySchedule(windows)).toThrowError(
      expect.objectContaining({
        name: "ServiceScheduleValidationError",
        code: "overlapping_weekly_availability_windows",
        message:
          "Invalid service schedule: overlapping_weekly_availability_windows",
      }),
    );
  });

  it.each([
    [
      { weekday: "monday", start: "09:00", end: "12:00" },
      { weekday: "monday", start: "12:00", end: "17:00" },
    ],
    [
      { weekday: "monday", start: "09:00", end: "12:00" },
      { weekday: "monday", start: "12:01", end: "17:00" },
    ],
    [
      { weekday: "monday", start: "09:00", end: "12:00" },
      { weekday: "tuesday", start: "09:00", end: "12:00" },
    ],
  ])("accepts non-overlapping half-open windows", (...windows) => {
    expect(createWeeklyAvailabilitySchedule(windows).windows).toHaveLength(2);
  });

  it("does not expose schedule contents through overlap errors", () => {
    const rejectedValue = "09:17";

    try {
      createWeeklyAvailabilitySchedule([
        { weekday: "monday", start: "09:00", end: "10:00" },
        { weekday: "monday", start: rejectedValue, end: "11:00" },
      ]);
      throw new Error("Expected validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceScheduleValidationError);
      expect(String(error)).not.toContain(rejectedValue);
      expect(Object.values(error as object)).not.toContain(rejectedValue);
      expect(error).not.toHaveProperty("cause");
    }
  });

  it("imports without Date access, timers, or process listeners", async () => {
    vi.resetModules();
    const dateSpy = vi.spyOn(globalThis, "Date");
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const processOnSpy = vi.spyOn(process, "on");

    try {
      await import("../../../src/service-scheduling/domain/weekly-availability-schedule.js");

      expect(dateSpy).not.toHaveBeenCalled();
      expect(setTimeoutSpy).not.toHaveBeenCalled();
      expect(processOnSpy).not.toHaveBeenCalled();
    } finally {
      dateSpy.mockRestore();
      setTimeoutSpy.mockRestore();
      processOnSpy.mockRestore();
    }
  });
});
