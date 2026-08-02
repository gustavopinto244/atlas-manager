import { describe, expect, it, vi } from "vitest";

import { createPowerManagement } from "../../../src/power-management/composition/create-power-management.js";
import type { MachineShutdownController } from "../../../src/power-management/application/ports/machine-shutdown-controller.js";
import type { MachineShutdownServiceReadinessReader } from "../../../src/power-management/application/ports/machine-shutdown-readiness-readers.js";
import { createMachineShutdownResult } from "../../../src/power-management/domain/machine-shutdown-result.js";

describe("policy-bound machine power scheduler", () => {
  it("confirms and executes an exact scheduled occurrence through an explicit tick", async () => {
    const values = [
      "2026-08-03T20:00:00.000Z",
      "2026-08-03T21:00:00.000Z",
      "2026-08-03T21:00:00.000Z",
    ];
    const clock = { now: vi.fn(() => new Date(values.shift()!)) };
    const serviceReadiness: MachineShutdownServiceReadinessReader = {
      read: vi.fn(async () => ({
        state: "ready" as const,
        blockers: [] as const,
      })),
    };
    const requestShutdown = vi.fn(async (requestedAt: string) =>
      createMachineShutdownResult({
        operation: "shutdown",
        requestedAt,
        outcome: "simulated",
      }),
    );
    const shutdownController: MachineShutdownController = { requestShutdown };
    const capabilities = createPowerManagement({
      clock,
      machineOperatingPolicy: {
        mode: "scheduled",
        timezone: "America/Sao_Paulo",
        weeklySchedule: {
          windows: [
            { dayOfWeek: "monday", start: "08:00", end: "18:00" },
            { dayOfWeek: "tuesday", start: "09:00", end: "17:00" },
          ],
        },
      },
      machineShutdownServiceReadinessReader: serviceReadiness,
      machineShutdownController: shutdownController,
    });

    await expect(
      capabilities.runMachinePowerSchedulerTick.execute(),
    ).resolves.toMatchObject({ kind: "initialized" });
    await expect(
      capabilities.runMachinePowerSchedulerTick.execute(),
    ).resolves.toMatchObject({
      kind: "advanced",
      report: {
        complete: true,
        occurrenceResults: [
          {
            kind: "completed",
            execution: { outcome: "executed" },
          },
        ],
      },
    });
    expect(requestShutdown).toHaveBeenCalledOnce();
    await expect(capabilities.getNextWakeAlarm.execute()).resolves.toEqual({
      observedAt: "2026-08-03T21:00:00.000Z",
      wakeAlarm: {
        state: "scheduled",
        scheduledFor: "2026-08-04T12:00:00.000Z",
      },
    });
  });
});
