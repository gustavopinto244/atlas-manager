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

  it("falls back to the environment-owned base policy when nothing is persisted", async () => {
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

    await expect(catalog.findById("task-manager")).resolves.toMatchObject({
      availabilityPolicy: { mode: "manual" },
    });
  });

  it("replaces rather than merges the base policy: a persisted mode change drops base-only fields", async () => {
    const service = RegisteredService.create({
      id: "task-manager",
      displayName: "Task Manager",
      managementAdapter: "mock",
      externalResourceId: "task-manager",
      supportedOperations: ["readStatus"],
      availabilityPolicy: {
        mode: "scheduled",
        timezone: "America/Sao_Paulo",
        windows: [{ weekday: "monday", start: "09:00", end: "17:00" }],
      },
    });
    const source = InMemoryRegisteredServiceCatalog.create([service]);
    const policies = new InMemoryServiceAvailabilityPolicyStore();
    const catalog = new PolicyAwareRegisteredServiceCatalog(source, policies);

    await policies.save("task-manager", {
      mode: "always",
      timezone: null,
      schedule: null,
    });

    const resolved = await catalog.findById("task-manager");
    expect(resolved?.availabilityPolicy).toEqual({
      mode: "always",
      timezone: null,
      schedule: null,
    });
  });

  it("applies the same precedence through list() as through findById()", async () => {
    const withoutOverride = RegisteredService.create({
      id: "without-override",
      displayName: "Without override",
      managementAdapter: "mock",
      externalResourceId: "x",
      supportedOperations: ["readStatus"],
      availabilityPolicy: { mode: "manual" },
    });
    const withOverride = RegisteredService.create({
      id: "with-override",
      displayName: "With override",
      managementAdapter: "mock",
      externalResourceId: "y",
      supportedOperations: ["readStatus"],
      availabilityPolicy: { mode: "manual" },
    });
    const source = InMemoryRegisteredServiceCatalog.create([
      withoutOverride,
      withOverride,
    ]);
    const policies = new InMemoryServiceAvailabilityPolicyStore();
    const catalog = new PolicyAwareRegisteredServiceCatalog(source, policies);

    await policies.save("with-override", {
      mode: "always",
      timezone: null,
      schedule: null,
    });

    const listed = await catalog.list();
    const listedById = new Map(listed.map((s) => [s.id, s]));
    expect(listedById.get("without-override")?.availabilityPolicy).toEqual({
      mode: "manual",
      timezone: null,
      schedule: null,
    });
    expect(listedById.get("with-override")?.availabilityPolicy).toEqual({
      mode: "always",
      timezone: null,
      schedule: null,
    });
  });
});
