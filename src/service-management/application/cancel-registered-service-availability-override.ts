import type { RegisteredServiceCatalog } from "./ports/registered-service-catalog.js";
import type { ServiceAvailabilityOverrideStore } from "./ports/service-availability-override-store.js";
import { RegisteredServiceNotFoundError } from "./registered-service-not-found-error.js";

export class CancelRegisteredServiceAvailabilityOverride {
  public constructor(
    private readonly catalog: RegisteredServiceCatalog,
    private readonly overrideStore: ServiceAvailabilityOverrideStore,
  ) {}

  public async execute(serviceId: string): Promise<void> {
    const service = await this.catalog.findById(serviceId);

    if (service === null) {
      throw new RegisteredServiceNotFoundError();
    }

    await this.overrideStore.removeByServiceId(service.id);
  }
}
