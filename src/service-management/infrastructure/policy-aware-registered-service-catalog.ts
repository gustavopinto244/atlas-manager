import type { ServiceAvailabilityPolicyStore } from "../application/ports/service-availability-policy-store.js";
import type { RegisteredServiceCatalog } from "../application/ports/registered-service-catalog.js";
import {
  withRegisteredServiceAvailabilityPolicy,
  type RegisteredService,
} from "../domain/registered-service.js";

export class PolicyAwareRegisteredServiceCatalog implements RegisteredServiceCatalog {
  public constructor(
    private readonly source: RegisteredServiceCatalog,
    private readonly policyStore: ServiceAvailabilityPolicyStore,
  ) {}

  public async list(): Promise<readonly RegisteredService[]> {
    const services = await this.source.list();
    if (this.policyStore.findByServiceIds === undefined)
      return Promise.all(services.map((service) => this.withPolicy(service)));
    const stored = await this.policyStore.findByServiceIds(
      services.map((service) => service.id),
    );
    return services.map((service) => {
      const policy = stored.get(service.id);
      return policy === undefined
        ? service
        : withRegisteredServiceAvailabilityPolicy(service, policy);
    });
  }

  public async findById(serviceId: string): Promise<RegisteredService | null> {
    const service = await this.source.findById(serviceId);
    return service === null ? null : this.withPolicy(service);
  }

  private async withPolicy(
    service: RegisteredService,
  ): Promise<RegisteredService> {
    const policy = await this.policyStore.findByServiceId(service.id);
    return policy === null
      ? service
      : withRegisteredServiceAvailabilityPolicy(service, policy);
  }
}
