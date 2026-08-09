import type { ServiceAvailabilityPolicy } from "../../../service-scheduling/domain/service-availability-policy.js";

export interface ServiceAvailabilityPolicyStore {
  findByServiceId(serviceId: string): Promise<ServiceAvailabilityPolicy | null>;
  findByServiceIds?(
    serviceIds: readonly string[],
  ): Promise<ReadonlyMap<string, ServiceAvailabilityPolicy>>;
  save(serviceId: string, policy: ServiceAvailabilityPolicy): Promise<void>;
  removeByServiceId(serviceId: string): Promise<void>;
}
