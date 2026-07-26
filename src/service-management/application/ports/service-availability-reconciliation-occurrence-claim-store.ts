import type { ServiceAvailabilityReconciliationOccurrence } from "../../domain/service-availability-reconciliation-occurrence.js";

export type ServiceAvailabilityReconciliationOccurrenceClaimResult =
  | Readonly<{
      kind: "claimed";
    }>
  | Readonly<{
      kind: "duplicate";
    }>;

export interface ServiceAvailabilityReconciliationOccurrenceClaimStore {
  claim(
    occurrence: ServiceAvailabilityReconciliationOccurrence,
  ): Promise<ServiceAvailabilityReconciliationOccurrenceClaimResult>;
}
