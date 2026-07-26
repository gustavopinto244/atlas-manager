import type {
  ServiceAvailabilityReconciliationOccurrenceClaimResult,
  ServiceAvailabilityReconciliationOccurrenceClaimStore,
} from "../application/ports/service-availability-reconciliation-occurrence-claim-store.js";
import type { ServiceAvailabilityReconciliationOccurrence } from "../domain/service-availability-reconciliation-occurrence.js";
import type { ServiceAvailabilityReconciliationOperation } from "../domain/service-availability-reconciliation-decision.js";

const CLAIMED_RESULT = Object.freeze({
  kind: "claimed",
} as const satisfies ServiceAvailabilityReconciliationOccurrenceClaimResult);

const DUPLICATE_RESULT = Object.freeze({
  kind: "duplicate",
} as const satisfies ServiceAvailabilityReconciliationOccurrenceClaimResult);

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
}
