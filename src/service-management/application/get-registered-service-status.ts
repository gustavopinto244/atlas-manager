import { RegisteredServiceStatus } from "../domain/registered-service-status.js";
import { RegisteredServiceNotFoundError } from "./registered-service-not-found-error.js";
import type { Clock } from "./ports/clock.js";
import type { RegisteredServiceCatalog } from "./ports/registered-service-catalog.js";
import type { ServiceStatusReader } from "./ports/service-status-reader.js";

export type ServiceStatusClock = Clock;

export class GetRegisteredServiceStatusError extends RegisteredServiceNotFoundError {
  public override readonly name = "GetRegisteredServiceStatusError";
}

export class GetRegisteredServiceStatus {
  public constructor(
    private readonly catalog: RegisteredServiceCatalog,
    private readonly statusReader: ServiceStatusReader,
    private readonly clock: ServiceStatusClock,
  ) {}

  public async execute(serviceId: string): Promise<RegisteredServiceStatus> {
    const service = await this.catalog.findById(serviceId);

    if (service === null) {
      throw new GetRegisteredServiceStatusError();
    }

    const state = await this.statusReader.read(service);

    return RegisteredServiceStatus.create({
      serviceId: service.id,
      state,
      observedAt: this.clock.now().toISOString(),
    });
  }
}
