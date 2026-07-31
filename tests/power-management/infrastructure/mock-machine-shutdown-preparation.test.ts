import { describe, expect, it, vi } from "vitest";
import { InMemoryMachineShutdownPreparationEventRecorder } from "../../../src/power-management/infrastructure/in-memory-machine-shutdown-preparation-event-recorder.js";
import {
  MockMachineShutdownActiveTaskDrainController,
  MockMachineShutdownBackupCompletionController,
  MockMachineShutdownFilesystemSynchronizationController,
} from "../../../src/power-management/infrastructure/mock-machine-shutdown-preparation-controllers.js";
import { createMachineShutdownOccurrence } from "../../../src/power-management/domain/machine-shutdown-occurrence.js";
import { createMachineShutdownPreparationEvent } from "../../../src/power-management/domain/machine-shutdown-preparation-event.js";

const occurrence = createMachineShutdownOccurrence({
  operation: "shutdown",
  scheduledFor: "2026-08-03T21:00:00.000Z",
  wakeScheduledFor: "2026-08-04T12:00:00.000Z",
});
const at = "2026-08-03T21:00:00.000Z";
describe("mock shutdown preparation infrastructure", () => {
  it("transitions active tasks and reports idempotent completion", async () => {
    const controller = new MockMachineShutdownActiveTaskDrainController(
      "active",
    );
    await expect(controller.drain(occurrence, at)).resolves.toEqual({
      outcome: "drained",
    });
    await expect(controller.drain(occurrence, at)).resolves.toEqual({
      outcome: "already_drained",
    });
    expect(controller.calls).toBe(2);
    await expect(
      new MockMachineShutdownActiveTaskDrainController("blocked").drain(
        occurrence,
        at,
      ),
    ).resolves.toEqual({ outcome: "blocked", remainingTaskCount: 1 });
  });

  it("completes a backup once and then reports not_running", async () => {
    const controller = new MockMachineShutdownBackupCompletionController(
      "in_progress",
    );
    await expect(controller.complete(occurrence, at)).resolves.toEqual({
      outcome: "completed",
    });
    await expect(controller.complete(occurrence, at)).resolves.toEqual({
      outcome: "not_running",
    });
    await expect(
      new MockMachineShutdownBackupCompletionController("blocked").complete(
        occurrence,
        at,
      ),
    ).resolves.toEqual({
      outcome: "blocked",
      reason: "backup_completion_failed",
    });
  });

  it("synchronizes a filesystem once and never invokes an operating-system command", async () => {
    const controller =
      new MockMachineShutdownFilesystemSynchronizationController("required");
    await expect(controller.synchronize(occurrence, at)).resolves.toEqual({
      outcome: "synchronized",
    });
    await expect(controller.synchronize(occurrence, at)).resolves.toEqual({
      outcome: "already_synchronized",
    });
    await expect(
      new MockMachineShutdownFilesystemSynchronizationController(
        "blocked",
      ).synchronize(occurrence, at),
    ).resolves.toEqual({
      outcome: "blocked",
      reason: "filesystem_synchronization_failed",
    });
  });

  it("retains immutable event snapshots in sequence and rejects duplicates", async () => {
    const recorder = new InMemoryMachineShutdownPreparationEventRecorder();
    const first = createMachineShutdownPreparationEvent({
      sequence: 1,
      kind: "preparation_started",
      occurrence,
      occurredAt: at,
    });
    const second = createMachineShutdownPreparationEvent({
      sequence: 2,
      kind: "preparation_completed",
      occurrence,
      occurredAt: at,
    });
    await recorder.record(first);
    await recorder.record(second);
    expect(recorder.events).toEqual([first, second]);
    expect(Object.isFrozen(recorder.events)).toBe(true);
    await expect(recorder.record(first)).rejects.toThrow();
    await expect(recorder.record({ ...second, sequence: 4 })).rejects.toThrow();
  });

  it("supports controlled recorder rejection without external I/O", async () => {
    const recorder = new InMemoryMachineShutdownPreparationEventRecorder(2);
    await recorder.record(
      createMachineShutdownPreparationEvent({
        sequence: 1,
        kind: "preparation_started",
        occurrence,
        occurredAt: at,
      }),
    );
    await expect(
      recorder.record(
        createMachineShutdownPreparationEvent({
          sequence: 2,
          kind: "preparation_completed",
          occurrence,
          occurredAt: at,
        }),
      ),
    ).rejects.toThrow();
    expect(recorder.events).toHaveLength(1);
    expect(
      vi.isMockFunction((recorder as unknown as { write?: unknown }).write),
    ).toBe(false);
  });

  it("starts a new sequence after a terminal event while rejecting duplicates within an attempt", async () => {
    const recorder = new InMemoryMachineShutdownPreparationEventRecorder();
    await recorder.record(
      createMachineShutdownPreparationEvent({
        sequence: 1,
        kind: "preparation_started",
        occurrence,
        occurredAt: at,
      }),
    );
    await recorder.record(
      createMachineShutdownPreparationEvent({
        sequence: 2,
        kind: "preparation_failed",
        failedStep: "drain_active_tasks",
        failureCode: "active_tasks_present",
        occurrence,
        occurredAt: at,
      }),
    );
    await recorder.record(
      createMachineShutdownPreparationEvent({
        sequence: 1,
        kind: "preparation_started",
        occurrence,
        occurredAt: at,
      }),
    );
    await expect(
      recorder.record(
        createMachineShutdownPreparationEvent({
          sequence: 1,
          kind: "preparation_started",
          occurrence,
          occurredAt: at,
        }),
      ),
    ).rejects.toThrow();
    expect(recorder.events).toHaveLength(3);
  });
});
