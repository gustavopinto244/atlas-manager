import { describe, expect, it, vi } from "vitest";
import { RunMachinePowerSchedulerTick } from "../../../src/power-management/application/run-machine-power-scheduler-tick.js";
import { InMemoryMachinePowerSchedulerCursorStore } from "../../../src/power-management/infrastructure/in-memory-machine-power-scheduler-cursor-store.js";
import { InMemoryMachineShutdownOccurrenceClaimStore } from "../../../src/power-management/infrastructure/in-memory-machine-shutdown-occurrence-claim-store.js";
import { createMachineOperatingPolicy } from "../../../src/power-management/domain/machine-operating-policy.js";

const policy = createMachineOperatingPolicy({
  mode: "scheduled" as const,
  timezone: "America/Sao_Paulo",
  weeklySchedule: {
    windows: [
      { dayOfWeek: "monday", start: "08:00", end: "18:00" },
      { dayOfWeek: "tuesday", start: "09:00", end: "17:00" },
    ],
  },
});
describe("run machine power scheduler tick", () => {
  it("initializes safely, advances idle intervals, and executes chronologically", async () => {
    const values = [
      "2026-08-03T13:00:00.000Z",
      "2026-08-03T20:59:00.000Z",
      "2026-08-03T21:00:00.000Z",
      "2026-08-03T21:00:00.000Z",
    ];
    const clock = { now: vi.fn(() => new Date(values.shift()!)) };
    const executor = {
      execute: vi.fn(async () => ({
        occurrence: {
          operation: "shutdown" as const,
          scheduledFor: "2026-08-03T21:00:00.000Z",
          wakeScheduledFor: "2026-08-04T12:00:00.000Z",
        },
        processedAt: "2026-08-03T21:00:00.000Z",
        outcome: "executed" as const,
        wakeAlarmMutation: {
          operation: "schedule" as const,
          requestedAt: "2026-08-03T21:00:00.000Z",
          outcome: "scheduled" as const,
          before: { state: "not_scheduled" as const },
          after: {
            state: "scheduled" as const,
            scheduledFor: "2026-08-04T12:00:00.000Z",
          },
        },
        shutdownResult: {
          operation: "shutdown" as const,
          requestedAt: "2026-08-03T21:00:00.000Z",
          outcome: "simulated" as const,
        },
      })),
    };
    const tick = new RunMachinePowerSchedulerTick(
      clock,
      policy,
      new InMemoryMachinePowerSchedulerCursorStore(),
      new InMemoryMachineShutdownOccurrenceClaimStore(),
      executor,
    );
    await expect(tick.execute()).resolves.toMatchObject({
      kind: "initialized",
    });
    await expect(tick.execute()).resolves.toMatchObject({
      kind: "advanced",
      report: { occurrenceResults: [] },
    });
    await expect(tick.execute()).resolves.toMatchObject({
      kind: "advanced",
      report: { complete: true, occurrenceResults: [{ kind: "completed" }] },
    });
    expect(executor.execute).toHaveBeenCalledOnce();
  });
  it("blocks regression and oversized intervals without execution", async () => {
    const clock = {
      now: vi
        .fn()
        .mockReturnValueOnce(new Date("2026-08-10T00:00:00.000Z"))
        .mockReturnValueOnce(new Date("2026-08-09T23:59:00.000Z")),
    };
    const executor = { execute: vi.fn() };
    const tick = new RunMachinePowerSchedulerTick(
      clock,
      policy,
      new InMemoryMachinePowerSchedulerCursorStore(),
      new InMemoryMachineShutdownOccurrenceClaimStore(),
      executor,
    );
    await tick.execute();
    await expect(tick.execute()).resolves.toMatchObject({
      kind: "blocked",
      reason: "clock_regression",
    });
    expect(executor.execute).not.toHaveBeenCalled();
  });
});
