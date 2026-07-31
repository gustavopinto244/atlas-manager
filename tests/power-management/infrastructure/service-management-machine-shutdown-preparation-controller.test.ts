import { describe, expect, it, vi } from "vitest";
import { ServiceManagementMachineShutdownPreparationController } from "../../../src/power-management/infrastructure/service-management-machine-shutdown-preparation-controller.js";
import { createMachineShutdownOccurrence } from "../../../src/power-management/domain/machine-shutdown-occurrence.js";
import { createRegisteredServicesStopResult } from "../../../src/service-management/domain/registered-services-stop-result.js";
const occurrence = createMachineShutdownOccurrence({
  operation: "shutdown",
  scheduledFor: "2026-08-03T21:00:00.000Z",
  wakeScheduledFor: "2026-08-04T12:00:00.000Z",
});
const at = occurrence.scheduledFor;
describe("service-management machine shutdown preparation adapter", () => {
  it("delegates only through the public batch stop capability with exact values", async () => {
    const execute = vi.fn(async (_input: unknown, requestedAt?: string) =>
      createRegisteredServicesStopResult({
        authority: "machine_shutdown",
        requestedAt: requestedAt!,
        successful: true,
        steps: [{ serviceId: "api", outcome: "stopped" }],
      }),
    );
    const adapter = new ServiceManagementMachineShutdownPreparationController({
      execute,
    });
    const result = await adapter.prepare({
      occurrence,
      requestedAt: at,
      serviceIds: ["api"],
    });
    expect(execute).toHaveBeenCalledWith(
      { serviceIds: ["api"], authority: "machine_shutdown" },
      at,
    );
    expect(result.steps[0]).toEqual({ serviceId: "api", outcome: "stopped" });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("does not translate or expose private service-management dependencies", async () => {
    const execute = vi
      .fn()
      .mockRejectedValue(new Error("private path and controller details"));
    const adapter = new ServiceManagementMachineShutdownPreparationController({
      execute,
    });
    await expect(
      adapter.prepare({
        occurrence,
        requestedAt: at,
        serviceIds: ["api", "api"],
      }),
    ).rejects.toMatchObject({ code: "service_preparation_failed" });
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
