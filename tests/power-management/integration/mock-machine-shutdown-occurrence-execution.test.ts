import { describe, expect, it, vi } from "vitest";
import { createPowerManagement } from "../../../src/power-management/composition/create-power-management.js";
import { createSequenceClock } from "../../test-helpers/controlled-time.js";

const policy = {
  mode: "scheduled" as const,
  timezone: "America/Sao_Paulo",
  weeklySchedule: {
    windows: [
      { dayOfWeek: "monday", start: "08:00", end: "18:00" },
      { dayOfWeek: "tuesday", start: "09:00", end: "17:00" },
    ],
  },
};
const occurrence = {
  operation: "shutdown" as const,
  scheduledFor: "2026-08-03T21:00:00.000Z",
  wakeScheduledFor: "2026-08-04T12:00:00.000Z",
};

describe("mock machine shutdown occurrence execution", () => {
  it("plans, waits explicitly, prepares wake, requests shutdown, and suppresses duplicates", async () => {
    const clock = createSequenceClock([
      new Date("2026-08-03T13:00:00.000Z"),
      new Date("2026-08-03T20:59:00.000Z"),
      new Date("2026-08-03T21:00:00.000Z"),
      new Date("2026-08-03T21:00:01.000Z"),
      new Date("2026-08-03T21:00:02.000Z"),
      new Date("2026-08-03T21:00:03.000Z"),
    ]);
    const capabilities = createPowerManagement({
      clock,
      machineOperatingPolicy: policy,
    });
    const planned = capabilities.planNextMachineShutdownOccurrence.execute();
    expect(planned).toEqual({ state: "planned", occurrence });
    await expect(
      capabilities.executeMachineShutdownOccurrence.execute(
        planned.state === "planned" ? planned.occurrence : {},
      ),
    ).resolves.toMatchObject({
      outcome: "not_due",
      processedAt: "2026-08-03T20:59:00.000Z",
    });
    await expect(
      capabilities.executeMachineShutdownOccurrence.execute(occurrence),
    ).resolves.toMatchObject({
      outcome: "executed",
      processedAt: "2026-08-03T21:00:00.000Z",
      wakeAlarmMutation: {
        outcome: "scheduled",
        requestedAt: "2026-08-03T21:00:00.000Z",
      },
      shutdownResult: {
        outcome: "simulated",
        requestedAt: "2026-08-03T21:00:00.000Z",
      },
    });
    await expect(
      capabilities.executeMachineShutdownOccurrence.execute(occurrence),
    ).resolves.toMatchObject({
      outcome: "duplicate",
      processedAt: "2026-08-03T21:00:01.000Z",
    });
    expect(await capabilities.getNextWakeAlarm.execute()).toEqual({
      observedAt: "2026-08-03T21:00:02.000Z",
      wakeAlarm: {
        state: "scheduled",
        scheduledFor: occurrence.wakeScheduledFor,
      },
    });
    expect((await capabilities.getRtcInformation.execute()).wakeAlarm).toEqual({
      state: "scheduled",
      scheduledFor: occurrence.wakeScheduledFor,
    });
    expect(Object.isFrozen(planned)).toBe(true);
  });

  it("does not claim stale occurrences", async () => {
    const clock = createSequenceClock([new Date("2026-08-04T12:00:00.000Z")]);
    const capabilities = createPowerManagement({ clock });
    await expect(
      capabilities.executeMachineShutdownOccurrence.execute(occurrence),
    ).resolves.toEqual({
      occurrence,
      processedAt: "2026-08-04T12:00:00.000Z",
      outcome: "stale",
    });
  });

  it("keeps the claim after wake preparation fails", async () => {
    const clock = createSequenceClock([
      new Date("2026-08-03T21:00:00.000Z"),
      new Date("2026-08-03T21:00:01.000Z"),
    ]);
    const capabilities = createPowerManagement({
      clock,
      mockWakeAlarmController: { scheduleFailure: new Error("wake") },
    });
    await expect(
      capabilities.executeMachineShutdownOccurrence.execute(occurrence),
    ).rejects.toMatchObject({ code: "wake_alarm_preparation_failed" });
    await expect(
      capabilities.executeMachineShutdownOccurrence.execute(occurrence),
    ).resolves.toMatchObject({ outcome: "duplicate" });
  });

  it("keeps the wake alarm after shutdown fails", async () => {
    const clock = createSequenceClock([
      new Date("2026-08-03T21:00:00.000Z"),
      new Date("2026-08-03T21:00:01.000Z"),
    ]);
    const capabilities = createPowerManagement({
      clock,
      mockMachineShutdownController: { failure: new Error("shutdown") },
    });
    await expect(
      capabilities.executeMachineShutdownOccurrence.execute(occurrence),
    ).rejects.toMatchObject({ code: "shutdown_failed_after_wake_scheduled" });
    expect(await capabilities.getNextWakeAlarm.execute()).toMatchObject({
      wakeAlarm: {
        state: "scheduled",
        scheduledFor: occurrence.wakeScheduledFor,
      },
    });
  });

  it("exposes stable frozen occurrence capabilities", () => {
    const capabilities = createPowerManagement({
      clock: { now: vi.fn(() => new Date()) },
    });
    expect(Object.isFrozen(capabilities)).toBe(true);
    expect(capabilities.planNextMachineShutdownOccurrence).toBe(
      capabilities.planNextMachineShutdownOccurrence,
    );
    expect(capabilities.executeMachineShutdownOccurrence).toBe(
      capabilities.executeMachineShutdownOccurrence,
    );
  });
});
