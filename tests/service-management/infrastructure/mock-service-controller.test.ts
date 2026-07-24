import { describe, expect, it } from "vitest";

import { RegisteredService } from "../../../src/service-management/domain/registered-service.js";
import { SERVICE_CONTROL_OPERATIONS } from "../../../src/service-management/domain/registered-service-control-result.js";
import {
  MockServiceController,
  MockServiceControllerError,
} from "../../../src/service-management/infrastructure/mock-service-controller.js";

function createService(managementAdapter: "mock" | "pm2"): RegisteredService {
  return RegisteredService.create({
    id: `${managementAdapter}-service`,
    displayName: `${managementAdapter.toUpperCase()} Service`,
    managementAdapter,
    externalResourceId: `${managementAdapter}-external-resource`,
    supportedOperations: ["readStatus"],
  });
}

describe("MockServiceController", () => {
  it.each(SERVICE_CONTROL_OPERATIONS)(
    "completes deterministic mock %s control without stateful configuration",
    async (operation) => {
      const controller = new MockServiceController();

      await expect(
        controller.execute(createService("mock"), operation),
      ).resolves.toBeUndefined();
    },
  );

  it("rejects a PM2-managed service with a safe stable error", async () => {
    const service = createService("pm2");
    const controller = new MockServiceController();

    await expect(controller.execute(service, "restart")).rejects.toEqual(
      expect.objectContaining({
        name: "MockServiceControllerError",
        code: "unsupported_control_adapter",
        message: "Mock service control error: unsupported_control_adapter",
      }),
    );

    try {
      await controller.execute(service, "restart");
      expect.unreachable("Expected unsupported control adapter");
    } catch (error) {
      expect(error).toBeInstanceOf(MockServiceControllerError);
      expect(String(error)).not.toContain(service.id);
      expect(String(error)).not.toContain(service.externalResourceId);
      expect(String(error)).not.toContain(service.managementAdapter);
    }
  });

  it("exposes no dynamic registration or command API", () => {
    const controller = new MockServiceController();

    expect(controller).not.toHaveProperty("register");
    expect(controller).not.toHaveProperty("executeCommand");
    expect(controller).not.toHaveProperty("command");
    expect(controller).not.toHaveProperty("arguments");
  });
});
