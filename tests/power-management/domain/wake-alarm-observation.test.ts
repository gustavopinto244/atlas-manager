import { describe, expect, it } from "vitest";

import {
  createWakeAlarmObservation,
  WakeAlarmObservationValidationError,
} from "../../../src/power-management/domain/wake-alarm-observation.js";

const OBSERVED_AT = "2026-07-31T12:00:00.000Z";

function expectValidationError(input: unknown, code: string): void {
  expect(() => createWakeAlarmObservation(input)).toThrowError(
    expect.objectContaining({
      name: "WakeAlarmObservationValidationError",
      code,
    }),
  );
}

describe("wake-alarm observation", () => {
  it.each([
    [{ state: "unsupported" }, "unsupported"],
    [{ state: "not_scheduled" }, "not_scheduled"],
    [
      { state: "scheduled", scheduledFor: "2026-08-01T06:00:00.000Z" },
      "scheduled",
    ],
  ] as const)("creates a %s observation", (wakeAlarm, state) => {
    const result = createWakeAlarmObservation({
      observedAt: OBSERVED_AT,
      wakeAlarm,
    });

    expect(result).toEqual({ observedAt: OBSERVED_AT, wakeAlarm });
    expect(result.wakeAlarm.state).toBe(state);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.wakeAlarm)).toBe(true);
  });

  it.each([
    [
      "a malformed timestamp",
      { observedAt: "not-a-timestamp", wakeAlarm: { state: "unsupported" } },
    ],
    [
      "surrounding whitespace",
      { observedAt: ` ${OBSERVED_AT}`, wakeAlarm: { state: "unsupported" } },
    ],
    [
      "a date-only value",
      { observedAt: "2026-07-31", wakeAlarm: { state: "unsupported" } },
    ],
    [
      "an unknown field",
      {
        observedAt: OBSERVED_AT,
        wakeAlarm: { state: "unsupported" },
        device: "/dev/rtc0",
      },
    ],
  ] as const)("rejects %s", (_label, input) => {
    expectValidationError(
      input,
      _label === "an unknown field" ? "invalid_field" : "invalid_observed_at",
    );
  });

  it("rejects malformed nested wake-alarm state", () => {
    expectValidationError(
      { observedAt: OBSERVED_AT, wakeAlarm: { state: "scheduled" } },
      "invalid_wake_alarm",
    );
  });

  it.each([null, "observation", [], 42])(
    "rejects %s as a non-record",
    (input) => {
      expectValidationError(input, "invalid_record");
    },
  );

  it("isolates caller input and freezes nested state", () => {
    const wakeAlarm = {
      state: "scheduled",
      scheduledFor: "2026-08-01T06:00:00.000Z",
    };
    const result = createWakeAlarmObservation({
      observedAt: OBSERVED_AT,
      wakeAlarm,
    });

    wakeAlarm.scheduledFor = "2027-01-01T00:00:00.000Z";

    expect(result.wakeAlarm).toEqual({
      state: "scheduled",
      scheduledFor: "2026-08-01T06:00:00.000Z",
    });
    expect(result.wakeAlarm).not.toBe(wakeAlarm);
    expect(
      Object.isFrozen(
        new WakeAlarmObservationValidationError("invalid_record"),
      ),
    ).toBe(true);
  });
});
