import type {
  ServiceAvailabilityReconciliationOccurrenceClaimPruningResult,
  ServiceAvailabilityReconciliationOccurrenceClaimResult,
  ServiceAvailabilityReconciliationOccurrenceClaimStore,
} from "../application/ports/service-availability-reconciliation-occurrence-claim-store.js";
import type { ServiceAvailabilityReconciliationOccurrence } from "../domain/service-availability-reconciliation-occurrence.js";
import type { ServiceAvailabilityReconciliationOperation } from "../domain/service-availability-reconciliation-decision.js";
import type { ServiceAvailabilityReconciliationSchedulerCursor } from "../domain/service-availability-reconciliation-scheduler-cursor.js";

const CLAIMED_RESULT = Object.freeze({
  kind: "claimed",
} as const satisfies ServiceAvailabilityReconciliationOccurrenceClaimResult);

const DUPLICATE_RESULT = Object.freeze({
  kind: "duplicate",
} as const satisfies ServiceAvailabilityReconciliationOccurrenceClaimResult);

const PRUNED_RESULT = Object.freeze({
  kind: "pruned",
} as const satisfies ServiceAvailabilityReconciliationOccurrenceClaimPruningResult);

const UNCHANGED_RESULT = Object.freeze({
  kind: "unchanged",
} as const satisfies ServiceAvailabilityReconciliationOccurrenceClaimPruningResult);

export class InMemoryServiceAvailabilityReconciliationOccurrenceClaimStore implements ServiceAvailabilityReconciliationOccurrenceClaimStore {
  readonly #claims = new Map<
    string,
    Map<ServiceAvailabilityReconciliationOperation, Set<string>>
  >();

  public constructor() {
    Object.freeze(this);
  }

  public claim(
    occurrence: ServiceAvailabilityReconciliationOccurrence,
  ): Promise<ServiceAvailabilityReconciliationOccurrenceClaimResult> {
    let claimsByOperation = this.#claims.get(occurrence.serviceId);

    if (claimsByOperation === undefined) {
      claimsByOperation = new Map();
      this.#claims.set(occurrence.serviceId, claimsByOperation);
    }

    let scheduledInstants = claimsByOperation.get(occurrence.operation);

    if (scheduledInstants === undefined) {
      scheduledInstants = new Set();
      claimsByOperation.set(occurrence.operation, scheduledInstants);
    }

    if (scheduledInstants.has(occurrence.scheduledFor)) {
      return Promise.resolve(DUPLICATE_RESULT);
    }

    scheduledInstants.add(occurrence.scheduledFor);

    return Promise.resolve(CLAIMED_RESULT);
  }

  public pruneCompletedThrough(
    cursor: ServiceAvailabilityReconciliationSchedulerCursor,
  ): Promise<ServiceAvailabilityReconciliationOccurrenceClaimPruningResult> {
    let changed = false;

    for (const [serviceId, claimsByOperation] of this.#claims) {
      for (const [operation, scheduledInstants] of claimsByOperation) {
        for (const scheduledFor of scheduledInstants) {
          if (scheduledFor <= cursor.completedThrough) {
            scheduledInstants.delete(scheduledFor);
            changed = true;
          }
        }

        if (scheduledInstants.size === 0) {
          claimsByOperation.delete(operation);
        }
      }

      if (claimsByOperation.size === 0) {
        this.#claims.delete(serviceId);
      }
    }

    return Promise.resolve(changed ? PRUNED_RESULT : UNCHANGED_RESULT);
  }
}
