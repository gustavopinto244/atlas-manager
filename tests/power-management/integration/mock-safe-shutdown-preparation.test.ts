import { describe, expect, it, vi } from "vitest";
import { createPowerManagement } from "../../../src/power-management/composition/create-power-management.js";
import { InMemoryMachineShutdownPreparationEventRecorder } from "../../../src/power-management/infrastructure/in-memory-machine-shutdown-preparation-event-recorder.js";
import { createMachineShutdownResult } from "../../../src/power-management/domain/machine-shutdown-result.js";
import { createWakeAlarmMutationResult } from "../../../src/power-management/domain/wake-alarm-mutation-result.js";
import { createRegisteredServicesStopResult } from "../../../src/service-management/domain/registered-services-stop-result.js";
const occurrence = {
  operation: "shutdown" as const,
  scheduledFor: "2026-08-03T21:00:00.000Z",
  wakeScheduledFor: "2026-08-04T12:00:00.000Z",
};
const at = occurrence.scheduledFor;
function serviceReader(blocked: boolean) {
  let calls = 0;
  return {
    reader: {
      read: vi.fn(async () => {
        calls += 1;
        return calls === 1 && blocked
          ? {
              state: "blocked" as const,
              blockers: [
                {
                  area: "services" as const,
                  code: "service_running" as const,
                  serviceId: "api",
                },
                {
                  area: "services" as const,
                  code: "service_running" as const,
                  serviceId: "worker",
                },
              ],
            }
          : { state: "ready" as const, blockers: [] as const };
      }),
    },
    get calls() {
      return calls;
    },
  };
}
function areaReader(
  area: "active_tasks" | "backups" | "filesystem",
  blocked: boolean,
) {
  let calls = 0;
  return {
    reader: {
      read: vi.fn(async () => {
        calls += 1;
        if (calls === 1 && blocked)
          return area === "active_tasks"
            ? { area, state: "blocked" as const, activeTaskCount: 1 }
            : area === "backups"
              ? {
                  area,
                  state: "blocked" as const,
                  reason: "backup_in_progress" as const,
                }
              : {
                  area,
                  state: "blocked" as const,
                  reason: "filesystem_sync_required" as const,
                };
        return { area, state: "ready" as const };
      }),
    },
    get calls() {
      return calls;
    },
  };
}
function readyReaders(
  confirmations: readonly ("confirmed" | "not_confirmed")[],
  blocked = false,
) {
  const services = serviceReader(blocked);
  const tasks = areaReader("active_tasks", blocked);
  const backups = areaReader("backups", blocked);
  const filesystem = areaReader("filesystem", blocked);
  let confirmationCalls = 0;
  return {
    services,
    tasks,
    backups,
    filesystem,
    confirmation: {
      read: vi.fn(
        async () => confirmations[confirmationCalls++] ?? "confirmed",
      ),
    },
    confirmationCalls: () => confirmationCalls,
  };
}
function controls(log: string[]) {
  return {
    service: {
      prepare: vi.fn(
        async (input: {
          occurrence: typeof occurrence;
          serviceIds: readonly string[];
          requestedAt: string;
        }) => {
          log.push("services");
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
  };
}
describe("mock safe-shutdown preparation integration", () => {
  it("executes an already-ready occurrence without preparation events", async () => {
    const r = readyReaders(["confirmed"]);
    const log: string[] = [];
    const c = controls(log);
    const recorder = new InMemoryMachineShutdownPreparationEventRecorder();
    const wake = createWakeAlarmMutationResult({
      operation: "schedule",
      requestedAt: at,
      outcome: "scheduled",
      before: { state: "not_scheduled" },
      after: { state: "scheduled", scheduledFor: occurrence.wakeScheduledFor },
    });
    const shutdown = createMachineShutdownResult({
      operation: "shutdown",
      requestedAt: at,
      outcome: "simulated",
    });
    const capabilities = createPowerManagement({
      clock: { now: vi.fn(() => new Date(at)) },
      machineShutdownConfirmationReader: r.confirmation,
      machineShutdownServiceReadinessReader: r.services.reader,
      machineShutdownActiveTaskReadinessReader: r.tasks.reader,
      machineShutdownBackupReadinessReader: r.backups.reader,
      machineShutdownFilesystemReadinessReader: r.filesystem.reader,
      machineShutdownEventRecordingReadinessReader: {
        read: vi.fn(async () => ({
          area: "event_recording" as const,
          state: "ready" as const,
        })),
      },
      machineShutdownPreparationEventRecorder: recorder,
      machineShutdownServicePreparationController: c.service,
      machineShutdownActiveTaskDrainController: c.tasks,
      machineShutdownBackupCompletionController: c.backup,
      machineShutdownFilesystemSynchronizationController: c.filesystem,
      wakeAlarmController: {
        schedule: vi.fn(async () => wake),
        cancel: vi.fn(),
      },
      machineShutdownController: {
        requestShutdown: vi.fn(async () => shutdown),
      },
    });
    const result =
      await capabilities.executeMachineShutdownOccurrence.execute(occurrence);
    expect(result.outcome).toBe("executed");
    expect(
      "preparationReport" in result
        ? result.preparationReport.outcome
        : undefined,
    ).toBe("not_required");
    expect(log).toEqual([]);
    expect(recorder.events).toEqual([]);
  });

  it("prepares services, tasks, backup, and filesystem before wake and shutdown", async () => {
    const r = readyReaders(["confirmed", "confirmed"], true);
    const log: string[] = [];
    const c = controls(log);
    const shutdown = vi.fn(async () =>
      createMachineShutdownResult({
        operation: "shutdown",
        requestedAt: at,
        outcome: "simulated",
      }),
    );
    const wake = vi.fn(async () =>
      createWakeAlarmMutationResult({
        operation: "schedule",
        requestedAt: at,
        outcome: "scheduled",
        before: { state: "not_scheduled" },
        after: {
          state: "scheduled",
          scheduledFor: occurrence.wakeScheduledFor,
        },
      }),
    );
    const capabilities = createPowerManagement({
      clock: { now: vi.fn(() => new Date(at)) },
      machineShutdownConfirmationReader: r.confirmation,
      machineShutdownServiceReadinessReader: r.services.reader,
      machineShutdownActiveTaskReadinessReader: r.tasks.reader,
      machineShutdownBackupReadinessReader: r.backups.reader,
      machineShutdownFilesystemReadinessReader: r.filesystem.reader,
      machineShutdownEventRecordingReadinessReader: {
        read: vi.fn(async () => ({
          area: "event_recording" as const,
          state: "ready" as const,
        })),
      },
      machineShutdownPreparationEventRecorder:
        new InMemoryMachineShutdownPreparationEventRecorder(),
      machineShutdownServicePreparationController: c.service,
      machineShutdownActiveTaskDrainController: c.tasks,
      machineShutdownBackupCompletionController: c.backup,
      machineShutdownFilesystemSynchronizationController: c.filesystem,
      wakeAlarmController: { schedule: wake, cancel: vi.fn() },
      machineShutdownController: { requestShutdown: shutdown },
    });
    const result =
      await capabilities.executeMachineShutdownOccurrence.execute(occurrence);
    expect(result.outcome).toBe("executed");
    expect(
      "preparationReport" in result
        ? result.preparationReport.outcome
        : undefined,
    ).toBe("prepared");
    expect(log).toEqual(["services", "tasks", "backup", "filesystem"]);
    expect(wake).toHaveBeenCalledBefore(shutdown);
    expect(r.confirmationCalls()).toBe(2);
  });

  it("blocks a mixed service-running and service-required decision without stopping anything", async () => {
    const confirmation = { read: vi.fn(async () => "confirmed" as const) };
    const services = {
      read: vi.fn(async () => ({
        state: "blocked" as const,
        blockers: [
          {
            area: "services" as const,
            code: "service_running" as const,
            serviceId: "api",
          },
          {
            area: "services" as const,
            code: "service_required_during_offline_interval" as const,
            serviceId: "api",
          },
        ],
      })),
    };
    const stop = vi.fn();
    const wake = vi.fn();
    const shutdown = vi.fn();
    const capabilities = createPowerManagement({
      clock: { now: vi.fn(() => new Date(at)) },
      machineShutdownConfirmationReader: confirmation,
      machineShutdownServiceReadinessReader: services,
      machineShutdownActiveTaskReadinessReader: { read: vi.fn() },
      machineShutdownBackupReadinessReader: { read: vi.fn() },
      machineShutdownFilesystemReadinessReader: { read: vi.fn() },
      machineShutdownEventRecordingReadinessReader: { read: vi.fn() },
      machineShutdownServicePreparationController: { prepare: stop },
      wakeAlarmController: { schedule: wake, cancel: vi.fn() },
      machineShutdownController: { requestShutdown: shutdown },
    });
    const result =
      await capabilities.executeMachineShutdownOccurrence.execute(occurrence);
    expect(result.outcome).toBe("rejected");
    expect(
      "preparationReport" in result
        ? result.preparationReport.outcome
        : undefined,
    ).toBe("blocked");
    expect(stop).not.toHaveBeenCalled();
    expect(wake).not.toHaveBeenCalled();
    expect(shutdown).not.toHaveBeenCalled();
  });

  it("preserves preparation effects when final confirmation is missing", async () => {
    const r = readyReaders(["confirmed", "not_confirmed"], true);
    const log: string[] = [];
    const c = controls(log);
    const wake = vi.fn();
    const shutdown = vi.fn();
    const capabilities = createPowerManagement({
      clock: { now: vi.fn(() => new Date(at)) },
      machineShutdownConfirmationReader: r.confirmation,
      machineShutdownServiceReadinessReader: r.services.reader,
      machineShutdownActiveTaskReadinessReader: r.tasks.reader,
      machineShutdownBackupReadinessReader: r.backups.reader,
      machineShutdownFilesystemReadinessReader: r.filesystem.reader,
      machineShutdownEventRecordingReadinessReader: {
        read: vi.fn(async () => ({
          area: "event_recording" as const,
          state: "ready" as const,
        })),
      },
      machineShutdownServicePreparationController: c.service,
      machineShutdownActiveTaskDrainController: c.tasks,
      machineShutdownBackupCompletionController: c.backup,
      machineShutdownFilesystemSynchronizationController: c.filesystem,
      wakeAlarmController: { schedule: wake, cancel: vi.fn() },
      machineShutdownController: { requestShutdown: shutdown },
    });
    const result =
      await capabilities.executeMachineShutdownOccurrence.execute(occurrence);
    expect(result.outcome).toBe("preparation_incomplete");
    expect(log).toEqual(["services", "tasks", "backup", "filesystem"]);
    expect(wake).not.toHaveBeenCalled();
    expect(shutdown).not.toHaveBeenCalled();
  });

  it("stops the preparation pipeline after a partial service failure", async () => {
    const r = readyReaders(["confirmed"], true);
    const log: string[] = [];
    const c = controls(log);
    c.service.prepare.mockImplementationOnce(async () => {
      log.push("services");
      return createRegisteredServicesStopResult({
        authority: "machine_shutdown",
        requestedAt: at,
        successful: false,
        steps: [
          { serviceId: "api", outcome: "stopped" },
          {
            serviceId: "worker",
            outcome: "failed",
            failureCode: "service_stop_failed",
          },
        ],
      });
    });
    const wake = vi.fn();
    const shutdown = vi.fn();
    const capabilities = createPowerManagement({
      clock: { now: vi.fn(() => new Date(at)) },
      machineShutdownConfirmationReader: r.confirmation,
      machineShutdownServiceReadinessReader: r.services.reader,
      machineShutdownActiveTaskReadinessReader: r.tasks.reader,
      machineShutdownBackupReadinessReader: r.backups.reader,
      machineShutdownFilesystemReadinessReader: r.filesystem.reader,
      machineShutdownEventRecordingReadinessReader: {
        read: vi.fn(async () => ({
          area: "event_recording" as const,
          state: "ready" as const,
        })),
      },
      machineShutdownServicePreparationController: c.service,
      machineShutdownActiveTaskDrainController: c.tasks,
      machineShutdownBackupCompletionController: c.backup,
      machineShutdownFilesystemSynchronizationController: c.filesystem,
      wakeAlarmController: { schedule: wake, cancel: vi.fn() },
      machineShutdownController: { requestShutdown: shutdown },
    });
    const result =
      await capabilities.executeMachineShutdownOccurrence.execute(occurrence);
    expect(result.outcome).toBe("preparation_incomplete");
    expect(log).toEqual(["services"]);
    expect(wake).not.toHaveBeenCalled();
    expect(shutdown).not.toHaveBeenCalled();
  });

  it("preserves completed service effects when their event recording fails", async () => {
    const r = readyReaders(["confirmed"], true);
    const log: string[] = [];
    const c = controls(log);
    const wake = vi.fn();
    const shutdown = vi.fn();
    const capabilities = createPowerManagement({
      clock: { now: vi.fn(() => new Date(at)) },
      machineShutdownConfirmationReader: r.confirmation,
      machineShutdownServiceReadinessReader: r.services.reader,
      machineShutdownActiveTaskReadinessReader: r.tasks.reader,
      machineShutdownBackupReadinessReader: r.backups.reader,
      machineShutdownFilesystemReadinessReader: r.filesystem.reader,
      machineShutdownEventRecordingReadinessReader: {
        read: vi.fn(async () => ({
          area: "event_recording" as const,
          state: "ready" as const,
        })),
      },
      machineShutdownPreparationEventRecorder:
        new InMemoryMachineShutdownPreparationEventRecorder(2),
      machineShutdownServicePreparationController: c.service,
      machineShutdownActiveTaskDrainController: c.tasks,
      machineShutdownBackupCompletionController: c.backup,
      machineShutdownFilesystemSynchronizationController: c.filesystem,
      wakeAlarmController: { schedule: wake, cancel: vi.fn() },
      machineShutdownController: { requestShutdown: shutdown },
    });
    const result =
      await capabilities.executeMachineShutdownOccurrence.execute(occurrence);
    expect(result.outcome).toBe("preparation_incomplete");
    expect(log).toEqual(["services"]);
    expect(wake).not.toHaveBeenCalled();
    expect(shutdown).not.toHaveBeenCalled();
  });

  it("retries only the remaining preparation after a partial backup failure", async () => {
    let backupInProgress = true;
    let failBackupOnce = true;
    const backup = {
      complete: vi.fn(async () => {
        if (failBackupOnce) {
          failBackupOnce = false;
          return {
            outcome: "blocked" as const,
            reason: "backup_completion_failed" as const,
          };
        }
        backupInProgress = false;
        return { outcome: "completed" as const };
      }),
      read: vi.fn(async () =>
        backupInProgress
          ? {
              area: "backups" as const,
              state: "blocked" as const,
              reason: "backup_in_progress" as const,
            }
          : { area: "backups" as const, state: "ready" as const },
      ),
    };
    const recorder = new InMemoryMachineShutdownPreparationEventRecorder();
    const wake = vi.fn(async () =>
      createWakeAlarmMutationResult({
        operation: "schedule",
        requestedAt: at,
        outcome: "scheduled",
        before: { state: "not_scheduled" },
        after: {
          state: "scheduled",
          scheduledFor: occurrence.wakeScheduledFor,
        },
      }),
    );
    const shutdown = vi.fn(async () =>
      createMachineShutdownResult({
        operation: "shutdown",
        requestedAt: at,
        outcome: "simulated",
      }),
    );
    const capabilities = createPowerManagement({
      clock: { now: vi.fn(() => new Date(at)) },
      machineShutdownConfirmationReader: {
        read: vi.fn(async () => "confirmed" as const),
      },
      machineShutdownServiceReadinessReader: {
        read: vi.fn(async () => ({
          state: "ready" as const,
          blockers: [] as const,
        })),
      },
      machineShutdownActiveTaskReadinessReader: {
        read: vi.fn(async () => ({
          area: "active_tasks" as const,
          state: "ready" as const,
        })),
      },
      machineShutdownBackupReadinessReader: backup,
      machineShutdownFilesystemReadinessReader: {
        read: vi.fn(async () => ({
          area: "filesystem" as const,
          state: "ready" as const,
        })),
      },
      machineShutdownEventRecordingReadinessReader: {
        read: vi.fn(async () => ({
          area: "event_recording" as const,
          state: "ready" as const,
        })),
      },
      machineShutdownBackupCompletionController: backup,
      machineShutdownPreparationEventRecorder: recorder,
      wakeAlarmController: { schedule: wake, cancel: vi.fn() },
      machineShutdownController: { requestShutdown: shutdown },
    });
    const first =
      await capabilities.executeMachineShutdownOccurrence.execute(occurrence);
    const second =
      await capabilities.executeMachineShutdownOccurrence.execute(occurrence);
    expect(first.outcome).toBe("preparation_incomplete");
    expect(second.outcome).toBe("executed");
    expect(backup.complete).toHaveBeenCalledTimes(2);
    expect(wake).toHaveBeenCalledOnce();
    expect(shutdown).toHaveBeenCalledOnce();
  });
});
