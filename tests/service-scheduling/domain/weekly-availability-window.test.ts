import { describe, expect, it } from "vitest";

import { ServiceScheduleValidationError } from "../../../src/service-scheduling/domain/service-schedule-validation-error.js";
import {
  createWeeklyAvailabilityWindow,
  type WeeklyAvailabilityWindowInput,
} from "../../../src/service-scheduling/domain/weekly-availability-window.js";

const validInput: WeeklyAvailabilityWindowInput = {
  weekday: "monday",
  start: "09:00",
  end: "12:00",
};

function createFromRuntimeValue(value: unknown): void {
  createWeeklyAvailabilityWindow(value as WeeklyAvailabilityWindowInput);
}

describe("WeeklyAvailabilityWindow", () => {
  it("creates a frozen copy with canonical half-open boundaries", () => {
    const input = { ...validInput };
    const window = createWeeklyAvailabilityWindow(input);

    expect(window).toEqual(validInput);
    expect(window).not.toBe(input);
    expect(Object.isFrozen(window)).toBe(true);
    expect(input).toEqual(validInput);
  });

  it.each([undefined, null, true, 1, "monday", [], [validInput]])(
    "rejects the non-object window input %j",
    (value) => {
      expect(() => createFromRuntimeValue(value)).toThrowError(
        expect.objectContaining({
          code: "invalid_weekly_availability_window",
        }),
      );
    },
  );

  it.each(["weekday", "start", "end"] as const)(
    "rejects a window missing its own %s field",
    (field) => {
      const input = { ...validInput };
      Reflect.deleteProperty(input, field);

      expect(() => createFromRuntimeValue(input)).toThrowError(
        expect.objectContaining({
          code: "invalid_weekly_availability_window",
        }),
      );
    },
  );

  it("rejects unknown string and symbol fields", () => {
    expect(() =>
      createFromRuntimeValue({ ...validInput, timezone: "UTC" }),
    ).toThrowError(
      expect.objectContaining({
        code: "invalid_weekly_availability_window",
      }),
    );

    expect(() =>
      createFromRuntimeValue({ ...validInput, [Symbol("unknown")]: true }),
    ).toThrowError(
      expect.objectContaining({
        code: "invalid_weekly_availability_window",
      }),
    );
  });

  it("rejects inherited fields as substitutes for own fields", () => {
    const inheritedInput = Object.create(validInput) as object;

    expect(() => createFromRuntimeValue(inheritedInput)).toThrowError(
      expect.objectContaining({
        code: "invalid_weekly_availability_window",
      }),
    );
  });

  it.each([
    { ...validInput, weekday: 1 },
    { ...validInput, start: 900 },
    { ...validInput, end: null },
  ])("rejects the non-string field in %j", (input) => {
    expect(() => createFromRuntimeValue(input)).toThrow(
      ServiceScheduleValidationError,
    );
  });

  it("propagates safe weekday and local-time errors unchanged", () => {
    expect(() =>
      createWeeklyAvailabilityWindow({
        ...validInput,
        weekday: "Monday",
      }),
    ).toThrowError(
      expect.objectContaining({ code: "invalid_schedule_weekday" }),
    );

    expect(() =>
      createWeeklyAvailabilityWindow({ ...validInput, start: "9:00" }),
    ).toThrowError(
      expect.objectContaining({ code: "invalid_schedule_local_time" }),
    );

    expect(() =>
      createWeeklyAvailabilityWindow({ ...validInput, end: "24:00" }),
    ).toThrowError(
      expect.objectContaining({ code: "invalid_schedule_local_time" }),
    );
  });

  it.each([
    ["09:00", "09:00"],
    ["12:00", "09:00"],
    ["22:00", "02:00"],
    ["23:30", "00:30"],
  ])("rejects the invalid interval %s to %s", (start, end) => {
    expect(() =>
      createWeeklyAvailabilityWindow({ ...validInput, start, end }),
    ).toThrowError(
      expect.objectContaining({
        name: "ServiceScheduleValidationError",
        code: "invalid_weekly_availability_window",
        message: "Invalid service schedule: invalid_weekly_availability_window",
      }),
    );
  });

  it("does not expose invalid window contents through errors", () => {
    const rejectedValue = "credential-secret-start";

    try {
      createWeeklyAvailabilityWindow({
        weekday: "monday",
        start: rejectedValue,
        end: "12:00",
      });
      throw new Error("Expected validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceScheduleValidationError);
      expect(String(error)).not.toContain(rejectedValue);
      expect(Object.values(error as object)).not.toContain(rejectedValue);
      expect(error).not.toHaveProperty("cause");
    }
  });
});
