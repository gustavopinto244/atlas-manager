import { describe, expect, it } from "vitest";

import { createServiceScheduleLocalTime } from "../../../src/service-scheduling/domain/service-schedule-local-time.js";
import { ServiceScheduleValidationError } from "../../../src/service-scheduling/domain/service-schedule-validation-error.js";

describe("ServiceScheduleLocalTime", () => {
  it.each([
    "00:00",
    "00:01",
    "01:00",
    "08:30",
    "12:00",
    "18:45",
    "23:58",
    "23:59",
  ])("accepts and returns %s unchanged", (time) => {
    expect(createServiceScheduleLocalTime(time)).toBe(time);
  });

  it.each([
    "",
    " ",
    "0:00",
    "8:30",
    "08:3",
    "0800",
    "08::30",
    "08:30:00",
    "08:30.000",
    "-01:00",
    "24:00",
    "25:00",
    "23:60",
    "23:99",
    "08.30",
    "08h30",
    " 08:30",
    "08:30 ",
    "08:30Z",
    "08:30-03:00",
    "08:30 America/Sao_Paulo",
    "2026-07-24",
    "０８:３０",
    "08:٣٠",
  ])("rejects the non-canonical local time %j", (value) => {
    expect(() => createServiceScheduleLocalTime(value)).toThrowError(
      expect.objectContaining({
        name: "ServiceScheduleValidationError",
        code: "invalid_schedule_local_time",
        message: "Invalid service schedule: invalid_schedule_local_time",
      }),
    );
  });

  it.each([undefined, null, true, false, 0, 830, [], {}, ["08:30"]])(
    "rejects the runtime-invalid local time %j without coercion",
    (value) => {
      const runtimeValue: unknown = value;

      expect(() =>
        createServiceScheduleLocalTime(runtimeValue as string),
      ).toThrow(ServiceScheduleValidationError);
    },
  );

  it("does not expose rejected time values through errors", () => {
    const rejectedValue = "credential-secret-time";

    try {
      createServiceScheduleLocalTime(rejectedValue);
      throw new Error("Expected validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceScheduleValidationError);
      expect(String(error)).not.toContain(rejectedValue);
      expect(Object.values(error as object)).not.toContain(rejectedValue);
      expect(error).not.toHaveProperty("cause");
    }
  });
});
