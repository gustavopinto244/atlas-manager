import type { ServiceAvailabilityOverride } from "../../../service-scheduling/domain/service-availability-override.js";

export interface ServiceAvailabilityOverrideStore {
  findByServiceId(
    serviceId: string,
  ): Promise<ServiceAvailabilityOverride | null>;

  save(serviceId: string, override: ServiceAvailabilityOverride): Promise<void>;

  removeByServiceId(serviceId: string): Promise<void>;
}
