import type {
  ServiceAvailabilityReconciliationOccurrenceClaimPruningResult,
  ServiceAvailabilityReconciliationOccurrenceClaimStore,
} from "./ports/service-availability-reconciliation-occurrence-claim-store.js";
import type { ServiceAvailabilityReconciliationSchedulerCursorStore } from "./ports/service-availability-reconciliation-scheduler-cursor-store.js";

const NO_CURSOR_RESULT = Object.freeze({
  kind: "no_cursor",
} as const);

export type PruneCompletedServiceAvailabilityReconciliationOccurrenceClaimsResult =
  | Readonly<{ kind: "no_cursor" }>
  | ServiceAvailabilityReconciliationOccurrenceClaimPruningResult;

export class PruneCompletedServiceAvailabilityReconciliationOccurrenceClaims {
  public constructor(
    private readonly cursorStore: ServiceAvailabilityReconciliationSchedulerCursorStore,
    private readonly occurrenceClaimStore: ServiceAvailabilityReconciliationOccurrenceClaimStore,
  ) {}

  public async execute(): Promise<PruneCompletedServiceAvailabilityReconciliationOccurrenceClaimsResult> {
    const cursor = await this.cursorStore.read();

    if (cursor === null) {
      return NO_CURSOR_RESULT;
    }

    return this.occurrenceClaimStore.pruneCompletedThrough(cursor);
  }
}
