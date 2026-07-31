import { evaluateServiceAvailabilityWithOverride } from "../../service-scheduling/domain/service-availability-override-evaluator.js";
import type { ServiceAvailabilityExpectation } from "../../service-scheduling/domain/service-availability-policy-evaluator.js";
import type { Clock } from "./ports/clock.js";
import type { RegisteredServiceCatalog } from "./ports/registered-service-catalog.js";
import type { ServiceAvailabilityOverrideStore } from "./ports/service-availability-override-store.js";
import { RegisteredServiceNotFoundError } from "./registered-service-not-found-error.js";

export interface GetRegisteredServiceEffectiveAvailabilityPort {
  readonly execute: (
    serviceId: string,
  ) => Promise<ServiceAvailabilityExpectation>;
}

export class GetRegisteredServiceEffectiveAvailability implements GetRegisteredServiceEffectiveAvailabilityPort {
  public constructor(
    private readonly catalog: RegisteredServiceCatalog,
    private readonly overrideStore: ServiceAvailabilityOverrideStore,
    private readonly clock: Clock,
  ) {}

  public async execute(
    serviceId: string,
  ): Promise<ServiceAvailabilityExpectation> {
    const service = await this.catalog.findById(serviceId);

    if (service === null) {
      throw new RegisteredServiceNotFoundError();
    }

    const override = await this.overrideStore.findByServiceId(service.id);
    const evaluationInstant = this.clock.now();

    return evaluateServiceAvailabilityWithOverride(
      service.availabilityPolicy,
      override,
      evaluationInstant,
    );
  }
}
