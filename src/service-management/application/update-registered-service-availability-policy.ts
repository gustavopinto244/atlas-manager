import {
  createServiceAvailabilityPolicy,
  type ServiceAvailabilityPolicy,
} from "../../service-scheduling/domain/service-availability-policy.js";
import type { RegisteredServiceCatalog } from "./ports/registered-service-catalog.js";
import type { ServiceAvailabilityPolicyStore } from "./ports/service-availability-policy-store.js";
import { RegisteredServiceNotFoundError } from "./registered-service-not-found-error.js";

export class UpdateRegisteredServiceAvailabilityPolicy {
  public constructor(
    private readonly catalog: RegisteredServiceCatalog,
    private readonly policyStore: ServiceAvailabilityPolicyStore,
  ) {}

  public async execute(
    serviceId: string,
    input: unknown,
  ): Promise<ServiceAvailabilityPolicy> {
    const service = await this.catalog.findById(serviceId);
    if (service === null) throw new RegisteredServiceNotFoundError();

    const policy = createServiceAvailabilityPolicy(input);
    await this.policyStore.save(service.id, policy);
    return policy;
  }
}
