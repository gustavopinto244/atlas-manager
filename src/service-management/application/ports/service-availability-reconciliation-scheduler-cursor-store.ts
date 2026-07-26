import type { ServiceAvailabilityReconciliationSchedulerCursor } from "../../domain/service-availability-reconciliation-scheduler-cursor.js";

export type ServiceAvailabilityReconciliationSchedulerCursorAdvanceResult =
  | Readonly<{
      kind: "advanced";
      cursor: ServiceAvailabilityReconciliationSchedulerCursor;
    }>
  | Readonly<{
      kind: "conflict";
      cursor: ServiceAvailabilityReconciliationSchedulerCursor | null;
    }>;

export interface ServiceAvailabilityReconciliationSchedulerCursorStore {
  read(): Promise<ServiceAvailabilityReconciliationSchedulerCursor | null>;

  advance(
    expected: ServiceAvailabilityReconciliationSchedulerCursor | null,
    next: ServiceAvailabilityReconciliationSchedulerCursor,
  ): Promise<ServiceAvailabilityReconciliationSchedulerCursorAdvanceResult>;
}
