import type { ServiceAvailabilityPolicy } from "../../../service-scheduling/domain/service-availability-policy.js";

export interface ServiceAvailabilityPolicyStore {
  findByServiceId(serviceId: string): Promise<ServiceAvailabilityPolicy | null>;
  save(serviceId: string, policy: ServiceAvailabilityPolicy): Promise<void>;
  removeByServiceId(serviceId: string): Promise<void>;
}
