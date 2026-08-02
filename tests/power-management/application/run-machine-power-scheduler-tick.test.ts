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
const confirmationReader = {
  read: vi.fn(async () => "confirmed" as const),
};
describe("run machine power scheduler tick", () => {
  it("keeps the cursor unchanged for an inconsistent not_due occurrence", async () => {
    const occurrence = {
      operation: "shutdown" as const,
      scheduledFor: "2026-08-03T21:00:00.000Z",
      wakeScheduledFor: "2026-08-04T12:00:00.000Z",
    };
    const clock = {
      now: vi
        .fn()
        .mockReturnValueOnce(new Date("2026-08-03T13:00:00.000Z"))
        .mockReturnValueOnce(new Date("2026-08-03T21:00:00.000Z"))
        .mockReturnValueOnce(new Date("2026-08-03T21:00:00.000Z")),
    };
    const executor = {
      executeAt: vi.fn(async () => ({
        occurrence,
        processedAt: "2026-08-03T21:00:00.000Z",
        outcome: "not_due" as const,
      })),
    };
    const tick = new RunMachinePowerSchedulerTick(
      clock,
      policy,
      new InMemoryMachinePowerSchedulerCursorStore(),
      new InMemoryMachineShutdownOccurrenceClaimStore(),
      executor,
      confirmationReader,
    );
    await tick.execute();
    await expect(tick.execute()).resolves.toMatchObject({
      kind: "incomplete",
      report: { complete: false },
    });
    await expect(tick.execute()).resolves.toMatchObject({
      kind: "incomplete",
      report: { complete: false },
    });
    expect(executor.executeAt).toHaveBeenCalledTimes(2);
  });

  it("keeps the cursor unchanged for preparation-incomplete execution and retries later", async () => {
    const occurrence = {
      operation: "shutdown" as const,
      scheduledFor: "2026-08-03T21:00:00.000Z",
      wakeScheduledFor: "2026-08-04T12:00:00.000Z",
    };
    const report = {
      occurrence,
      processedAt: occurrence.scheduledFor,
      initialDecision: {
        occurrence,
        evaluatedAt: occurrence.scheduledFor,
        outcome: "rejected" as const,
        blockers: [
          {
            area: "active_tasks" as const,
            code: "active_tasks_present" as const,
            activeTaskCount: 1,
          },
        ],
      },
      plan: null,
      steps: [],
      events: [],
      outcome: "incomplete" as const,
    };
    const clock = {
      now: vi
        .fn()
        .mockReturnValueOnce(new Date("2026-08-03T13:00:00.000Z"))
        .mockReturnValueOnce(new Date("2026-08-03T21:00:00.000Z"))
        .mockReturnValueOnce(new Date("2026-08-03T21:00:00.000Z")),
    };
    const executor = {
      executeAt: vi
        .fn()
        .mockResolvedValueOnce({
          occurrence,
          processedAt: occurrence.scheduledFor,
          outcome: "preparation_incomplete" as const,
          preparationReport: report,
        })
        .mockResolvedValueOnce({
          occurrence,
          processedAt: occurrence.scheduledFor,
          outcome: "executed" as const,
          wakeAlarmMutation: {
            operation: "schedule" as const,
            requestedAt: occurrence.scheduledFor,
            outcome: "scheduled" as const,
            before: { state: "not_scheduled" as const },
            after: {
              state: "scheduled" as const,
              scheduledFor: occurrence.wakeScheduledFor,
            },
          },
          shutdownResult: {
            operation: "shutdown" as const,
            requestedAt: occurrence.scheduledFor,
            outcome: "simulated" as const,
          },
        }),
    };
    const tick = new RunMachinePowerSchedulerTick(
      clock,
      policy,
      new InMemoryMachinePowerSchedulerCursorStore(),
      new InMemoryMachineShutdownOccurrenceClaimStore(),
      executor,
      confirmationReader,
    );
    await tick.execute();
    await expect(tick.execute()).resolves.toMatchObject({
      kind: "incomplete",
      report: { complete: false },
    });
    await expect(tick.execute()).resolves.toMatchObject({
      kind: "advanced",
      report: { complete: true },
    });
    expect(executor.executeAt).toHaveBeenCalledTimes(2);
  });
  it("initializes safely, advances idle intervals, and executes chronologically", async () => {
    const values = [
      "2026-08-03T13:00:00.000Z",
      "2026-08-03T20:59:00.000Z",
      "2026-08-03T21:00:00.000Z",
      "2026-08-03T21:00:00.000Z",
    ];
    const clock = { now: vi.fn(() => new Date(values.shift()!)) };
    const executor = {
      executeAt: vi.fn(async () => ({
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
      confirmationReader,
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
    expect(executor.executeAt).toHaveBeenCalledOnce();
    expect(executor.executeAt).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "shutdown",
        scheduledFor: "2026-08-03T21:00:00.000Z",
      }),
      "2026-08-03T21:00:00.000Z",
      { kind: "automated", actorId: "machine-power-scheduler" },
      { confirmationReader, automaticallyPrepare: true },
    );
  });
  it("blocks regression and oversized intervals without execution", async () => {
    const clock = {
      now: vi
        .fn()
        .mockReturnValueOnce(new Date("2026-08-10T00:00:00.000Z"))
        .mockReturnValueOnce(new Date("2026-08-09T23:59:00.000Z")),
    };
    const executor = { executeAt: vi.fn() };
    const tick = new RunMachinePowerSchedulerTick(
      clock,
      policy,
      new InMemoryMachinePowerSchedulerCursorStore(),
      new InMemoryMachineShutdownOccurrenceClaimStore(),
      executor,
      confirmationReader,
    );
    await tick.execute();
    await expect(tick.execute()).resolves.toMatchObject({
      kind: "blocked",
      reason: "clock_regression",
    });
    expect(executor.executeAt).not.toHaveBeenCalled();
  });
});
