import { describe, expect, it } from "vitest";

import {
  createRtcInformation,
  RtcInformationValidationError,
} from "../../../src/power-management/domain/rtc-information.js";

const OBSERVED_AT = "2026-07-31T12:00:00.000Z";
const RTC_TIME = "2026-07-31T09:00:00.000Z";

function createValidInput(overrides: Record<string, unknown> = {}) {
  return {
    observedAt: OBSERVED_AT,
    rtcTime: RTC_TIME,
    wakeAlarm: { state: "unsupported" },
    ...overrides,
  };
}

function expectValidationError(input: unknown, code: string): void {
  expect(() => createRtcInformation(input)).toThrowError(
    expect.objectContaining({
      name: "RtcInformationValidationError",
      code,
    }),
  );
}

describe("RTC information", () => {
  it.each([
    [{ state: "unsupported" }, "unsupported"],
    [{ state: "not_scheduled" }, "not_scheduled"],
    [
      { state: "scheduled", scheduledFor: "2026-08-01T06:00:00.000Z" },
      "scheduled",
    ],
  ] as const)(
    "creates canonical information with %s wake alarm",
    (wakeAlarm, state) => {
      const result = createRtcInformation(createValidInput({ wakeAlarm }));

      expect(result).toEqual({
        observedAt: OBSERVED_AT,
        rtcTime: RTC_TIME,
        wakeAlarm,
      });
      expect(result.wakeAlarm.state).toBe(state);
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.wakeAlarm)).toBe(true);
    },
  );

  it.each([
    ["empty", ""],
    ["surrounding whitespace", ` ${RTC_TIME}`],
    ["date-only", "2026-07-31"],
    ["missing timezone", "2026-07-31T09:00:00.000"],
    ["impossible date", "2026-02-30T09:00:00.000Z"],
    ["arbitrary text", "not-a-timestamp"],
    ["control character", "2026-07-31T09:00:00.000\u0000Z"],
    ["non-string", 42],
  ] as const)("rejects %s RTC timestamps", (_label, rtcTime) => {
    expectValidationError(createValidInput({ rtcTime }), "invalid_rtc_time");
  });

  it.each([
    ["empty", ""],
    ["surrounding whitespace", ` ${OBSERVED_AT}`],
    ["date-only", "2026-07-31"],
    ["missing timezone", "2026-07-31T12:00:00.000"],
    ["impossible date", "2026-02-30T12:00:00.000Z"],
    ["arbitrary text", "not-a-timestamp"],
    ["control character", "2026-07-31T12:00:00.000\u0000Z"],
    ["non-string", null],
  ] as const)("rejects %s observation timestamps", (_label, observedAt) => {
    expectValidationError(
      createValidInput({ observedAt }),
      "invalid_observed_at",
    );
  });

  it.each([
    ["null", null],
    ["an array", []],
    ["a string", "rtc"],
    ["a number", 42],
    [
      "an unknown field",
      {
        observedAt: OBSERVED_AT,
        rtcTime: RTC_TIME,
        wakeAlarm: { state: "unsupported" },
        device: "/dev/rtc0",
      },
    ],
  ])("rejects %s RTC information input", (_label, input) => {
    expectValidationError(
      input,
      input &&
        typeof input === "object" &&
        !Array.isArray(input) &&
        "device" in input
        ? "invalid_field"
        : "invalid_record",
    );
  });

  it("maps invalid wake-alarm input to a typed RTC validation error", () => {
    expectValidationError(
      createValidInput({ wakeAlarm: { state: "scheduled" } }),
      "invalid_wake_alarm",
    );
  });

  it("does not retain mutable input records", () => {
    const wakeAlarm = {
      state: "scheduled",
      scheduledFor: "2026-08-01T06:00:00.000Z",
    };
    const input = createValidInput({ wakeAlarm });
    const result = createRtcInformation(input);

    input.rtcTime = "2027-01-01T00:00:00.000Z";
    wakeAlarm.scheduledFor = "2027-01-01T00:00:00.000Z";

    expect(result.rtcTime).toBe(RTC_TIME);
    expect(result.wakeAlarm).toEqual({
      state: "scheduled",
      scheduledFor: "2026-08-01T06:00:00.000Z",
    });
    expect(result.wakeAlarm).not.toBe(wakeAlarm);
    expect(
      Object.isFrozen(new RtcInformationValidationError("invalid_record")),
    ).toBe(true);
  });
});
