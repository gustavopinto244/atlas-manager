import { describe, expect, it, vi } from "vitest";
import { ServiceManagementMachineShutdownReadinessReader } from "../../../src/power-management/infrastructure/service-management-machine-shutdown-readiness-reader.js";

const occurrence = {
  operation: "shutdown" as const,
  scheduledFor: "2026-08-03T21:00:00.000Z",
  wakeScheduledFor: "2026-08-04T12:00:00.000Z",
};
describe("service-management machine shutdown readiness adapter", () => {
  it("orders services canonically and preserves schedule and runtime blockers", async () => {
    const list = vi.fn(async () => [{ id: "z-service" }, { id: "a-service" }]);
    const availability = vi.fn(async ({ serviceId }: { serviceId: string }) =>
      serviceId === "a-service"
        ? {
            outcome: "required" as const,
            firstRequiredAt: occurrence.scheduledFor,
          }
        : { outcome: "not_required" as const },
    );
    const status = vi.fn(async (serviceId: string) => ({
      serviceId,
      state:
        serviceId === "z-service" ? ("running" as const) : ("stopped" as const),
    }));
    const reader = new ServiceManagementMachineShutdownReadinessReader({
      listRegisteredServices: { execute: list },
      getRegisteredServiceAvailabilityForInterval: { execute: availability },
      getRegisteredServiceStatus: { execute: status },
    });
    const result = await reader.read(occurrence, occurrence.scheduledFor);
    expect(result).toMatchObject({
      state: "blocked",
      blockers: [
        {
          serviceId: "a-service",
          code: "service_required_during_offline_interval",
        },
        { serviceId: "z-service", code: "service_running" },
      ],
    });
    expect(list).toHaveBeenCalledOnce();
    expect(availability).toHaveBeenCalledTimes(2);
    expect(status).toHaveBeenCalledTimes(2);
  });
});
