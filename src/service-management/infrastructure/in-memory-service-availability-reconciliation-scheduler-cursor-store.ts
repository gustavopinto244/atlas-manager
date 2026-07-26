import type {
  ServiceAvailabilityReconciliationSchedulerCursorAdvanceResult,
  ServiceAvailabilityReconciliationSchedulerCursorStore,
} from "../application/ports/service-availability-reconciliation-scheduler-cursor-store.js";
import {
  isSameServiceAvailabilityReconciliationSchedulerCursor,
  type ServiceAvailabilityReconciliationSchedulerCursor,
} from "../domain/service-availability-reconciliation-scheduler-cursor.js";

export type ServiceAvailabilityReconciliationSchedulerCursorStoreErrorCode =
  "non_forward_cursor";

export class ServiceAvailabilityReconciliationSchedulerCursorStoreError extends Error {
  public override readonly name =
    "ServiceAvailabilityReconciliationSchedulerCursorStoreError";

  public constructor(
    public readonly code: ServiceAvailabilityReconciliationSchedulerCursorStoreErrorCode,
  ) {
    super(
      `Service availability reconciliation scheduler cursor store failed: ${code}`,
    );
  }
}

export class InMemoryServiceAvailabilityReconciliationSchedulerCursorStore implements ServiceAvailabilityReconciliationSchedulerCursorStore {
  #cursor: ServiceAvailabilityReconciliationSchedulerCursor | null = null;

  public constructor() {
    Object.freeze(this);
  }

  public read(): Promise<ServiceAvailabilityReconciliationSchedulerCursor | null> {
    return Promise.resolve(this.#cursor);
  }

  public advance(
    expected: ServiceAvailabilityReconciliationSchedulerCursor | null,
    next: ServiceAvailabilityReconciliationSchedulerCursor,
  ): Promise<ServiceAvailabilityReconciliationSchedulerCursorAdvanceResult> {
    if (
      !isSameServiceAvailabilityReconciliationSchedulerCursor(
        expected,
        this.#cursor,
      )
    ) {
      return Promise.resolve(
        Object.freeze({
          kind: "conflict",
          cursor: this.#cursor,
        }),
      );
    }

    if (
      this.#cursor !== null &&
      next.completedThrough <= this.#cursor.completedThrough
    ) {
      return Promise.reject(
        new ServiceAvailabilityReconciliationSchedulerCursorStoreError(
          "non_forward_cursor",
        ),
      );
    }

    this.#cursor = next;

    return Promise.resolve(
      Object.freeze({
        kind: "advanced",
        cursor: next,
      }),
    );
  }
}
