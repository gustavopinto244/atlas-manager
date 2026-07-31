import { describe, expect, it, vi } from "vitest";
import { PlanNextMachineShutdownOccurrence } from "../../../src/power-management/application/plan-next-machine-shutdown-occurrence.js";
import {
  ExecuteMachineShutdownOccurrence,
  MachineShutdownOccurrenceExecutionError,
} from "../../../src/power-management/application/execute-machine-shutdown-occurrence.js";
import { InMemoryMachineShutdownOccurrenceClaimStore } from "../../../src/power-management/infrastructure/in-memory-machine-shutdown-occurrence-claim-store.js";
import { createWakeAlarmMutationResult } from "../../../src/power-management/domain/wake-alarm-mutation-result.js";
import { createMachineShutdownResult } from "../../../src/power-management/domain/machine-shutdown-result.js";

const NOW = "2026-08-03T21:00:00.000Z";
const OCCURRENCE = {
  operation: "shutdown" as const,
  scheduledFor: NOW,
  wakeScheduledFor: "2026-08-04T12:00:00.000Z",
};
const WAKE_RESULT = createWakeAlarmMutationResult({
  operation: "schedule",
  requestedAt: NOW,
  outcome: "scheduled",
  before: { state: "not_scheduled" },
  after: { state: "scheduled", scheduledFor: OCCURRENCE.wakeScheduledFor },
});
const SHUTDOWN_RESULT = createMachineShutdownResult({
  operation: "shutdown",
  requestedAt: NOW,
  outcome: "simulated",
});

describe("machine shutdown occurrence application use cases", () => {
  it("plans from the power-plan capability exactly once without mutation or clock access", () => {
    const powerPlan = {
      execute: vi.fn(() => ({
        evaluatedAt: "2026-08-03T13:00:00.000Z",
        expectation: "operating",
        nextShutdown: { state: "planned", scheduledFor: NOW },
        nextWake: {
          state: "planned",
          scheduledFor: OCCURRENCE.wakeScheduledFor,
        },
      })),
    };
    const result = new PlanNextMachineShutdownOccurrence(powerPlan).execute();
    expect(result).toEqual({ state: "planned", occurrence: OCCURRENCE });
    expect(powerPlan.execute).toHaveBeenCalledOnce();
  });

  it("reads one clock instant and passes it to wake and shutdown in order", async () => {
    const order: string[] = [];
    const clock = { now: vi.fn(() => new Date(NOW)) };
    const claims = new InMemoryMachineShutdownOccurrenceClaimStore();
    const wake = {
      schedule: vi.fn(async (requestedAt: string, scheduledFor: string) => {
        order.push("wake");
        expect(requestedAt).toBe(NOW);
        expect(scheduledFor).toBe(OCCURRENCE.wakeScheduledFor);
        return WAKE_RESULT;
      }),
      cancel: vi.fn(),
    };
    const shutdown = {
      requestShutdown: vi.fn(async (requestedAt: string) => {
        order.push("shutdown");
        expect(requestedAt).toBe(NOW);
        return SHUTDOWN_RESULT;
      }),
    };
    const result = await new ExecuteMachineShutdownOccurrence(
      clock,
      claims,
      wake,
      shutdown,
    ).execute(OCCURRENCE);
    expect(result.outcome).toBe("executed");
    expect(order).toEqual(["wake", "shutdown"]);
    expect(clock.now).toHaveBeenCalledOnce();
  });

  it("does not claim or mutate a not-due occurrence", async () => {
    const clock = { now: vi.fn(() => new Date("2026-08-03T20:59:00.000Z")) };
    const claims = new InMemoryMachineShutdownOccurrenceClaimStore();
    const wake = { schedule: vi.fn(), cancel: vi.fn() };
    const shutdown = { requestShutdown: vi.fn() };
    const result = await new ExecuteMachineShutdownOccurrence(
      clock,
      claims,
      wake,
      shutdown,
    ).execute(OCCURRENCE);
    expect(result.outcome).toBe("not_due");
    expect(wake.schedule).not.toHaveBeenCalled();
    expect(shutdown.requestShutdown).not.toHaveBeenCalled();
  });

  it("wraps claim, wake, and partial shutdown failures without raw details", async () => {
    const clock = { now: vi.fn(() => new Date(NOW)) };
    const wake = {
      schedule: vi.fn().mockRejectedValue(new Error("secret path /x")),
      cancel: vi.fn(),
    };
    const shutdown = { requestShutdown: vi.fn() };
    await expect(
      new ExecuteMachineShutdownOccurrence(
        clock,
        new InMemoryMachineShutdownOccurrenceClaimStore(),
        wake,
        shutdown,
      ).execute(OCCURRENCE),
    ).rejects.toMatchObject({
      name: "MachineShutdownOccurrenceExecutionError",
      code: "wake_alarm_preparation_failed",
    });
    expect(shutdown.requestShutdown).not.toHaveBeenCalled();
    expect(
      new MachineShutdownOccurrenceExecutionError("claim_failed").message,
    ).not.toContain("/x");
  });
});
