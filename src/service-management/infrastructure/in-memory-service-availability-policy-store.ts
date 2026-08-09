import type { ServiceAvailabilityPolicy } from "../../service-scheduling/domain/service-availability-policy.js";
import type { ServiceAvailabilityPolicyStore } from "../application/ports/service-availability-policy-store.js";

export class InMemoryServiceAvailabilityPolicyStore implements ServiceAvailabilityPolicyStore {
  readonly #policies = new Map<string, ServiceAvailabilityPolicy>();

  public findByServiceId(
    serviceId: string,
  ): Promise<ServiceAvailabilityPolicy | null> {
    return Promise.resolve(this.#policies.get(serviceId) ?? null);
  }

  public findByServiceIds(
    serviceIds: readonly string[],
  ): Promise<ReadonlyMap<string, ServiceAvailabilityPolicy>> {
    const policies = new Map<string, ServiceAvailabilityPolicy>();
    for (const serviceId of serviceIds) {
      const policy = this.#policies.get(serviceId);
      if (policy !== undefined) policies.set(serviceId, policy);
    }
    return Promise.resolve(policies);
  }

  public save(
    serviceId: string,
    policy: ServiceAvailabilityPolicy,
  ): Promise<void> {
    this.#policies.set(serviceId, policy);
    return Promise.resolve();
  }

  public removeByServiceId(serviceId: string): Promise<void> {
    this.#policies.delete(serviceId);
    return Promise.resolve();
  }
}
