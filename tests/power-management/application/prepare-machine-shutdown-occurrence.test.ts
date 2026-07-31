import { describe, expect, it, vi } from "vitest";
import { EvaluateMachineShutdownReadiness } from "../../../src/power-management/application/evaluate-machine-shutdown-readiness.js";
import { PrepareMachineShutdownOccurrence } from "../../../src/power-management/application/prepare-machine-shutdown-occurrence.js";
import { InMemoryMachineShutdownPreparationEventRecorder } from "../../../src/power-management/infrastructure/in-memory-machine-shutdown-preparation-event-recorder.js";
import { createRegisteredServicesStopResult } from "../../../src/service-management/domain/registered-services-stop-result.js";
import { createMachineShutdownOccurrence } from "../../../src/power-management/domain/machine-shutdown-occurrence.js";
import type { MachineShutdownOccurrence } from "../../../src/power-management/domain/machine-shutdown-occurrence.js";
import type { MachineShutdownReadinessDecision } from "../../../src/power-management/domain/machine-shutdown-readiness-decision.js";

const occurrence = createMachineShutdownOccurrence({
  operation: "shutdown",
  scheduledFor: "2026-08-03T21:00:00.000Z",
  wakeScheduledFor: "2026-08-04T12:00:00.000Z",
});
const at = occurrence.scheduledFor;
function evaluator(
  confirmations: readonly ("confirmed" | "not_confirmed")[],
  finalService: "ready" | "blocked" = "ready",
) {
  let confirmationIndex = 0;
  const calls = {
    confirmations: 0,
    services: 0,
    tasks: 0,
    backups: 0,
    filesystem: 0,
    events: 0,
  };
  const readiness = new EvaluateMachineShutdownReadiness(
    { now: vi.fn(() => new Date(at)) },
    {
      confirmation: {
        read: vi.fn(async () => {
          calls.confirmations += 1;
          return confirmations[confirmationIndex++] ?? "confirmed";
        }),
      },
      services: {
        read: vi.fn(async () => {
          calls.services += 1;
          return finalService === "ready"
            ? { state: "ready" as const, blockers: [] as const }
            : {
                state: "blocked" as const,
                blockers: [
                  {
                    area: "services" as const,
                    code: "service_readiness_unavailable" as const,
                  },
                ],
              };
        }),
      },
      activeTasks: {
        read: vi.fn(async () => {
          calls.tasks += 1;
          return { area: "active_tasks" as const, state: "ready" as const };
        }),
      },
      backups: {
        read: vi.fn(async () => {
          calls.backups += 1;
          return { area: "backups" as const, state: "ready" as const };
        }),
      },
      filesystem: {
        read: vi.fn(async () => {
          calls.filesystem += 1;
          return { area: "filesystem" as const, state: "ready" as const };
        }),
      },
      eventRecording: {
        read: vi.fn(async () => {
          calls.events += 1;
          return { area: "event_recording" as const, state: "ready" as const };
        }),
      },
    },
  );
  return { readiness, calls };
}
function initial(
  blockers: readonly Record<string, unknown>[],
): MachineShutdownReadinessDecision {
  return {
    occurrence,
    evaluatedAt: at,
    outcome: blockers.length ? "rejected" : "approved",
    blockers,
  } as MachineShutdownReadinessDecision;
}
function controllers(
  log: string[],
  recorder = new InMemoryMachineShutdownPreparationEventRecorder(),
) {
  return {
    recorder,
    services: {
      prepare: vi.fn(
        async (input: {
          occurrence: MachineShutdownOccurrence;
          requestedAt: string;
          serviceIds: readonly string[];
        }) => {
          log.push(
            `services:${input.requestedAt}:${input.serviceIds.join(",")}`,
          );
          return createRegisteredServicesStopResult({
            authority: "machine_shutdown",
            requestedAt: input.requestedAt,
            successful: true,
            steps: input.serviceIds.map((serviceId) => ({
              serviceId,
              outcome: "stopped" as const,
            })),
          });
        },
      ),
    },
    tasks: {
      drain: vi.fn(async () => {
        log.push("tasks");
        return { outcome: "drained" as const };
      }),
    },
    backup: {
      complete: vi.fn(async () => {
        log.push("backup");
        return { outcome: "completed" as const };
      }),
    },
    filesystem: {
      synchronize: vi.fn(async () => {
        log.push("filesystem");
        return { outcome: "synchronized" as const };
      }),
    },
    events: recorder,
  };
}
describe("PrepareMachineShutdownOccurrence", () => {
  it("reads execute clock once, uses prepareAt without clock reads, and returns not_required for approved readiness", async () => {
    const clock = { now: vi.fn(() => new Date(at)) };
    const evaluated = evaluator(["confirmed"]);
    const log: string[] = [];
    const preparation = new PrepareMachineShutdownOccurrence(
      clock,
      evaluated.readiness,
      controllers(log),
    );
    const result = await preparation.execute(occurrence);
    expect(result.outcome).toBe("not_required");
    expect(clock.now).toHaveBeenCalledTimes(1);
    expect(log).toEqual([]);
    expect(evaluated.calls.confirmations).toBe(1);
  });

  it("blocks non-preparable and mixed blockers without events or effects", async () => {
    const evaluated = evaluator(["confirmed"]);
    const log: string[] = [];
    const recorder = new InMemoryMachineShutdownPreparationEventRecorder();
    const preparation = new PrepareMachineShutdownOccurrence(
      { now: vi.fn(() => new Date(at)) },
      evaluated.readiness,
      controllers(log, recorder),
    );
    const result = await preparation.prepareAt(
      occurrence,
      at,
      initial([
        { area: "services", code: "service_running", serviceId: "api" },
        {
          area: "services",
          code: "service_required_during_offline_interval",
          serviceId: "api",
        },
      ]),
    );
    expect(result.outcome).toBe("blocked");
    expect(result.events).toEqual([]);
    expect(log).toEqual([]);
    expect(recorder.events).toEqual([]);
  });

  it("executes all preparation areas in order, records every effect before the next, and reevaluates with fresh confirmation", async () => {
    const evaluated = evaluator(["confirmed", "confirmed"]);
    const log: string[] = [];
    const preparation = new PrepareMachineShutdownOccurrence(
      { now: vi.fn(() => new Date(at)) },
      evaluated.readiness,
      controllers(log),
    );
    const result = await preparation.prepareAt(
      occurrence,
      at,
      initial([
        { area: "services", code: "service_running", serviceId: "api" },
        {
          area: "active_tasks",
          code: "active_tasks_present",
          activeTaskCount: 2,
        },
        { area: "backups", code: "backup_in_progress" },
        { area: "filesystem", code: "filesystem_sync_required" },
      ]),
    );
    expect(result.outcome).toBe("prepared");
    expect(log).toEqual([
      "services:2026-08-03T21:00:00.000Z:api",
      "tasks",
      "backup",
      "filesystem",
    ]);
    expect(result.events.map((event) => event.kind)).toEqual([
      "preparation_started",
      "services_prepared",
      "active_tasks_prepared",
      "backup_prepared",
      "filesystem_prepared",
      "preparation_completed",
      "final_readiness_approved",
    ]);
    expect(result.steps.map((step) => step.kind)).toEqual([
      "stop_registered_services",
      "drain_active_tasks",
      "complete_backup",
      "synchronize_filesystem",
      "record_preparation_completed",
      "reevaluate_readiness",
      "record_final_readiness",
    ]);
    const serviceStep = result.steps[0];
    if (!serviceStep?.detail || !("serviceSteps" in serviceStep.detail))
      throw new Error("expected service preparation detail");
    expect(serviceStep.detail.serviceSteps).toEqual([
      { serviceId: "api", outcome: "stopped" },
    ]);
    expect(evaluated.calls.confirmations).toBe(1);
  });

  it("preserves partial effects and emits an incomplete report without claim/effect responsibility", async () => {
    const evaluated = evaluator(["confirmed"]);
    const log: string[] = [];
    const c = controllers(log);
    c.backup.complete.mockRejectedValueOnce(new Error("backup secret"));
    const preparation = new PrepareMachineShutdownOccurrence(
      { now: vi.fn(() => new Date(at)) },
      evaluated.readiness,
      c,
    );
    const result = await preparation.prepareAt(
      occurrence,
      at,
      initial([
        { area: "services", code: "service_running", serviceId: "api" },
        {
          area: "active_tasks",
          code: "active_tasks_present",
          activeTaskCount: 1,
        },
        { area: "backups", code: "backup_in_progress" },
      ]),
    );
    expect(result.outcome).toBe("incomplete");
    expect(log).toEqual(["services:2026-08-03T21:00:00.000Z:api", "tasks"]);
    expect(result.events.map((event) => event.kind)).toContain(
      "preparation_failed",
    );
    expect(result.events.map((event) => event)).not.toContainEqual(
      expect.objectContaining({ failureCode: "backup secret" }),
    );
  });

  it("preserves preparation effects when final confirmation is not renewed", async () => {
    const evaluated = evaluator(["not_confirmed", "not_confirmed"]);
    const log: string[] = [];
    const preparation = new PrepareMachineShutdownOccurrence(
      { now: vi.fn(() => new Date(at)) },
      evaluated.readiness,
      controllers(log),
    );
    const result = await preparation.prepareAt(
      occurrence,
      at,
      initial([
        {
          area: "active_tasks",
          code: "active_tasks_present",
          activeTaskCount: 1,
        },
      ]),
    );
    expect(result.outcome).toBe("incomplete");
    expect(result.finalDecision?.blockers).toEqual([
      { area: "confirmation", code: "not_confirmed" },
    ]);
    expect(result.events.at(-1)?.kind).toBe("final_readiness_rejected");
    expect(log).toEqual(["tasks"]);
  });

  it("allows a later explicit attempt to reuse the same recorder and timestamp", async () => {
    const evaluated = evaluator(["confirmed", "confirmed", "confirmed"]);
    const log: string[] = [];
    const c = controllers(log);
    c.tasks.drain.mockRejectedValueOnce(new Error("temporary task failure"));
    const preparation = new PrepareMachineShutdownOccurrence(
      { now: vi.fn(() => new Date(at)) },
      evaluated.readiness,
      c,
    );
    const initialDecision = initial([
      {
        area: "active_tasks",
        code: "active_tasks_present",
        activeTaskCount: 1,
      },
    ]);
    const first = await preparation.prepareAt(occurrence, at, initialDecision);
    const second = await preparation.prepareAt(occurrence, at, initialDecision);
    expect(first.outcome).toBe("incomplete");
    expect(second.outcome).toBe("prepared");
    expect(second.events[0]?.sequence).toBe(1);
    expect(c.tasks.drain).toHaveBeenCalledTimes(2);
  });

  it("preserves final readiness when its approval event cannot be recorded", async () => {
    const evaluated = evaluator(["confirmed", "confirmed"]);
    const log: string[] = [];
    const preparation = new PrepareMachineShutdownOccurrence(
      { now: vi.fn(() => new Date(at)) },
      evaluated.readiness,
      controllers(log, new InMemoryMachineShutdownPreparationEventRecorder(4)),
    );
    const result = await preparation.prepareAt(
      occurrence,
      at,
      initial([
        {
          area: "active_tasks",
          code: "active_tasks_present",
          activeTaskCount: 1,
        },
      ]),
    );
    expect(result.outcome).toBe("incomplete");
    expect(result.finalDecision?.outcome).toBe("approved");
    expect(result.events.at(-1)?.kind).toBe("preparation_failed");
  });

  it("stops immediately when the start event cannot be recorded", async () => {
    const evaluated = evaluator(["confirmed"]);
    const log: string[] = [];
    const recorder = new InMemoryMachineShutdownPreparationEventRecorder(1);
    const preparation = new PrepareMachineShutdownOccurrence(
      { now: vi.fn(() => new Date(at)) },
      evaluated.readiness,
      controllers(log, recorder),
    );
    const result = await preparation.prepareAt(
      occurrence,
      at,
      initial([
        {
          area: "active_tasks",
          code: "active_tasks_present",
          activeTaskCount: 1,
        },
      ]),
    );
    expect(result.outcome).toBe("incomplete");
    expect(log).toEqual([]);
    expect(result.steps).toEqual([]);
  });

  it("preserves a completed service effect when its completion event fails", async () => {
    const evaluated = evaluator(["confirmed"]);
    const log: string[] = [];
    const recorder = new InMemoryMachineShutdownPreparationEventRecorder(2);
    const preparation = new PrepareMachineShutdownOccurrence(
      { now: vi.fn(() => new Date(at)) },
      evaluated.readiness,
      controllers(log, recorder),
    );
    const result = await preparation.prepareAt(
      occurrence,
      at,
      initial([
        { area: "services", code: "service_running", serviceId: "api" },
      ]),
    );
    expect(result.outcome).toBe("incomplete");
    expect(log).toEqual(["services:2026-08-03T21:00:00.000Z:api"]);
    expect(result.events.map((event) => event.kind)).toEqual([
      "preparation_started",
      "preparation_failed",
    ]);
  });
});
