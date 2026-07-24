import { describe, expect, it } from "vitest";

import {
  createServiceScheduleWeekday,
  SERVICE_SCHEDULE_WEEKDAYS,
} from "../../../src/service-scheduling/domain/service-schedule-weekday.js";
import { ServiceScheduleValidationError } from "../../../src/service-scheduling/domain/service-schedule-validation-error.js";

describe("ServiceScheduleWeekday", () => {
  it("defines every weekday in canonical ISO order", () => {
    expect(SERVICE_SCHEDULE_WEEKDAYS).toEqual([
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
      "sunday",
    ]);
    expect(Object.isFrozen(SERVICE_SCHEDULE_WEEKDAYS)).toBe(true);
  });

  it.each(SERVICE_SCHEDULE_WEEKDAYS)(
    "accepts and returns %s unchanged",
    (weekday) => {
      expect(createServiceScheduleWeekday(weekday)).toBe(weekday);
    },
  );

  it.each([
    "",
    " ",
    " monday",
    "monday ",
    "Monday",
    "MONDAY",
    "mOnDaY",
    "mon",
    "1",
    "0",
    "segunda",
    "segunda-feira",
    "monday\u0000",
  ])("rejects the non-canonical weekday %j", (value) => {
    expect(() => createServiceScheduleWeekday(value)).toThrowError(
      expect.objectContaining({
        name: "ServiceScheduleValidationError",
        code: "invalid_schedule_weekday",
        message: "Invalid service schedule: invalid_schedule_weekday",
      }),
    );
  });

  it.each([undefined, null, true, false, 1, 0, [], {}, ["monday"]])(
    "rejects the runtime-invalid weekday %j without coercion",
    (value) => {
      const runtimeValue: unknown = value;

      expect(() =>
        createServiceScheduleWeekday(runtimeValue as string),
      ).toThrow(ServiceScheduleValidationError);
    },
  );

  it("cannot be mutated through the public allowlist", () => {
    const mutableView = SERVICE_SCHEDULE_WEEKDAYS as unknown as string[];

    expect(() => mutableView.push("holiday")).toThrow(TypeError);
    expect(() => {
      mutableView[0] = "holiday";
    }).toThrow(TypeError);

    expect(SERVICE_SCHEDULE_WEEKDAYS[0]).toBe("monday");
    expect(createServiceScheduleWeekday("monday")).toBe("monday");
    expect(() => createServiceScheduleWeekday("holiday")).toThrow(
      ServiceScheduleValidationError,
    );
  });

  it("does not expose rejected weekday values through errors", () => {
    const rejectedValue = "credential-secret-weekday";

    try {
      createServiceScheduleWeekday(rejectedValue);
      throw new Error("Expected validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceScheduleValidationError);
      expect(String(error)).not.toContain(rejectedValue);
      expect(Object.values(error as object)).not.toContain(rejectedValue);
      expect(error).not.toHaveProperty("cause");
    }
  });
});
