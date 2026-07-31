import { describe, expect, it } from "vitest";

import {
  createMachineOperatingWindow,
  createMachineWeeklyOperatingSchedule,
  MachineWeeklyOperatingScheduleValidationError,
} from "../../../src/power-management/domain/machine-weekly-operating-schedule.js";

function window(dayOfWeek: string, start: string, end: string) {
  return { dayOfWeek, start, end };
}

function schedule(windows: readonly unknown[]) {
  return createMachineWeeklyOperatingSchedule({ windows });
}

function expectScheduleError(input: unknown, code: string): void {
  expect(() => createMachineWeeklyOperatingSchedule(input)).toThrowError(
    expect.objectContaining({
      name: "MachineWeeklyOperatingScheduleValidationError",
      code,
    }),
  );
}

describe("machine weekly operating schedule", () => {
  it("accepts all weekdays and returns canonical order", () => {
    const result = schedule([
      window("sunday", "08:00", "10:00"),
      window("monday", "18:00", "22:00"),
      window("monday", "08:00", "12:00"),
      window("friday", "00:00", "23:59"),
      window("tuesday", "09:00", "17:45"),
      window("thursday", "10:00", "11:00"),
      window("wednesday", "10:00", "11:00"),
      window("saturday", "12:00", "13:00"),
    ]);

    expect(result.windows.map((item) => item.dayOfWeek)).toEqual([
      "monday",
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
      "sunday",
    ]);
    expect(result.windows.slice(0, 2)).toEqual([
      window("monday", "08:00", "12:00"),
      window("monday", "18:00", "22:00"),
    ]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.windows)).toBe(true);
    expect(result.windows.every((item) => Object.isFrozen(item))).toBe(true);
  });

  it("accepts the minimum, maximum, and adjacent windows", () => {
    expect(schedule([window("monday", "08:00", "09:00")]).windows).toHaveLength(
      1,
    );
    expect(
      schedule(
        Array.from({ length: 64 }, (_, index) => {
          const weekdays = [
            "monday",
            "tuesday",
            "wednesday",
            "thursday",
            "friday",
            "saturday",
            "sunday",
          ];
          const day = weekdays[Math.floor(index / 10)];
          const slot = index % 10;
          return window(day!, `0${slot}:00`, `0${slot}:01`);
        }),
      ).windows,
    ).toHaveLength(64);
    expect(
      schedule([
        window("monday", "08:00", "12:00"),
        window("monday", "12:00", "18:00"),
      ]).windows,
    ).toHaveLength(2);
  });

  it.each([
    ["non-record", null, "invalid_record"],
    ["missing windows", {}, "invalid_field"],
    [
      "unknown schedule field",
      {
        windows: [window("monday", "08:00", "09:00")],
        timezone: "America/Sao_Paulo",
      },
      "invalid_field",
    ],
    ["non-array windows", { windows: {} }, "invalid_windows"],
    ["empty windows", { windows: [] }, "empty_windows"],
    [
      "65 windows",
      {
        windows: Array.from({ length: 65 }, () =>
          window("monday", "08:00", "09:00"),
        ),
      },
      "windows_limit_exceeded",
    ],
  ] as const)("rejects %s", (_label, input, code) => {
    expectScheduleError(input, code);
  });

  it.each([
    [
      "unknown weekday",
      window("Monday", "08:00", "09:00"),
      "invalid_day_of_week",
    ],
    ["malformed time", window("monday", "8:00", "09:00"), "invalid_local_time"],
    ["seconds", window("monday", "08:00:00", "09:00"), "invalid_local_time"],
    ["invalid hour", window("monday", "24:00", "23:59"), "invalid_local_time"],
    [
      "invalid minute",
      window("monday", "08:60", "09:00"),
      "invalid_local_time",
    ],
    [
      "surrounding whitespace",
      window("monday", " 08:00", "09:00"),
      "invalid_local_time",
    ],
    ["zero length", window("monday", "08:00", "08:00"), "zero_length_window"],
    ["reversed", window("monday", "18:00", "08:00"), "reversed_window"],
    ["overnight", window("monday", "23:00", "01:00"), "reversed_window"],
  ] as const)("validates %s", (_label, input, code) => {
    expect(() => createMachineOperatingWindow(input)).toThrowError(
      expect.objectContaining({ code }),
    );
  });

  it("rejects malformed windows, duplicates, overlaps, and unknown fields", () => {
    expectScheduleError(
      { windows: [{ dayOfWeek: "monday", start: "08:00" }] },
      "invalid_window",
    );
    expectScheduleError(
      {
        windows: [
          window("monday", "08:00", "09:00"),
          window("monday", "08:00", "09:00"),
        ],
      },
      "duplicate_window",
    );
    expectScheduleError(
      {
        windows: [
          window("monday", "08:00", "12:00"),
          window("monday", "11:00", "18:00"),
        ],
      },
      "overlapping_windows",
    );
    expect(() =>
      createMachineOperatingWindow({
        dayOfWeek: "monday",
        start: "08:00",
        end: "09:00",
        extra: true,
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid_window" }));
  });

  it("isolates caller input and freezes validation errors", () => {
    const windows = [window("monday", "08:00", "09:00")];
    const result = schedule(windows);
    windows[0]!.start = "10:00";

    expect(result.windows).toEqual([window("monday", "08:00", "09:00")]);
    expect(result.windows).not.toBe(windows);
    expect(
      Object.isFrozen(
        new MachineWeeklyOperatingScheduleValidationError("invalid_record"),
      ),
    ).toBe(true);
  });
});
