import { describe, expect, it, vi } from "vitest";

import { GetRegisteredServiceStatus } from "../../../src/service-management/application/get-registered-service-status.js";
import type { RegisteredServiceCatalog } from "../../../src/service-management/application/ports/registered-service-catalog.js";
import type { ServiceStatusReader } from "../../../src/service-management/application/ports/service-status-reader.js";
import { RegisteredService } from "../../../src/service-management/domain/registered-service.js";
import type { ServiceRuntimeState } from "../../../src/service-management/domain/registered-service-status.js";
import {
  DispatchingServiceStatusReader,
  DispatchingServiceStatusReaderError,
} from "../../../src/service-management/infrastructure/dispatching-service-status-reader.js";

function createService(managementAdapter: "mock" | "pm2"): RegisteredService {
  return RegisteredService.create({
    id: `${managementAdapter}-service`,
    displayName: `${managementAdapter.toUpperCase()} Service`,
    managementAdapter,
    externalResourceId: `${managementAdapter}-external-resource`,
    supportedOperations: ["readStatus", "restart"],
  });
}

function createReader(
  result: ServiceRuntimeState = "running",
): ServiceStatusReader & {
  readonly read: ReturnType<typeof vi.fn<ServiceStatusReader["read"]>>;
} {
  return {
    read: vi.fn<ServiceStatusReader["read"]>().mockResolvedValue(result),
  };
}

describe("DispatchingServiceStatusReader", () => {
  it.each([
    ["mock", "running", "pm2"],
    ["pm2", "failed", "mock"],
  ] as const)(
    "delegates a %s service only to its configured reader",
    async (managementAdapter, state, nonSelectedAdapter) => {
      const service = createService(managementAdapter);
      const mock = createReader("unknown");
      const pm2 = createReader("unknown");
      const dispatcher = new DispatchingServiceStatusReader({ mock, pm2 });
      const selectedReader = managementAdapter === "mock" ? mock : pm2;
      const nonSelectedReader = nonSelectedAdapter === "mock" ? mock : pm2;
      selectedReader.read.mockResolvedValueOnce(state);

      await expect(dispatcher.read(service)).resolves.toBe(state);
      expect(selectedReader.read).toHaveBeenCalledExactlyOnceWith(service);
      expect(selectedReader.read.mock.calls[0]?.[0]).toBe(service);
      expect(nonSelectedReader.read).not.toHaveBeenCalled();
    },
  );

  it.each(["running", "stopped", "failed", "unknown"] as const)(
    "returns the selected reader's %s state unchanged",
    async (state) => {
      const mock = createReader(state);
      const pm2 = createReader("running");
      const dispatcher = new DispatchingServiceStatusReader({ mock, pm2 });

      await expect(dispatcher.read(createService("mock"))).resolves.toBe(state);
    },
  );

  it("selects readers only by management adapter", async () => {
    const mockService = RegisteredService.create({
      id: "pm2-named-service",
      displayName: "Misleading Mock Service",
      managementAdapter: "mock",
      externalResourceId: "pm2-external-resource",
      supportedOperations: ["readStatus", "start", "stop", "restart"],
    });
    const pm2Service = RegisteredService.create({
      id: "mock-named-service",
      displayName: "Misleading PM2 Service",
      managementAdapter: "pm2",
      externalResourceId: "mock-external-resource",
      supportedOperations: ["readStatus"],
    });
    const mock = createReader("stopped");
    const pm2 = createReader("failed");
    const dispatcher = new DispatchingServiceStatusReader({ mock, pm2 });

    await expect(dispatcher.read(mockService)).resolves.toBe("stopped");
    await expect(dispatcher.read(pm2Service)).resolves.toBe("failed");
    expect(mock.read).toHaveBeenCalledExactlyOnceWith(mockService);
    expect(pm2.read).toHaveBeenCalledExactlyOnceWith(pm2Service);
  });

  it.each(["mock", "pm2"] as const)(
    "propagates a %s-reader failure unchanged without fallback",
    async (managementAdapter) => {
      const failure = new Error("Selected reader failure");
      const mock = createReader();
      const pm2 = createReader();
      const selectedReader = managementAdapter === "mock" ? mock : pm2;
      const nonSelectedReader = managementAdapter === "mock" ? pm2 : mock;
      selectedReader.read.mockRejectedValue(failure);
      const dispatcher = new DispatchingServiceStatusReader({ mock, pm2 });

      await expect(
        dispatcher.read(createService(managementAdapter)),
      ).rejects.toBe(failure);
      expect(selectedReader.read).toHaveBeenCalledOnce();
      expect(nonSelectedReader.read).not.toHaveBeenCalled();
    },
  );

  it("does not add service or infrastructure details to propagated errors", async () => {
    const service = createService("pm2");
    const failure = new Error("Selected reader failure");
    const mock = createReader();
    const pm2 = createReader();
    pm2.read.mockRejectedValue(failure);
    const dispatcher = new DispatchingServiceStatusReader({ mock, pm2 });

    try {
      await dispatcher.read(service);
      expect.unreachable("Expected selected reader failure");
    } catch (error) {
      expect(error).toBe(failure);

      const exposedError = `${String(error)} ${JSON.stringify(error)}`;

      expect(exposedError).not.toContain(service.id);
      expect(exposedError).not.toContain(service.externalResourceId);
      expect(exposedError).not.toContain(service.managementAdapter);
      expect(exposedError).not.toContain("raw-pm2-output");
    }
  });

  it("takes an immutable snapshot of explicitly supplied readers", async () => {
    const originalMock = createReader("stopped");
    const replacementMock = createReader("failed");
    const pm2 = createReader();
    const dependencies = { mock: originalMock, pm2 };
    const dispatcher = new DispatchingServiceStatusReader(dependencies);

    dependencies.mock = replacementMock;

    await expect(dispatcher.read(createService("mock"))).resolves.toBe(
      "stopped",
    );
    expect(originalMock.read).toHaveBeenCalledOnce();
    expect(replacementMock.read).not.toHaveBeenCalled();
    expect(Object.isFrozen(dispatcher)).toBe(true);
    expect(dispatcher).not.toHaveProperty("register");
    expect(dispatcher).not.toHaveProperty("replace");
    expect(dispatcher).not.toHaveProperty("remove");
  });

  it.each([
    [undefined],
    [{ mock: undefined, pm2: createReader() }],
    [{ mock: createReader(), pm2: undefined }],
  ])(
    "rejects missing reader configuration without fallback",
    (dependencies) => {
      expect(
        () =>
          new DispatchingServiceStatusReader(
            dependencies as unknown as {
              readonly mock: ServiceStatusReader;
              readonly pm2: ServiceStatusReader;
            },
          ),
      ).toThrowError(
        expect.objectContaining({
          name: "DispatchingServiceStatusReaderError",
          code: "service_status_reader_unavailable",
          message: "Service status reader unavailable",
        }),
      );
    },
  );

  it("rejects an invalid runtime adapter without selecting a reader", async () => {
    const mock = createReader();
    const pm2 = createReader();
    const dispatcher = new DispatchingServiceStatusReader({ mock, pm2 });
    const service = createService("mock");
    const invalidService = {
      ...service,
      managementAdapter: "Mock",
    } as unknown as RegisteredService;

    await expect(dispatcher.read(invalidService)).rejects.toBeInstanceOf(
      DispatchingServiceStatusReaderError,
    );
    expect(mock.read).not.toHaveBeenCalled();
    expect(pm2.read).not.toHaveBeenCalled();
  });
});

describe("GetRegisteredServiceStatus with dispatcher", () => {
  it.each([
    ["mock", "stopped"],
    ["pm2", "failed"],
  ] as const)(
    "produces a complete status for a registered %s service",
    async (managementAdapter, state) => {
      const service = createService(managementAdapter);
      const findById = vi.fn().mockResolvedValue(service);
      const catalog: RegisteredServiceCatalog = {
        list: vi.fn(),
        findById,
      };
      const mock = createReader("unknown");
      const pm2 = createReader("unknown");
      const selectedReader = managementAdapter === "mock" ? mock : pm2;
      selectedReader.read.mockResolvedValue(state);
      const dispatcher = new DispatchingServiceStatusReader({ mock, pm2 });
      const observedAt = "2026-07-23T18:00:00.000Z";
      const clock = { now: vi.fn(() => new Date(observedAt)) };
      const getStatus = new GetRegisteredServiceStatus(
        catalog,
        dispatcher,
        clock,
      );

      await expect(getStatus.execute(service.id)).resolves.toEqual({
        serviceId: service.id,
        state,
        observedAt,
      });
      expect(findById).toHaveBeenCalledWith(service.id);
      expect(selectedReader.read).toHaveBeenCalledWith(service);
      expect(findById.mock.invocationCallOrder[0]).toBeLessThan(
        selectedReader.read.mock.invocationCallOrder[0] ?? 0,
      );
      expect(clock.now).toHaveBeenCalledOnce();
    },
  );

  it("preserves catalog not-found behavior before dispatch", async () => {
    const catalog: RegisteredServiceCatalog = {
      list: vi.fn(),
      findById: vi.fn().mockResolvedValue(null),
    };
    const mock = createReader();
    const pm2 = createReader();
    const dispatcher = new DispatchingServiceStatusReader({ mock, pm2 });
    const clock = { now: vi.fn() };
    const getStatus = new GetRegisteredServiceStatus(
      catalog,
      dispatcher,
      clock,
    );

    await expect(getStatus.execute("missing-service")).rejects.toEqual(
      expect.objectContaining({ code: "registered_service_not_found" }),
    );
    expect(mock.read).not.toHaveBeenCalled();
    expect(pm2.read).not.toHaveBeenCalled();
    expect(clock.now).not.toHaveBeenCalled();
  });
});
