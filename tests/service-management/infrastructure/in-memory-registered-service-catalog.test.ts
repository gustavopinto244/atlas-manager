import { describe, expect, it } from "vitest";

import { RegisteredService } from "../../../src/service-management/domain/registered-service.js";
import {
  InMemoryRegisteredServiceCatalog,
  RegisteredServiceCatalogError,
  type RegisteredServiceCatalogErrorCode,
} from "../../../src/service-management/infrastructure/in-memory-registered-service-catalog.js";

interface ServiceOverrides {
  readonly displayName?: string;
  readonly managementAdapter?: "mock" | "pm2";
  readonly externalResourceId?: string;
}

function createService(
  id: string,
  overrides: ServiceOverrides = {},
): RegisteredService {
  return RegisteredService.create({
    id,
    displayName: overrides.displayName ?? id,
    managementAdapter: overrides.managementAdapter ?? "mock",
    externalResourceId: overrides.externalResourceId ?? id,
    supportedOperations: ["readStatus"],
  });
}

function expectCatalogError(
  services: readonly RegisteredService[],
  code: RegisteredServiceCatalogErrorCode,
): void {
  expect(() => InMemoryRegisteredServiceCatalog.create(services)).toThrowError(
    expect.objectContaining({
      name: "RegisteredServiceCatalogError",
      code,
    }),
  );
}

describe("InMemoryRegisteredServiceCatalog", () => {
  it("accepts and lists an empty catalog", async () => {
    const catalog = InMemoryRegisteredServiceCatalog.create([]);

    await expect(catalog.list()).resolves.toEqual([]);
  });

  it("lists a catalog containing one service", async () => {
    const service = createService("task-manager");
    const catalog = InMemoryRegisteredServiceCatalog.create([service]);

    await expect(catalog.list()).resolves.toEqual([service]);
  });

  it("preserves registration order across repeated listings", async () => {
    const firstService = createService("first-service");
    const secondService = createService("second-service", {
      managementAdapter: "pm2",
    });
    const thirdService = createService("third-service");
    const catalog = InMemoryRegisteredServiceCatalog.create([
      firstService,
      secondService,
      thirdService,
    ]);

    const firstListing = await catalog.list();
    const secondListing = await catalog.list();

    expect(firstListing).toEqual([firstService, secondService, thirdService]);
    expect(secondListing).toEqual(firstListing);
  });

  it("lists PM2 and mock services together", async () => {
    const mockService = createService("mock-service");
    const pm2Service = createService("pm2-service", {
      managementAdapter: "pm2",
    });
    const catalog = InMemoryRegisteredServiceCatalog.create([
      mockService,
      pm2Service,
    ]);

    await expect(catalog.list()).resolves.toEqual([mockService, pm2Service]);
  });

  it("finds the first and a later registered service by exact identifier", async () => {
    const firstService = createService("first-service");
    const secondService = createService("second-service");
    const catalog = InMemoryRegisteredServiceCatalog.create([
      firstService,
      secondService,
    ]);

    await expect(catalog.findById("first-service")).resolves.toBe(firstService);
    await expect(catalog.findById("second-service")).resolves.toBe(
      secondService,
    );
  });

  it("returns null for unknown identifiers in an empty catalog", async () => {
    const catalog = InMemoryRegisteredServiceCatalog.create([]);

    await expect(catalog.findById("unknown-service")).resolves.toBeNull();
  });

  it.each(["Task-manager", " task-manager", "task-manager "])(
    "does not normalize a lookup identifier: %s",
    async (serviceId) => {
      const service = createService("task-manager");
      const catalog = InMemoryRegisteredServiceCatalog.create([service]);

      await expect(catalog.findById(serviceId)).resolves.toBeNull();
      await expect(catalog.list()).resolves.toEqual([service]);
    },
  );

  it("rejects duplicate stable service identifiers", () => {
    const duplicateId = "task-manager";

    expectCatalogError(
      [
        createService(duplicateId, { externalResourceId: "first-target" }),
        createService(duplicateId, {
          managementAdapter: "pm2",
          externalResourceId: "second-target",
        }),
      ],
      "duplicate_service_id",
    );
  });

  it.each(["pm2", "mock"] as const)(
    "rejects duplicate %s external resource targets",
    (managementAdapter) => {
      const externalResourceId = "shared-target";

      expectCatalogError(
        [
          createService("first-service", {
            managementAdapter,
            externalResourceId,
          }),
          createService("second-service", {
            managementAdapter,
            externalResourceId,
          }),
        ],
        "duplicate_external_resource",
      );
    },
  );

  it("allows the same external resource identifier under different adapters", async () => {
    const externalResourceId = "shared-target";
    const mockService = createService("mock-service", {
      managementAdapter: "mock",
      externalResourceId,
    });
    const pm2Service = createService("pm2-service", {
      managementAdapter: "pm2",
      externalResourceId,
    });
    const catalog = InMemoryRegisteredServiceCatalog.create([
      mockService,
      pm2Service,
    ]);

    await expect(catalog.list()).resolves.toEqual([mockService, pm2Service]);
  });

  it("compares external resource identifiers exactly without normalization", async () => {
    const lowerCaseTarget = createService("lower-target", {
      externalResourceId: "service-target",
    });
    const upperCaseTarget = createService("upper-target", {
      externalResourceId: "Service-Target",
    });
    const catalog = InMemoryRegisteredServiceCatalog.create([
      lowerCaseTarget,
      upperCaseTarget,
    ]);

    await expect(catalog.list()).resolves.toEqual([
      lowerCaseTarget,
      upperCaseTarget,
    ]);
  });

  it("does not retain the caller-owned input array", async () => {
    const firstService = createService("first-service");
    const suppliedServices = [firstService];
    const catalog = InMemoryRegisteredServiceCatalog.create(suppliedServices);

    suppliedServices.push(createService("later-service"));

    await expect(catalog.list()).resolves.toEqual([firstService]);
  });

  it("does not permit mutation through the returned collection", async () => {
    const service = createService("task-manager");
    const catalog = InMemoryRegisteredServiceCatalog.create([service]);
    const listedServices = await catalog.list();

    expect(() => {
      (listedServices as RegisteredService[]).push(
        createService("injected-service"),
      );
    }).toThrow(TypeError);
    await expect(catalog.list()).resolves.toEqual([service]);
  });

  it("rejects values that were not created through the domain API", () => {
    const unvalidatedService = {
      id: "task-manager",
      displayName: "Task Manager",
      managementAdapter: "pm2" as const,
      externalResourceId: "task-manager-api",
      supportedOperations: ["readStatus" as const],
    };

    expectCatalogError([unvalidatedService], "invalid_registered_service");
  });

  it("does not expose rejected identifiers in catalog errors", () => {
    const unsafeId = "credential-secret";
    const unsafeTarget = "private-process-name";
    const invalidCatalogs = [
      [
        createService(unsafeId, { externalResourceId: unsafeTarget }),
        createService(unsafeId, {
          managementAdapter: "pm2",
          externalResourceId: "another-target",
        }),
      ],
      [
        createService("first-service", {
          externalResourceId: unsafeTarget,
        }),
        createService("second-service", {
          externalResourceId: unsafeTarget,
        }),
      ],
    ];

    for (const services of invalidCatalogs) {
      try {
        InMemoryRegisteredServiceCatalog.create(services);
      } catch (error) {
        expect(error).toBeInstanceOf(RegisteredServiceCatalogError);
        expect(String(error)).not.toContain(unsafeId);
        expect(String(error)).not.toContain(unsafeTarget);
      }
    }
  });
});
