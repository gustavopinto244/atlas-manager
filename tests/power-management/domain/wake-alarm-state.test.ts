import { describe, expect, it } from "vitest";

import {
  createWakeAlarmState,
  WakeAlarmStateValidationError,
} from "../../../src/power-management/domain/wake-alarm-state.js";

function expectValidationError(input: unknown, code: string): void {
  expect(() => createWakeAlarmState(input)).toThrowError(
    expect.objectContaining({
      name: "WakeAlarmStateValidationError",
      code,
    }),
  );
}

describe("wake-alarm state", () => {
  it.each([
    [{ state: "unsupported" }, "unsupported"],
    [{ state: "not_scheduled" }, "not_scheduled"],
    [
      {
        state: "scheduled",
        scheduledFor: "2026-07-31T08:30:00.000Z",
      },
      "scheduled",
    ],
  ] as const)("creates the %s state", (input, state) => {
    const result = createWakeAlarmState(input);

    expect(result.state).toBe(state);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it.each([
    ["an unknown state", { state: "unknown" }, "invalid_state"],
    ["an uppercase state", { state: "SCHEDULED" }, "invalid_state"],
    ["a missing state", {}, "invalid_state"],
    [
      "a missing scheduled timestamp",
      { state: "scheduled" },
      "missing_scheduled_for",
    ],
    [
      "an extra timestamp for unsupported",
      { state: "unsupported", scheduledFor: "2026-07-31T08:30:00.000Z" },
      "unexpected_scheduled_for",
    ],
    [
      "an extra timestamp for not scheduled",
      { state: "not_scheduled", scheduledFor: "2026-07-31T08:30:00.000Z" },
      "unexpected_scheduled_for",
    ],
    [
      "a malformed scheduled timestamp",
      { state: "scheduled", scheduledFor: "not-a-timestamp" },
      "invalid_scheduled_for",
    ],
    [
      "an unknown field",
      { state: "unsupported", device: "/dev/rtc0" },
      "invalid_field",
    ],
  ] as const)("rejects %s", (_label, input, code) => {
    expectValidationError(input, code);
  });

  it.each([
    ["null", null],
    ["a string", "scheduled"],
    ["an array", []],
    ["a number", 42],
  ])("rejects %s as a non-record", (_label, input) => {
    expectValidationError(input, "invalid_record");
  });

  it("does not retain caller-owned state and exposes no raw values in errors", () => {
    const input = {
      state: "scheduled",
      scheduledFor: "2026-07-31T08:30:00.000Z",
    };
    const result = createWakeAlarmState(input);

    input.scheduledFor = "2027-01-01T00:00:00.000Z";

    expect(result).toEqual({
      state: "scheduled",
      scheduledFor: "2026-07-31T08:30:00.000Z",
    });
    expect(result).not.toBe(input);
    expect(Object.isFrozen(result)).toBe(true);
    expect(
      Object.isFrozen(new WakeAlarmStateValidationError("invalid_state")),
    ).toBe(true);
    try {
      createWakeAlarmState({ state: "unsupported", device: "/dev/rtc0" });
    } catch (error) {
      expect(String(error)).not.toContain("/dev/rtc0");
    }
  });
});
