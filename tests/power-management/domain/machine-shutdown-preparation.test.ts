import { describe, expect, it } from "vitest";
import { createMachineShutdownOccurrence } from "../../../src/power-management/domain/machine-shutdown-occurrence.js";
import { createMachineShutdownReadinessDecision } from "../../../src/power-management/domain/machine-shutdown-readiness-decision.js";
import { createMachineShutdownPreparationEvent } from "../../../src/power-management/domain/machine-shutdown-preparation-event.js";
import { createMachineShutdownPreparationPlan } from "../../../src/power-management/domain/machine-shutdown-preparation-plan.js";
import { createMachineShutdownPreparationReport } from "../../../src/power-management/domain/machine-shutdown-preparation-report.js";
import { createMachineShutdownPreparationStepResult } from "../../../src/power-management/domain/machine-shutdown-preparation-step-result.js";
import { createMachineShutdownOccurrenceExecutionResult } from "../../../src/power-management/domain/machine-shutdown-occurrence-execution-result.js";
import { createWakeAlarmMutationResult } from "../../../src/power-management/domain/wake-alarm-mutation-result.js";
import { createMachineShutdownResult } from "../../../src/power-management/domain/machine-shutdown-result.js";
import { createMachineShutdownPreparationPlan as planPreparation } from "../../../src/power-management/application/prepare-machine-shutdown-occurrence.js";

const occurrence = createMachineShutdownOccurrence({
  operation: "shutdown",
  scheduledFor: "2026-08-03T21:00:00.000Z",
  wakeScheduledFor: "2026-08-04T12:00:00.000Z",
});
const at = "2026-08-03T21:00:00.000Z";
function decision(blockers: readonly Record<string, unknown>[]) {
  return createMachineShutdownReadinessDecision({
    occurrence,
    evaluatedAt: at,
    outcome: blockers.length ? "rejected" : "approved",
    blockers,
  });
}

describe("machine shutdown preparation domain", () => {
  it("creates an immutable no-op plan for an approved decision", () => {
    const result = planPreparation({
      occurrence,
      processedAt: at,
      initialDecision: decision([]),
    });
    expect(result.outcome).toBe("planned");
    if (result.outcome !== "planned") throw new Error("expected plan");
    expect(result.plan.steps).toEqual([]);
    expect(result.plan.occurrence).toEqual(occurrence);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.plan.steps)).toBe(true);
  });

  it.each([
    ["service_running", "stop_registered_services"],
    ["active_tasks_present", "drain_active_tasks"],
    ["backup_in_progress", "complete_backup"],
    ["filesystem_sync_required", "synchronize_filesystem"],
  ] as const)("maps %s to its only required operation", (code, step) => {
    const result = planPreparation({
      occurrence,
      processedAt: at,
      initialDecision: decision([
        {
          area:
            code === "service_running"
              ? "services"
              : code === "active_tasks_present"
                ? "active_tasks"
                : code === "backup_in_progress"
                  ? "backups"
                  : "filesystem",
          code,
          ...(code === "service_running" ? { serviceId: "api" } : {}),
        },
      ]),
    });
    expect(result.outcome).toBe("planned");
    if (result.outcome !== "planned") throw new Error("expected plan");
    expect(result.plan.steps).toEqual([
      "record_preparation_started",
      step,
      "record_preparation_completed",
      "reevaluate_readiness",
      "record_final_readiness",
    ]);
  });

  it("orders all preparable operations canonically and does not duplicate them", () => {
    const result = planPreparation({
      occurrence,
      processedAt: at,
      initialDecision: decision([
        { area: "filesystem", code: "filesystem_sync_required" },
        { area: "backups", code: "backup_in_progress" },
        { area: "services", code: "service_running", serviceId: "api" },
        { area: "active_tasks", code: "active_tasks_present" },
        { area: "services", code: "service_running", serviceId: "api" },
      ]),
    });
    expect(result.outcome).toBe("planned");
    if (result.outcome !== "planned") throw new Error("expected plan");
    expect(result.plan.steps).toEqual([
      "record_preparation_started",
      "stop_registered_services",
      "drain_active_tasks",
      "complete_backup",
      "synchronize_filesystem",
      "record_preparation_completed",
      "reevaluate_readiness",
      "record_final_readiness",
    ]);
    expect(new Set(result.plan.steps).size).toBe(result.plan.steps.length);
  });

  it.each([
    "not_due",
    "stale",
    "not_confirmed",
    "confirmation_unavailable",
    "service_required_during_offline_interval",
    "service_failed",
    "service_state_unknown",
    "service_readiness_unavailable",
    "backup_state_unknown",
    "filesystem_state_unknown",
    "event_recording_unavailable",
    "readiness_dependency_failed",
  ] as const)("blocks all effects for non-preparable %s", (code) => {
    const result = planPreparation({
      occurrence,
      processedAt: at,
      initialDecision: decision([{ area: "services", code }]),
    });
    expect(result.outcome).toBe("blocked");
  });

  it("does not retain mutable caller inputs and rejects unknown plan fields or duplicate steps", () => {
    const input = {
      occurrence: { ...occurrence },
      plannedAt: at,
      initialDecision: decision([]),
      steps: [] as string[],
    };
    const result = createMachineShutdownPreparationPlan(input);
    input.steps.push("stop_registered_services");
    expect(result.steps).toEqual([]);
    expect(() =>
      createMachineShutdownPreparationPlan({ ...input, extra: true }),
    ).toThrow();
    expect(() =>
      createMachineShutdownPreparationPlan({
        occurrence,
        plannedAt: at,
        initialDecision: decision([]),
        steps: ["drain_active_tasks", "drain_active_tasks"],
      }),
    ).toThrow();
    expect(() =>
      createMachineShutdownPreparationPlan({
        occurrence,
        plannedAt: at,
        initialDecision: decision([
          { area: "active_tasks", code: "active_tasks_present" },
        ]),
        steps: [
          "drain_active_tasks",
          "record_preparation_started",
          "record_preparation_completed",
          "reevaluate_readiness",
          "record_final_readiness",
        ],
      }),
    ).toThrow();
  });

  it("validates events, step results, and reports as immutable narrow models", () => {
    const event = createMachineShutdownPreparationEvent({
      sequence: 1,
      kind: "preparation_started",
      occurrence,
      occurredAt: at,
    });
    const step = createMachineShutdownPreparationStepResult({
      kind: "drain_active_tasks",
      startedAt: at,
      completedAt: at,
      outcome: "completed",
    });
    const report = createMachineShutdownPreparationReport({
      occurrence,
      processedAt: at,
      initialDecision: decision([]),
      plan: createMachineShutdownPreparationPlan({
        occurrence,
        plannedAt: at,
        initialDecision: decision([]),
        steps: [],
      }),
      steps: [],
      events: [],
      outcome: "not_required",
    });
    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.isFrozen(step)).toBe(true);
    expect(Object.isFrozen(report)).toBe(true);
    expect(() =>
      createMachineShutdownPreparationEvent({ ...event, outcome: "raw-error" }),
    ).toThrow();
    expect(() =>
      createMachineShutdownPreparationStepResult({ ...step, extra: true }),
    ).toThrow();
    expect(() =>
      createMachineShutdownPreparationReport({
        ...report,
        outcome: "prepared",
      }),
    ).toThrow();
    const detailedStep = createMachineShutdownPreparationStepResult({
      kind: "stop_registered_services",
      startedAt: at,
      completedAt: at,
      outcome: "completed",
      detail: {
        serviceSteps: [{ serviceId: "api", outcome: "stopped" }],
      },
    });
    expect(Object.isFrozen(detailedStep.detail)).toBe(true);
    if (!detailedStep.detail || !("serviceSteps" in detailedStep.detail))
      throw new Error("expected service detail");
    expect(Object.isFrozen(detailedStep.detail.serviceSteps)).toBe(true);
    expect(Object.isFrozen(detailedStep.detail.serviceSteps[0])).toBe(true);
  });

  it("accepts all event kinds with only their narrow details", () => {
    const events = [
      { kind: "preparation_started" },
      { kind: "services_prepared", stoppedCount: 1, alreadyStoppedCount: 2 },
      { kind: "active_tasks_prepared", outcome: "drained" },
      { kind: "backup_prepared", outcome: "completed" },
      { kind: "filesystem_prepared", outcome: "synchronized" },
      { kind: "preparation_completed" },
      {
        kind: "preparation_failed",
        failedStep: "complete_backup",
        failureCode: "backup_completion_failed",
      },
      { kind: "final_readiness_approved" },
      { kind: "final_readiness_rejected", blockerCodes: ["not_confirmed"] },
    ].map((value, index) =>
      createMachineShutdownPreparationEvent({
        ...value,
        sequence: index + 1,
        occurrence,
        occurredAt: at,
      }),
    );
    expect(events).toHaveLength(9);
    expect(() =>
      createMachineShutdownPreparationEvent({
        sequence: 1,
        kind: "preparation_started",
        occurrence,
        occurredAt: at,
        metadata: {},
      }),
    ).toThrow();
    expect(() =>
      createMachineShutdownPreparationEvent({
        sequence: 1,
        kind: "services_prepared",
        occurrence,
        occurredAt: at,
        stoppedCount: 1,
      }),
    ).toThrow();
  });

  it("rejects machine effects paired with incomplete preparation", () => {
    const rejected = decision([
      { area: "active_tasks", code: "active_tasks_present" },
    ]);
    const planned = planPreparation({
      occurrence,
      processedAt: at,
      initialDecision: rejected,
    });
    if (planned.outcome !== "planned") throw new Error("expected plan");
    const incomplete = createMachineShutdownPreparationReport({
      occurrence,
      processedAt: at,
      initialDecision: rejected,
      plan: planned.plan,
      steps: [],
      events: [],
      outcome: "incomplete",
    });
    expect(() =>
      createMachineShutdownOccurrenceExecutionResult({
        occurrence,
        processedAt: at,
        outcome: "executed",
        preparationReport: incomplete,
        wakeAlarmMutation: createWakeAlarmMutationResult({
          operation: "schedule",
          requestedAt: at,
          outcome: "scheduled",
          before: { state: "not_scheduled" },
          after: {
            state: "scheduled",
            scheduledFor: occurrence.wakeScheduledFor,
          },
        }),
        shutdownResult: createMachineShutdownResult({
          operation: "shutdown",
          requestedAt: at,
          outcome: "simulated",
        }),
      }),
    ).toThrow();
  });
});
