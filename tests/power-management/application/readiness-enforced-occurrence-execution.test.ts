import { describe, expect, it, vi } from "vitest";
import { ExecuteMachineShutdownOccurrence } from "../../../src/power-management/application/execute-machine-shutdown-occurrence.js";
import { EvaluateMachineShutdownReadiness } from "../../../src/power-management/application/evaluate-machine-shutdown-readiness.js";
import { InMemoryMachineShutdownOccurrenceClaimStore } from "../../../src/power-management/infrastructure/in-memory-machine-shutdown-occurrence-claim-store.js";
import {
  MockMachineShutdownConfirmationReader,
  MockMachineShutdownReadinessReader,
  MockMachineShutdownServiceReadinessReader,
} from "../../../src/power-management/infrastructure/mock-machine-shutdown-readiness-readers.js";
import { createWakeAlarmMutationResult } from "../../../src/power-management/domain/wake-alarm-mutation-result.js";
import { createMachineShutdownResult } from "../../../src/power-management/domain/machine-shutdown-result.js";

const occurrence = {
  operation: "shutdown" as const,
  scheduledFor: "2026-08-03T21:00:00.000Z",
  wakeScheduledFor: "2026-08-04T12:00:00.000Z",
};
function evaluator(confirmation: "confirmed" | "not_confirmed") {
  return new EvaluateMachineShutdownReadiness(
    { now: vi.fn(() => new Date(occurrence.scheduledFor)) },
    {
      confirmation: new MockMachineShutdownConfirmationReader(confirmation),
      services: new MockMachineShutdownServiceReadinessReader({
        state: "ready",
        blockers: [],
      }),
      activeTasks: new MockMachineShutdownReadinessReader({
        area: "active_tasks",
        state: "ready",
      }),
      backups: new MockMachineShutdownReadinessReader({
        area: "backups",
        state: "ready",
      }),
      filesystem: new MockMachineShutdownReadinessReader({
        area: "filesystem",
        state: "ready",
      }),
      eventRecording: new MockMachineShutdownReadinessReader({
        area: "event_recording",
        state: "ready",
      }),
    },
  );
}
describe("readiness-enforced occurrence execution", () => {
  it("rejects before claim and effects when confirmation is missing", async () => {
    const claims = new InMemoryMachineShutdownOccurrenceClaimStore();
    const wake = { schedule: vi.fn(), cancel: vi.fn() };
    const shutdown = { requestShutdown: vi.fn() };
    const executor = new ExecuteMachineShutdownOccurrence(
      { now: vi.fn(() => new Date(occurrence.scheduledFor)) },
      claims,
      wake,
      shutdown,
      evaluator("not_confirmed"),
    );
    await expect(executor.execute(occurrence)).resolves.toMatchObject({
      outcome: "rejected",
      decision: { blockers: [{ code: "not_confirmed" }] },
    });
    await expect(claims.claim(occurrence)).resolves.toEqual({
      outcome: "claimed",
    });
    expect(wake.schedule).not.toHaveBeenCalled();
    expect(shutdown.requestShutdown).not.toHaveBeenCalled();
  });
  it("uses one processed timestamp and keeps the existing effect order after approval", async () => {
    const requestedAt = occurrence.scheduledFor;
    const wakeResult = createWakeAlarmMutationResult({
      operation: "schedule",
      requestedAt,
      outcome: "scheduled",
      before: { state: "not_scheduled" },
      after: { state: "scheduled", scheduledFor: occurrence.wakeScheduledFor },
    });
    const shutdownResult = createMachineShutdownResult({
      operation: "shutdown",
      requestedAt,
      outcome: "simulated",
    });
    const order: string[] = [];
    const executor = new ExecuteMachineShutdownOccurrence(
      { now: vi.fn(() => new Date(requestedAt)) },
      new InMemoryMachineShutdownOccurrenceClaimStore(),
      {
        schedule: vi.fn(async (at, wake) => {
          order.push(`${at}:${wake}`);
          return wakeResult;
        }),
        cancel: vi.fn(),
      },
      {
        requestShutdown: vi.fn(async (at: string) => {
          order.push(at);
          return shutdownResult;
        }),
      },
      evaluator("confirmed"),
    );
    await expect(executor.execute(occurrence)).resolves.toMatchObject({
      outcome: "executed",
    });
    expect(order).toEqual([
      `${requestedAt}:${occurrence.wakeScheduledFor}`,
      requestedAt,
    ]);
  });
});
