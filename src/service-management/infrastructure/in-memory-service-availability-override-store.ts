import type {
  ServiceAvailabilityOverrideConditionalRemovalResult,
  ServiceAvailabilityOverrideStore,
} from "../application/ports/service-availability-override-store.js";
import {
  isSameServiceAvailabilityOverride,
  type ServiceAvailabilityOverride,
} from "../../service-scheduling/domain/service-availability-override.js";

const REMOVED_RESULT = Object.freeze({
  kind: "removed",
} as const satisfies ServiceAvailabilityOverrideConditionalRemovalResult);

const NOT_REMOVED_RESULT = Object.freeze({
  kind: "not_removed",
} as const satisfies ServiceAvailabilityOverrideConditionalRemovalResult);

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

  public removeByServiceIdIfMatches(
    serviceId: string,
    expectedOverride: ServiceAvailabilityOverride,
  ): Promise<ServiceAvailabilityOverrideConditionalRemovalResult> {
    const currentOverride = this.#overrides.get(serviceId);

    if (
      currentOverride === undefined ||
      !isSameServiceAvailabilityOverride(currentOverride, expectedOverride)
    ) {
      return Promise.resolve(NOT_REMOVED_RESULT);
    }

    this.#overrides.delete(serviceId);
    return Promise.resolve(REMOVED_RESULT);
  }
}
