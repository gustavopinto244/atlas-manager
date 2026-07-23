import { describe, expect, it, vi } from "vitest";

import {
  GetRegisteredServiceStatus,
  GetRegisteredServiceStatusError,
} from "../../../src/service-management/application/get-registered-service-status.js";
import type { RegisteredServiceCatalog } from "../../../src/service-management/application/ports/registered-service-catalog.js";
import type { ServiceStatusReader } from "../../../src/service-management/application/ports/service-status-reader.js";
import { RegisteredService } from "../../../src/service-management/domain/registered-service.js";

const observedAt = "2026-07-23T12:00:00.000Z";

function createService(): RegisteredService {
  return RegisteredService.create({
    id: "task-manager",
    displayName: "Task Manager",
    managementAdapter: "mock",
    externalResourceId: "task-manager-fixture",
    supportedOperations: ["readStatus"],
  });
}

function createCatalog(
  findById: RegisteredServiceCatalog["findById"],
): RegisteredServiceCatalog {
  return {
    list: vi.fn(),
    findById,
  };
}

describe("GetRegisteredServiceStatus", () => {
  it("resolves the registered service and returns a deterministic status", async () => {
    const service = createService();
    const findById = vi.fn().mockResolvedValue(service);
    const catalog = createCatalog(findById);
    const read = vi.fn().mockResolvedValue("running");
    const statusReader: ServiceStatusReader = { read };
    const clock = { now: vi.fn(() => new Date(observedAt)) };
    const getStatus = new GetRegisteredServiceStatus(
      catalog,
      statusReader,
      clock,
    );

    await expect(getStatus.execute("task-manager")).resolves.toEqual({
      serviceId: "task-manager",
      state: "running",
      observedAt,
    });
    expect(findById).toHaveBeenCalledWith("task-manager");
    expect(read).toHaveBeenCalledWith(service);
    expect(clock.now).toHaveBeenCalledOnce();
  });

  it("rejects an unknown service before calling the reader or clock", async () => {
    const unknownServiceId = "credential-secret-service";
    const catalog = createCatalog(vi.fn().mockResolvedValue(null));
    const read = vi.fn();
    const statusReader: ServiceStatusReader = { read };
    const clock = { now: vi.fn() };
    const getStatus = new GetRegisteredServiceStatus(
      catalog,
      statusReader,
      clock,
    );

    await expect(getStatus.execute(unknownServiceId)).rejects.toEqual(
      expect.objectContaining({
        name: "GetRegisteredServiceStatusError",
        code: "registered_service_not_found",
      }),
    );
    expect(read).not.toHaveBeenCalled();
    expect(clock.now).not.toHaveBeenCalled();

    try {
      await getStatus.execute(unknownServiceId);
    } catch (error) {
      expect(error).toBeInstanceOf(GetRegisteredServiceStatusError);
      expect(String(error)).not.toContain(unknownServiceId);
    }
  });

  it("propagates catalog failures unchanged", async () => {
    const failure = new Error("catalog unavailable");
    const catalog = createCatalog(vi.fn().mockRejectedValue(failure));
    const read = vi.fn();
    const statusReader: ServiceStatusReader = { read };
    const getStatus = new GetRegisteredServiceStatus(catalog, statusReader, {
      now: vi.fn(),
    });

    await expect(getStatus.execute("task-manager")).rejects.toBe(failure);
    expect(read).not.toHaveBeenCalled();
  });

  it("propagates status-reader failures unchanged", async () => {
    const failure = new Error("reader unavailable");
    const catalog = createCatalog(vi.fn().mockResolvedValue(createService()));
    const statusReader: ServiceStatusReader = {
      read: vi.fn().mockRejectedValue(failure),
    };
    const getStatus = new GetRegisteredServiceStatus(catalog, statusReader, {
      now: vi.fn(),
    });

    await expect(getStatus.execute("task-manager")).rejects.toBe(failure);
  });
});
