import type { RegisteredServiceCatalog } from "./ports/registered-service-catalog.js";
import type { ServiceAvailabilityPolicyStore } from "./ports/service-availability-policy-store.js";
import { RegisteredServiceNotFoundError } from "./registered-service-not-found-error.js";

export class RemoveRegisteredServiceAvailabilityPolicy {
  public constructor(
    private readonly catalog: RegisteredServiceCatalog,
    private readonly policyStore: ServiceAvailabilityPolicyStore,
  ) {}

  public async execute(serviceId: string): Promise<void> {
    const service = await this.catalog.findById(serviceId);
    if (service === null) throw new RegisteredServiceNotFoundError();
    await this.policyStore.removeByServiceId(service.id);
  }
}
