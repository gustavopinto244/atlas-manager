import type { RegisteredServiceAvailabilityInterval } from "../domain/registered-service-availability-interval.js";
import { evaluateRegisteredServiceAvailabilityForInterval } from "../domain/registered-service-availability-interval.js";
import type { RegisteredServiceCatalog } from "./ports/registered-service-catalog.js";
import type { ServiceAvailabilityOverrideStore } from "./ports/service-availability-override-store.js";
import { RegisteredServiceNotFoundError } from "./registered-service-not-found-error.js";

export interface GetRegisteredServiceAvailabilityForIntervalInput {
  readonly serviceId: string;
  readonly startsAt: string;
  readonly endsAt: string;
}
export class GetRegisteredServiceAvailabilityForInterval {
  public constructor(
    private readonly catalog: RegisteredServiceCatalog,
    private readonly overrideStore: ServiceAvailabilityOverrideStore,
  ) {}
  public async execute(
    input: GetRegisteredServiceAvailabilityForIntervalInput,
  ): Promise<RegisteredServiceAvailabilityInterval> {
    const service = await this.catalog.findById(input.serviceId);
    if (service === null) throw new RegisteredServiceNotFoundError();
    const override = await this.overrideStore.findByServiceId(service.id);
    return evaluateRegisteredServiceAvailabilityForInterval(
      service.id,
      service.availabilityPolicy,
      override,
      input.startsAt,
      input.endsAt,
    );
  }
}
