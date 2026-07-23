import { RegisteredServiceStatus } from "../domain/registered-service-status.js";
import type { RegisteredServiceCatalog } from "./ports/registered-service-catalog.js";
import type { ServiceStatusReader } from "./ports/service-status-reader.js";

export interface ServiceStatusClock {
  now(): Date;
}

export class GetRegisteredServiceStatusError extends Error {
  public override readonly name = "GetRegisteredServiceStatusError";
  public readonly code = "registered_service_not_found";

  public constructor() {
    super("Registered service not found");
  }
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
