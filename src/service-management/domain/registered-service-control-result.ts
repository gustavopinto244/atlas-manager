import type { SupportedServiceOperation } from "./registered-service.js";

export type ServiceControlOperation = Exclude<
  SupportedServiceOperation,
  "readStatus"
>;

export const SERVICE_CONTROL_OPERATIONS = Object.freeze([
  "start",
  "stop",
  "restart",
] as const satisfies readonly ServiceControlOperation[]);

export type RegisteredServiceControlResultValidationErrorCode =
  | "invalid_service_id"
  | "invalid_control_operation"
  | "invalid_completion_timestamp";

export class RegisteredServiceControlResultValidationError extends Error {
  public override readonly name =
    "RegisteredServiceControlResultValidationError";

  public constructor(
    public readonly code: RegisteredServiceControlResultValidationErrorCode,
  ) {
    super(`Invalid registered-service control result: ${code}`);
  }
}

export interface CreateRegisteredServiceControlResultInput {
  readonly serviceId: string;
  readonly operation: string;
  readonly completedAt: string;
}

export class RegisteredServiceControlResult {
  private constructor(
    public readonly serviceId: string,
    public readonly operation: ServiceControlOperation,
    public readonly completedAt: string,
  ) {
    Object.freeze(this);
  }

  public static create(
    input: CreateRegisteredServiceControlResultInput,
  ): RegisteredServiceControlResult {
    const serviceId = validateServiceId(input.serviceId);
    const operation = validateControlOperation(input.operation);
    const completedAt = validateCompletionTimestamp(input.completedAt);

    return new RegisteredServiceControlResult(
      serviceId,
      operation,
      completedAt,
    );
  }
}

const SERVICE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const controlOperationAllowlist = new Set<string>(SERVICE_CONTROL_OPERATIONS);

function validateServiceId(serviceId: string): string {
  if (
    serviceId.length < 1 ||
    serviceId.length > 64 ||
    !SERVICE_ID_PATTERN.test(serviceId)
  ) {
    throw new RegisteredServiceControlResultValidationError(
      "invalid_service_id",
    );
  }

  return serviceId;
}

function validateControlOperation(operation: string): ServiceControlOperation {
  if (!controlOperationAllowlist.has(operation)) {
    throw new RegisteredServiceControlResultValidationError(
      "invalid_control_operation",
    );
  }

  return operation as ServiceControlOperation;
}

function validateCompletionTimestamp(completedAt: string): string {
  const timestamp = new Date(completedAt);

  if (
    !Number.isFinite(timestamp.getTime()) ||
    timestamp.toISOString() !== completedAt
  ) {
    throw new RegisteredServiceControlResultValidationError(
      "invalid_completion_timestamp",
    );
  }

  return completedAt;
}
