import { describe, expect, it, vi } from "vitest";

import { ListRegisteredServices } from "../../../src/service-management/application/list-registered-services.js";
import type { RegisteredServiceCatalog } from "../../../src/service-management/application/ports/registered-service-catalog.js";
import { RegisteredService } from "../../../src/service-management/domain/registered-service.js";

function createService(id: string): RegisteredService {
  return RegisteredService.create({
    id,
    displayName: id,
    managementAdapter: "mock",
    externalResourceId: id,
    supportedOperations: ["readStatus"],
  });
}

describe("ListRegisteredServices", () => {
  it("lists an empty catalog through the application port", async () => {
    const list = vi.fn().mockResolvedValue([]);
    const catalog: RegisteredServiceCatalog = { list };
    const listRegisteredServices = new ListRegisteredServices(catalog);

    await expect(listRegisteredServices.execute()).resolves.toEqual([]);
    expect(list).toHaveBeenCalledOnce();
  });

  it("preserves the services and order returned by a fake catalog", async () => {
    const firstService = createService("first-service");
    const secondService = createService("second-service");
    const catalogServices = Object.freeze([firstService, secondService]);
    const catalog: RegisteredServiceCatalog = {
      list: vi.fn().mockResolvedValue(catalogServices),
    };
    const listRegisteredServices = new ListRegisteredServices(catalog);

    const result = await listRegisteredServices.execute();

    expect(result).toBe(catalogServices);
    expect(result).toEqual([firstService, secondService]);
  });

  it("propagates catalog failures unchanged", async () => {
    const failure = new Error("catalog unavailable");
    const catalog: RegisteredServiceCatalog = {
      list: vi.fn().mockRejectedValue(failure),
    };
    const listRegisteredServices = new ListRegisteredServices(catalog);

    await expect(listRegisteredServices.execute()).rejects.toBe(failure);
  });
});
