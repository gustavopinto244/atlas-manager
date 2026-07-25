import {
  createServiceAvailabilityOverride,
  type ServiceAvailabilityOverride,
} from "../../service-scheduling/domain/service-availability-override.js";
import type { Clock } from "./ports/clock.js";
import type { RegisteredServiceCatalog } from "./ports/registered-service-catalog.js";
import type { ServiceAvailabilityOverrideStore } from "./ports/service-availability-override-store.js";
import { RegisteredServiceNotFoundError } from "./registered-service-not-found-error.js";

export class SetRegisteredServiceAvailabilityOverride {
  public constructor(
    private readonly catalog: RegisteredServiceCatalog,
    private readonly overrideStore: ServiceAvailabilityOverrideStore,
    private readonly clock: Clock,
  ) {}

  public async execute(
    serviceId: string,
    overrideInput: unknown,
  ): Promise<ServiceAvailabilityOverride> {
    const service = await this.catalog.findById(serviceId);

    if (service === null) {
      throw new RegisteredServiceNotFoundError();
    }

    const referenceInstant = this.clock.now();
    const override = createServiceAvailabilityOverride(
      overrideInput,
      referenceInstant,
    );

    await this.overrideStore.save(service.id, override);

    return override;
  }
}
