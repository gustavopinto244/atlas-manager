import { describe, expect, it } from "vitest";

import { UpdateRegisteredServiceAvailabilityPolicy } from "../../../src/service-management/application/update-registered-service-availability-policy.js";
import { InMemoryRegisteredServiceCatalog } from "../../../src/service-management/infrastructure/in-memory-registered-service-catalog.js";
import { InMemoryServiceAvailabilityPolicyStore } from "../../../src/service-management/infrastructure/in-memory-service-availability-policy-store.js";
import { RegisteredService } from "../../../src/service-management/domain/registered-service.js";

function createService() {
  return RegisteredService.create({
    id: "task-manager",
    displayName: "Task Manager",
    managementAdapter: "mock",
    externalResourceId: "task-manager",
    supportedOperations: ["readStatus"],
    availabilityPolicy: { mode: "manual" },
  });
}

describe("UpdateRegisteredServiceAvailabilityPolicy", () => {
  it("validates and persists the base policy separately from overrides", async () => {
    const catalog = InMemoryRegisteredServiceCatalog.create([createService()]);
    const store = new InMemoryServiceAvailabilityPolicyStore();
    const useCase = new UpdateRegisteredServiceAvailabilityPolicy(
      catalog,
      store,
    );

    const policy = await useCase.execute("task-manager", {
      mode: "scheduled",
      timezone: "America/Sao_Paulo",
      windows: [{ weekday: "monday", start: "08:00", end: "18:00" }],
    });

    expect(policy).toMatchObject({ mode: "scheduled" });
    await expect(store.findByServiceId("task-manager")).resolves.toEqual(
      policy,
    );
  });

  it("rejects an unknown service before validating or persisting", async () => {
    const catalog = InMemoryRegisteredServiceCatalog.create([]);
    const store = new InMemoryServiceAvailabilityPolicyStore();
    const useCase = new UpdateRegisteredServiceAvailabilityPolicy(
      catalog,
      store,
    );

    await expect(
      useCase.execute("missing", { mode: "always" }),
    ).rejects.toThrow("Registered service not found");
    await expect(store.findByServiceId("missing")).resolves.toBeNull();
  });
});
