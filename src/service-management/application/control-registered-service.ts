import {
  RegisteredServiceControlResult,
  type ServiceControlOperation,
} from "../domain/registered-service-control-result.js";
import { RegisteredServiceNotFoundError } from "./registered-service-not-found-error.js";
import type { Clock } from "./ports/clock.js";
import type { RegisteredServiceCatalog } from "./ports/registered-service-catalog.js";
import type { ServiceController } from "./ports/service-controller.js";

export class ControlRegisteredServiceError extends Error {
  public override readonly name = "ControlRegisteredServiceError";
  public readonly code = "service_operation_not_supported";

  public constructor() {
    super("Service operation not supported");
  }
}

export class ControlRegisteredService {
  public constructor(
    private readonly catalog: RegisteredServiceCatalog,
    private readonly controller: ServiceController,
    private readonly clock: Clock,
  ) {}

  public async execute(
    serviceId: string,
    operation: ServiceControlOperation,
  ): Promise<RegisteredServiceControlResult> {
    const service = await this.catalog.findById(serviceId);

    if (service === null) {
      throw new RegisteredServiceNotFoundError();
    }

    if (!service.supportedOperations.includes(operation)) {
      throw new ControlRegisteredServiceError();
    }

    await this.controller.execute(service, operation);

    return RegisteredServiceControlResult.create({
      serviceId: service.id,
      operation,
      completedAt: this.clock.now().toISOString(),
    });
  }
}
