import type { ServiceAvailabilityReconciliationOccurrence } from "../../domain/service-availability-reconciliation-occurrence.js";
import type { ServiceAvailabilityReconciliationSchedulerCursor } from "../../domain/service-availability-reconciliation-scheduler-cursor.js";

export type ServiceAvailabilityReconciliationOccurrenceClaimResult =
  | Readonly<{
      kind: "claimed";
    }>
  | Readonly<{
      kind: "duplicate";
    }>;

export type ServiceAvailabilityReconciliationOccurrenceClaimPruningResult =
  Readonly<{ kind: "pruned" }> | Readonly<{ kind: "unchanged" }>;

export interface ServiceAvailabilityReconciliationOccurrenceClaimStore {
  claim(
    occurrence: ServiceAvailabilityReconciliationOccurrence,
  ): Promise<ServiceAvailabilityReconciliationOccurrenceClaimResult>;

  pruneCompletedThrough(
    cursor: ServiceAvailabilityReconciliationSchedulerCursor,
  ): Promise<ServiceAvailabilityReconciliationOccurrenceClaimPruningResult>;
}
