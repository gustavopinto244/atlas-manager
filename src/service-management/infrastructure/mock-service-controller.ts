import type { ServiceController } from "../application/ports/service-controller.js";
import type { RegisteredService } from "../domain/registered-service.js";
import type { ServiceControlOperation } from "../domain/registered-service-control-result.js";

export class MockServiceControllerError extends Error {
  public override readonly name = "MockServiceControllerError";
  public readonly code = "unsupported_control_adapter";

  public constructor() {
    super("Mock service control error: unsupported_control_adapter");
  }
}

export class MockServiceController implements ServiceController {
  public execute(
    service: RegisteredService,
    operation: ServiceControlOperation,
  ): Promise<void> {
    void operation;

    if (service.managementAdapter !== "mock") {
      return Promise.reject(new MockServiceControllerError());
    }

    return Promise.resolve();
  }
}
