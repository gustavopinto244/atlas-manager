import { describe, expect, it, vi } from "vitest";
import { ExecuteMachineShutdownOccurrence } from "../../../src/power-management/application/execute-machine-shutdown-occurrence.js";
import { EvaluateMachineShutdownReadiness } from "../../../src/power-management/application/evaluate-machine-shutdown-readiness.js";
import { PrepareMachineShutdownOccurrence } from "../../../src/power-management/application/prepare-machine-shutdown-occurrence.js";
import { InMemoryMachineShutdownOccurrenceClaimStore } from "../../../src/power-management/infrastructure/in-memory-machine-shutdown-occurrence-claim-store.js";
import { InMemoryMachineShutdownPreparationEventRecorder } from "../../../src/power-management/infrastructure/in-memory-machine-shutdown-preparation-event-recorder.js";
import { createWakeAlarmMutationResult } from "../../../src/power-management/domain/wake-alarm-mutation-result.js";
import { createMachineShutdownResult } from "../../../src/power-management/domain/machine-shutdown-result.js";
import type { PowerManagementClock } from "../../../src/power-management/application/ports/power-management-clock.js";

const occurrence = {
  operation: "shutdown" as const,
  scheduledFor: "2026-08-03T21:00:00.000Z",
  wakeScheduledFor: "2026-08-04T12:00:00.000Z",
};
const at = occurrence.scheduledFor;
function readiness(
  confirmation: "confirmed" | "not_confirmed" = "confirmed",
  taskState: "ready" | "blocked" = "ready",
) {
  return new EvaluateMachineShutdownReadiness(
    { now: vi.fn(() => new Date(at)) },
    {
      confirmation: { read: vi.fn(async () => confirmation) },
      services: {
        read: vi.fn(async () => ({
          state: "ready" as const,
          blockers: [] as const,
        })),
      },
      activeTasks: {
        read: vi.fn(async () =>
          taskState === "ready"
            ? { area: "active_tasks" as const, state: "ready" as const }
            : {
                area: "active_tasks" as const,
                state: "blocked" as const,
                activeTaskCount: 1,
              },
        ),
      },
      backups: {
        read: vi.fn(async () => ({
          area: "backups" as const,
          state: "ready" as const,
        })),
      },
      filesystem: {
        read: vi.fn(async () => ({
          area: "filesystem" as const,
          state: "ready" as const,
        })),
      },
      eventRecording: {
        read: vi.fn(async () => ({
          area: "event_recording" as const,
          state: "ready" as const,
        })),
      },
    },
  );
}
function executor(
  clock: PowerManagementClock,
  evalr: EvaluateMachineShutdownReadiness,
  prep?: PrepareMachineShutdownOccurrence,
) {
  const wakeResult = createWakeAlarmMutationResult({
    operation: "schedule",
    requestedAt: at,
    outcome: "scheduled",
    before: { state: "not_scheduled" },
    after: { state: "scheduled", scheduledFor: occurrence.wakeScheduledFor },
  });
  const shutdownResult = createMachineShutdownResult({
    operation: "shutdown",
    requestedAt: at,
    outcome: "simulated",
  });
  const wake = { schedule: vi.fn(async () => wakeResult), cancel: vi.fn() };
  const shutdown = { requestShutdown: vi.fn(async () => shutdownResult) };
  return {
    useCase: new ExecuteMachineShutdownOccurrence(
      clock,
      new InMemoryMachineShutdownOccurrenceClaimStore(),
      wake,
      shutdown,
      evalr,
      prep,
    ),
    wake,
    shutdown,
  };
}
describe("preparation-aware occurrence execution", () => {
  it("can reject an HTTP-style execution without automatically preparing", async () => {
    const clock = { now: vi.fn(() => new Date(at)) };
    const evalr = readiness("confirmed", "blocked");
    const prep = new PrepareMachineShutdownOccurrence(clock, evalr, {
      tasks: { drain: vi.fn() },
      backup: { complete: vi.fn() },
      filesystem: { synchronize: vi.fn() },
      events: new InMemoryMachineShutdownPreparationEventRecorder(),
    });
    const h = executor(clock, evalr, prep);
    const result = await h.useCase.executeAt(
      occurrence,
      at,
      {
        kind: "administrative",
        actorId: "administrator:00000000-0000-4000-8000-000000000001",
      },
      {
        confirmationReader: { read: vi.fn(async () => "confirmed" as const) },
        automaticallyPrepare: false,
      },
    );

    expect(result.outcome).toBe("rejected");
    expect(h.wake.schedule).not.toHaveBeenCalled();
    expect(h.shutdown.requestShutdown).not.toHaveBeenCalled();
  });

  it("shares one processedAt and returns not_required preparation before claim/effects", async () => {
    const clock = { now: vi.fn(() => new Date(at)) };
    const evalr = readiness();
    const prep = new PrepareMachineShutdownOccurrence(clock, evalr, {
      tasks: { drain: vi.fn() },
      backup: { complete: vi.fn() },
      filesystem: { synchronize: vi.fn() },
      events: new InMemoryMachineShutdownPreparationEventRecorder(),
    });
    const h = executor(clock, evalr, prep);
    const result = await h.useCase.execute(occurrence);
    expect(result.outcome).toBe("executed");
    expect(
      "preparationReport" in result
        ? result.preparationReport.outcome
        : undefined,
    ).toBe("not_required");
    expect(clock.now).toHaveBeenCalledTimes(1);
    expect(h.wake.schedule).toHaveBeenCalledWith(
      at,
      occurrence.wakeScheduledFor,
    );
    expect(h.shutdown.requestShutdown).toHaveBeenCalledWith(at);
  });

  it("returns rejected before claim for a non-preparable readiness blocker", async () => {
    const clock = { now: vi.fn(() => new Date(at)) };
    const evalr = new EvaluateMachineShutdownReadiness(
      { now: vi.fn(() => new Date(at)) },
      {
        confirmation: { read: vi.fn(async () => "confirmed" as const) },
        services: {
          read: vi.fn(async () => ({
            state: "blocked" as const,
            blockers: [
              {
                area: "services" as const,
                code: "service_required_during_offline_interval" as const,
              },
            ],
          })),
        },
        activeTasks: {
          read: vi.fn(async () => ({
            area: "active_tasks" as const,
            state: "ready" as const,
          })),
        },
        backups: {
          read: vi.fn(async () => ({
            area: "backups" as const,
            state: "ready" as const,
          })),
        },
        filesystem: {
          read: vi.fn(async () => ({
            area: "filesystem" as const,
            state: "ready" as const,
          })),
        },
        eventRecording: {
          read: vi.fn(async () => ({
            area: "event_recording" as const,
            state: "ready" as const,
          })),
        },
      },
    );
    const h = executor(
      clock,
      evalr,
      new PrepareMachineShutdownOccurrence(clock, evalr, {
        tasks: { drain: vi.fn() },
        backup: { complete: vi.fn() },
        filesystem: { synchronize: vi.fn() },
        events: new InMemoryMachineShutdownPreparationEventRecorder(),
      }),
    );
    const result = await h.useCase.execute(occurrence);
    expect(result.outcome).toBe("rejected");
    expect(
      "preparationReport" in result
        ? result.preparationReport.outcome
        : undefined,
    ).toBe("blocked");
    expect(h.wake.schedule).not.toHaveBeenCalled();
    expect(h.shutdown.requestShutdown).not.toHaveBeenCalled();
  });

  it("returns preparation_incomplete without claim or machine effects", async () => {
    const clock = { now: vi.fn(() => new Date(at)) };
    const evalr = readiness("confirmed", "blocked");
    const prep = new PrepareMachineShutdownOccurrence(clock, evalr, {
      tasks: {
        drain: vi.fn(async () => ({
          outcome: "blocked" as const,
          remainingTaskCount: 1,
        })),
      },
      backup: { complete: vi.fn() },
      filesystem: { synchronize: vi.fn() },
      events: new InMemoryMachineShutdownPreparationEventRecorder(),
    });
    const h = executor(clock, evalr, prep);
    const result = await h.useCase.execute(occurrence);
    expect(result.outcome).toBe("preparation_incomplete");
    expect(h.wake.schedule).not.toHaveBeenCalled();
    expect(h.shutdown.requestShutdown).not.toHaveBeenCalled();
  });

  it.each([
    ["not_due", "2026-08-03T20:59:59.000Z"],
    ["stale", "2026-08-04T12:00:00.000Z"],
  ] as const)(
    "keeps %s timing terminal and skips readiness",
    async (outcome, timestamp) => {
      const clock = { now: vi.fn(() => new Date(timestamp)) };
      const evalr = readiness("not_confirmed");
      const h = executor(clock, evalr);
      const result = await h.useCase.execute(occurrence);
      expect(result.outcome).toBe(outcome);
      expect(h.wake.schedule).not.toHaveBeenCalled();
      expect(h.shutdown.requestShutdown).not.toHaveBeenCalled();
    },
  );
});
