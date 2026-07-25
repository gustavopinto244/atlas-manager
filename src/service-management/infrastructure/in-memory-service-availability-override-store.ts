import type { ServiceAvailabilityOverrideStore } from "../application/ports/service-availability-override-store.js";
import type { ServiceAvailabilityOverride } from "../../service-scheduling/domain/service-availability-override.js";

export class InMemoryServiceAvailabilityOverrideStore implements ServiceAvailabilityOverrideStore {
  readonly #overrides = new Map<string, ServiceAvailabilityOverride>();

  public constructor() {
    Object.freeze(this);
  }

  public findByServiceId(
    serviceId: string,
  ): Promise<ServiceAvailabilityOverride | null> {
    return Promise.resolve(this.#overrides.get(serviceId) ?? null);
  }

  public save(
    serviceId: string,
    override: ServiceAvailabilityOverride,
  ): Promise<void> {
    this.#overrides.set(serviceId, override);

    return Promise.resolve();
  }

  public removeByServiceId(serviceId: string): Promise<void> {
    this.#overrides.delete(serviceId);

    return Promise.resolve();
  }
}
