import { describe, expect, it } from "vitest";

import { UnsupportedWakeAlarmMutationError } from "../../../src/power-management/domain/wake-alarm-errors.js";
import { MockWakeAlarmController } from "../../../src/power-management/infrastructure/mock-wake-alarm-controller.js";
import { MockWakeAlarmReader } from "../../../src/power-management/infrastructure/mock-wake-alarm-reader.js";
import { MockRtcInformationReader } from "../../../src/power-management/infrastructure/mock-rtc-information-reader.js";
import { MockWakeAlarmState } from "../../../src/power-management/infrastructure/mock-wake-alarm-state.js";

const REQUESTED_AT = "2026-07-31T12:00:00.000Z";
const T1 = "2026-08-01T06:00:00.000Z";
const T2 = "2026-08-02T06:00:00.000Z";

describe("MockWakeAlarmState", () => {
  it.each([
    ["default", undefined, "not_scheduled"],
    ["unsupported", { state: "unsupported" }, "unsupported"],
    ["scheduled", { state: "scheduled", scheduledFor: T1 }, "scheduled"],
  ] as const)(
    "supports %s initial state",
    (_label, initialWakeAlarm, state) => {
      const mockState = new MockWakeAlarmState(
        initialWakeAlarm ? { initialWakeAlarm } : undefined,
      );

      expect(mockState.read()).toEqual(
        state === "scheduled" ? { state, scheduledFor: T1 } : { state },
      );
      expect(Object.isFrozen(mockState.read())).toBe(true);
    },
  );

  it("schedules, replaces, and reports unchanged instants", () => {
    const mockState = new MockWakeAlarmState();

    expect(mockState.schedule(REQUESTED_AT, T1)).toEqual({
      operation: "schedule",
      requestedAt: REQUESTED_AT,
      outcome: "scheduled",
      before: { state: "not_scheduled" },
      after: { state: "scheduled", scheduledFor: T1 },
    });
    expect(mockState.schedule(REQUESTED_AT, T2)).toEqual({
      operation: "schedule",
      requestedAt: REQUESTED_AT,
      outcome: "replaced",
      before: { state: "scheduled", scheduledFor: T1 },
      after: { state: "scheduled", scheduledFor: T2 },
    });
    expect(mockState.schedule(REQUESTED_AT, T2)).toEqual({
      operation: "schedule",
      requestedAt: REQUESTED_AT,
      outcome: "unchanged",
      before: { state: "scheduled", scheduledFor: T2 },
      after: { state: "scheduled", scheduledFor: T2 },
    });
  });

  it("cancels a scheduled alarm and repeats cancellation as a no-op", () => {
    const mockState = new MockWakeAlarmState({
      initialWakeAlarm: { state: "scheduled", scheduledFor: T1 },
    });

    expect(mockState.cancel(REQUESTED_AT)).toEqual({
      operation: "cancel",
      requestedAt: REQUESTED_AT,
      outcome: "cancelled",
      before: { state: "scheduled", scheduledFor: T1 },
      after: { state: "not_scheduled" },
    });
    expect(mockState.cancel(REQUESTED_AT)).toEqual({
      operation: "cancel",
      requestedAt: REQUESTED_AT,
      outcome: "not_scheduled",
      before: { state: "not_scheduled" },
      after: { state: "not_scheduled" },
    });
  });

  it("rejects unsupported mutations without changing state", () => {
    const mockState = new MockWakeAlarmState({
      initialWakeAlarm: { state: "unsupported" },
    });

    expect(() => mockState.schedule(REQUESTED_AT, T1)).toThrowError(
      expect.objectContaining({ name: "UnsupportedWakeAlarmMutationError" }),
    );
    expect(() => mockState.cancel(REQUESTED_AT)).toThrowError(
      expect.objectContaining({ name: "UnsupportedWakeAlarmMutationError" }),
    );
    expect(mockState.read()).toEqual({ state: "unsupported" });
    expect(Object.isFrozen(new UnsupportedWakeAlarmMutationError())).toBe(true);
  });

  it("preserves failed mutations and controlled reads", async () => {
    const mockState = new MockWakeAlarmState({
      initialWakeAlarm: { state: "scheduled", scheduledFor: T1 },
    });
    const scheduleFailure = new Error("schedule-failure");
    const cancelFailure = new Error("cancel-failure");
    const failedController = new MockWakeAlarmController(mockState, {
      scheduleFailure,
      cancelFailure,
    });
    const failedReader = new MockWakeAlarmReader(mockState, {
      failure: new Error("read-failure"),
    });

    await expect(failedController.schedule(REQUESTED_AT, T2)).rejects.toBe(
      scheduleFailure,
    );
    await expect(failedController.cancel(REQUESTED_AT)).rejects.toBe(
      cancelFailure,
    );
    await expect(failedReader.read(REQUESTED_AT)).rejects.toThrow(
      "read-failure",
    );
    expect(mockState.read()).toEqual({ state: "scheduled", scheduledFor: T1 });
  });

  it("returns independent immutable reads with exact observation instants", async () => {
    const mockState = new MockWakeAlarmState({
      initialWakeAlarm: { state: "scheduled", scheduledFor: T1 },
    });
    const reader = new MockWakeAlarmReader(mockState);

    const first = await reader.read(REQUESTED_AT);
    const second = await reader.read("2026-07-31T12:01:00.000Z");

    expect(first).toEqual({
      observedAt: REQUESTED_AT,
      wakeAlarm: { state: "scheduled", scheduledFor: T1 },
    });
    expect(second.observedAt).toBe("2026-07-31T12:01:00.000Z");
    expect(second).not.toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.wakeAlarm)).toBe(true);
  });

  it("keeps RTC and independent alarm observations synchronized", async () => {
    const mockState = new MockWakeAlarmState();
    const reader = new MockWakeAlarmReader(mockState);
    const rtcReader = new MockRtcInformationReader(
      { rtcTime: "2026-01-01T00:00:00.000Z" },
      mockState,
    );
    const controller = new MockWakeAlarmController(mockState);

    await controller.schedule(REQUESTED_AT, T1);
    expect((await reader.read(REQUESTED_AT)).wakeAlarm).toEqual({
      state: "scheduled",
      scheduledFor: T1,
    });
    expect((await rtcReader.read(REQUESTED_AT)).wakeAlarm).toEqual({
      state: "scheduled",
      scheduledFor: T1,
    });
    await controller.cancel(REQUESTED_AT);
    expect((await reader.read(REQUESTED_AT)).wakeAlarm).toEqual({
      state: "not_scheduled",
    });
    expect((await rtcReader.read(REQUESTED_AT)).wakeAlarm).toEqual({
      state: "not_scheduled",
    });
  });
});

describe("MockWakeAlarmController", () => {
  it("preserves exact request and scheduled timestamps", async () => {
    const state = new MockWakeAlarmState();
    const controller = new MockWakeAlarmController(state);

    const result = await controller.schedule(REQUESTED_AT, T1);

    expect(result.requestedAt).toBe(REQUESTED_AT);
    expect(result.after).toEqual({ state: "scheduled", scheduledFor: T1 });
  });
});
