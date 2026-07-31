import { describe, expect, it, vi } from "vitest";
import { createPowerManagement } from "../../../src/power-management/composition/create-power-management.js";
import { InMemoryMachineShutdownPreparationEventRecorder } from "../../../src/power-management/infrastructure/in-memory-machine-shutdown-preparation-event-recorder.js";
import {
  MockMachineShutdownActiveTaskDrainController,
  MockMachineShutdownBackupCompletionController,
  MockMachineShutdownFilesystemSynchronizationController,
} from "../../../src/power-management/infrastructure/mock-machine-shutdown-preparation-controllers.js";
const keys = [
  "getRtcInformation",
  "getNextWakeAlarm",
  "scheduleWakeAlarm",
  "cancelWakeAlarm",
  "getMachinePowerPlan",
  "planNextMachineShutdownOccurrence",
  "executeMachineShutdownOccurrence",
  "runMachinePowerSchedulerTick",
  "evaluateMachineShutdownReadiness",
  "prepareMachineShutdownOccurrence",
  "requestMachineShutdown",
];
const occurrence = {
  operation: "shutdown" as const,
  scheduledFor: "2026-08-03T21:00:00.000Z",
  wakeScheduledFor: "2026-08-04T12:00:00.000Z",
};
describe("mock safe-shutdown preparation composition", () => {
  it("exposes exactly eleven frozen stable capabilities and performs no construction work", () => {
    const clock = { now: vi.fn(() => new Date(occurrence.scheduledFor)) };
    const recorder = new InMemoryMachineShutdownPreparationEventRecorder();
    const capabilities = createPowerManagement({
      clock,
      machineShutdownPreparationEventRecorder: recorder,
      machineShutdownActiveTaskDrainController:
        new MockMachineShutdownActiveTaskDrainController(),
      machineShutdownBackupCompletionController:
        new MockMachineShutdownBackupCompletionController(),
      machineShutdownFilesystemSynchronizationController:
        new MockMachineShutdownFilesystemSynchronizationController(),
    });
    expect(Object.keys(capabilities)).toEqual(keys);
    expect(Object.isFrozen(capabilities)).toBe(true);
    expect(capabilities.prepareMachineShutdownOccurrence).toBe(
      capabilities.prepareMachineShutdownOccurrence,
    );
    expect(capabilities.executeMachineShutdownOccurrence).toBe(
      capabilities.executeMachineShutdownOccurrence,
    );
    expect(clock.now).not.toHaveBeenCalled();
    expect(recorder.events).toEqual([]);
  });

  it("uses the safe defaults and no preparation effect without explicit confirmation", async () => {
    const clock = { now: vi.fn(() => new Date(occurrence.scheduledFor)) };
    const capabilities = createPowerManagement({ clock });
    const result =
      await capabilities.executeMachineShutdownOccurrence.execute(occurrence);
    expect(result.outcome).toBe("rejected");
    expect("decision" in result ? result.decision.blockers : []).toEqual([
      { area: "confirmation", code: "not_confirmed" },
    ]);
  });

  it("shares default mock operational state with final readiness", async () => {
    const clock = { now: vi.fn(() => new Date(occurrence.scheduledFor)) };
    const capabilities = createPowerManagement({
      clock,
      machineShutdownConfirmationReader: {
        read: vi.fn(async () => "confirmed" as const),
      },
      machineShutdownServiceReadinessReader: {
        read: vi.fn(async () => ({
          state: "ready" as const,
          blockers: [] as const,
        })),
      },
      machineShutdownEventRecordingReadinessReader: {
        read: vi.fn(async () => ({
          area: "event_recording" as const,
          state: "ready" as const,
        })),
      },
      mockMachineShutdownActiveTaskState: "active",
      mockMachineShutdownBackupState: "in_progress",
      mockMachineShutdownFilesystemState: "required",
    });
    const result =
      await capabilities.executeMachineShutdownOccurrence.execute(occurrence);
    expect(result.outcome).toBe("executed");
    expect(
      "preparationReport" in result
        ? result.preparationReport.outcome
        : undefined,
    ).toBe("prepared");
  });
});
