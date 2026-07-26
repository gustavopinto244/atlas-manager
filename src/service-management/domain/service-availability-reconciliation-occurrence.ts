import type { ServiceAvailabilityReconciliationOperation } from "./service-availability-reconciliation-decision.js";

export interface CreateServiceAvailabilityReconciliationOccurrenceInput {
  readonly serviceId: string;
  readonly operation: string;
  readonly scheduledFor: string;
}

export type ServiceAvailabilityReconciliationOccurrenceValidationErrorCode =
  "invalid_service_id" | "invalid_operation" | "invalid_scheduled_for";

export class ServiceAvailabilityReconciliationOccurrenceValidationError extends Error {
  public override readonly name =
    "ServiceAvailabilityReconciliationOccurrenceValidationError";

  public constructor(
    public readonly code: ServiceAvailabilityReconciliationOccurrenceValidationErrorCode,
  ) {
    super(`Invalid service availability reconciliation occurrence: ${code}`);
  }
}

export class ServiceAvailabilityReconciliationOccurrence {
  private constructor(
    public readonly serviceId: string,
    public readonly operation: ServiceAvailabilityReconciliationOperation,
    public readonly scheduledFor: string,
  ) {
    Object.freeze(this);
  }

  public static create(
    input: CreateServiceAvailabilityReconciliationOccurrenceInput,
  ): ServiceAvailabilityReconciliationOccurrence {
    const serviceId = validateServiceId(input.serviceId);
    const operation = validateOperation(input.operation);
    const scheduledFor = validateScheduledFor(input.scheduledFor);

    return new ServiceAvailabilityReconciliationOccurrence(
      serviceId,
      operation,
      scheduledFor,
    );
  }
}

export function isSameServiceAvailabilityReconciliationOccurrence(
  left: ServiceAvailabilityReconciliationOccurrence,
  right: ServiceAvailabilityReconciliationOccurrence,
): boolean {
  return (
    left.serviceId === right.serviceId &&
    left.operation === right.operation &&
    left.scheduledFor === right.scheduledFor
  );
}

const SERVICE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const reconciliationOperationAllowlist = new Set<string>(["start", "stop"]);

function validateServiceId(serviceId: unknown): string {
  if (
    typeof serviceId !== "string" ||
    serviceId.length < 1 ||
    serviceId.length > 64 ||
    !SERVICE_ID_PATTERN.test(serviceId)
  ) {
    throw new ServiceAvailabilityReconciliationOccurrenceValidationError(
      "invalid_service_id",
    );
  }

  return serviceId;
}

function validateOperation(
  operation: unknown,
): ServiceAvailabilityReconciliationOperation {
  if (
    typeof operation !== "string" ||
    !reconciliationOperationAllowlist.has(operation)
  ) {
    throw new ServiceAvailabilityReconciliationOccurrenceValidationError(
      "invalid_operation",
    );
  }

  return operation as ServiceAvailabilityReconciliationOperation;
}

function validateScheduledFor(scheduledFor: unknown): string {
  if (typeof scheduledFor !== "string") {
    throw new ServiceAvailabilityReconciliationOccurrenceValidationError(
      "invalid_scheduled_for",
    );
  }

  const instant = new Date(scheduledFor);

  if (
    !Number.isFinite(instant.getTime()) ||
    instant.toISOString() !== scheduledFor
  ) {
    throw new ServiceAvailabilityReconciliationOccurrenceValidationError(
      "invalid_scheduled_for",
    );
  }

  return scheduledFor;
}
