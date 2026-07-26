export interface CreateServiceAvailabilityReconciliationSchedulerCursorInput {
  readonly completedThrough: string;
}

export type ServiceAvailabilityReconciliationSchedulerCursorValidationErrorCode =
  "invalid_completed_through";

export class ServiceAvailabilityReconciliationSchedulerCursorValidationError extends Error {
  public override readonly name =
    "ServiceAvailabilityReconciliationSchedulerCursorValidationError";

  public constructor(
    public readonly code: ServiceAvailabilityReconciliationSchedulerCursorValidationErrorCode,
  ) {
    super(
      `Invalid service availability reconciliation scheduler cursor: ${code}`,
    );
  }
}

export class ServiceAvailabilityReconciliationSchedulerCursor {
  private constructor(public readonly completedThrough: string) {
    Object.freeze(this);
  }

  public static create(
    input: CreateServiceAvailabilityReconciliationSchedulerCursorInput,
  ): ServiceAvailabilityReconciliationSchedulerCursor {
    return new ServiceAvailabilityReconciliationSchedulerCursor(
      validateCompletedThrough(input?.completedThrough),
    );
  }
}

export function isSameServiceAvailabilityReconciliationSchedulerCursor(
  left: ServiceAvailabilityReconciliationSchedulerCursor | null,
  right: ServiceAvailabilityReconciliationSchedulerCursor | null,
): boolean {
  if (left === null || right === null) {
    return left === right;
  }

  return left.completedThrough === right.completedThrough;
}

function validateCompletedThrough(completedThrough: unknown): string {
  if (typeof completedThrough !== "string") {
    throw new ServiceAvailabilityReconciliationSchedulerCursorValidationError(
      "invalid_completed_through",
    );
  }

  const instant = new Date(completedThrough);

  if (
    !Number.isFinite(instant.getTime()) ||
    instant.toISOString() !== completedThrough ||
    instant.getUTCSeconds() !== 0 ||
    instant.getUTCMilliseconds() !== 0
  ) {
    throw new ServiceAvailabilityReconciliationSchedulerCursorValidationError(
      "invalid_completed_through",
    );
  }

  return completedThrough;
}
