import { describe, expect, it } from "vitest";

import {
  assertWakeAlarmScheduleIsFuture,
  createWakeAlarmSchedule,
  WakeAlarmScheduleValidationError,
} from "../../../src/power-management/domain/wake-alarm-schedule.js";

const REQUESTED_AT = "2026-07-31T12:00:00.000Z";
const FUTURE = "2026-07-31T12:00:00.001Z";

function expectValidationError(input: unknown, code: string): void {
  expect(() => createWakeAlarmSchedule(input)).toThrowError(
    expect.objectContaining({ name: "WakeAlarmScheduleValidationError", code }),
  );
}

describe("wake-alarm schedule", () => {
  it("creates a canonical schedule and freezes it", () => {
    const result = createWakeAlarmSchedule({ scheduledFor: FUTURE });

    expect(result).toEqual({ scheduledFor: FUTURE });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it.each([
    ["malformed", "not-a-timestamp"],
    ["surrounding whitespace", ` ${FUTURE}`],
    ["date-only", "2026-07-31"],
    ["missing timezone", "2026-07-31T12:00:00.001"],
    ["impossible date", "2026-02-30T12:00:00.000Z"],
    ["control character", "2026-07-31T12:00:00.00\u0001Z"],
    ["empty", ""],
    ["non-string", 42],
  ] as const)("rejects %s scheduledFor values", (_label, scheduledFor) => {
    expectValidationError({ scheduledFor }, "invalid_scheduled_for");
  });

  it("rejects missing, unknown, and non-record input", () => {
    expectValidationError({}, "missing_scheduled_for");
    expectValidationError(
      { scheduledFor: FUTURE, device: "/dev/rtc0" },
      "invalid_field",
    );
    expectValidationError(null, "invalid_record");
    expectValidationError([], "invalid_record");
  });

  it("compares future instants chronologically across timezone offsets", () => {
    expect(() =>
      assertWakeAlarmScheduleIsFuture(
        REQUESTED_AT,
        "2026-07-31T09:00:00.001-03:00",
      ),
    ).not.toThrow();
    expect(() =>
      assertWakeAlarmScheduleIsFuture(
        REQUESTED_AT,
        "2026-07-31T09:00:00.000-03:00",
      ),
    ).toThrowError(
      expect.objectContaining({ code: "scheduled_for_not_future" }),
    );
    expect(() =>
      assertWakeAlarmScheduleIsFuture(REQUESTED_AT, "2026-07-31T11:59:59.999Z"),
    ).toThrowError(
      expect.objectContaining({ code: "scheduled_for_not_future" }),
    );
  });

  it("rejects an invalid request instant without exposing input", () => {
    expect(() => assertWakeAlarmScheduleIsFuture("bad", FUTURE)).toThrowError(
      expect.objectContaining({
        name: "WakeAlarmScheduleValidationError",
        code: "invalid_requested_at",
      }),
    );
    expect(
      Object.isFrozen(new WakeAlarmScheduleValidationError("invalid_record")),
    ).toBe(true);
  });
});
