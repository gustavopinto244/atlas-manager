import { describe, expect, it } from "vitest";

import { RegisteredService } from "../../../src/service-management/domain/registered-service.js";
import { InMemoryRegisteredServiceCatalog } from "../../../src/service-management/infrastructure/in-memory-registered-service-catalog.js";
import { InMemoryServiceAvailabilityPolicyStore } from "../../../src/service-management/infrastructure/in-memory-service-availability-policy-store.js";
import { PolicyAwareRegisteredServiceCatalog } from "../../../src/service-management/infrastructure/policy-aware-registered-service-catalog.js";

describe("PolicyAwareRegisteredServiceCatalog", () => {
  it("overlays persisted policies for every catalog consumer", async () => {
    const service = RegisteredService.create({
      id: "task-manager",
      displayName: "Task Manager",
      managementAdapter: "mock",
      externalResourceId: "task-manager",
      supportedOperations: ["readStatus"],
      availabilityPolicy: { mode: "manual" },
    });
    const source = InMemoryRegisteredServiceCatalog.create([service]);
    const policies = new InMemoryServiceAvailabilityPolicyStore();
    const catalog = new PolicyAwareRegisteredServiceCatalog(source, policies);

    await policies.save("task-manager", {
      mode: "always",
      timezone: null,
      schedule: null,
    });

    await expect(catalog.findById("task-manager")).resolves.toMatchObject({
      id: "task-manager",
      availabilityPolicy: { mode: "always" },
    });
    await expect(source.findById("task-manager")).resolves.toMatchObject({
      availabilityPolicy: { mode: "manual" },
    });
  });
});
