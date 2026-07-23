export const SERVICE_RUNTIME_STATES = Object.freeze([
  "running",
  "stopped",
  "failed",
  "unknown",
] as const);

export type ServiceRuntimeState = (typeof SERVICE_RUNTIME_STATES)[number];

export type RegisteredServiceStatusValidationErrorCode =
  "invalid_service_status" | "invalid_observation_timestamp";

export class RegisteredServiceStatusValidationError extends Error {
  public override readonly name = "RegisteredServiceStatusValidationError";

  public constructor(
    public readonly code: RegisteredServiceStatusValidationErrorCode,
  ) {
    super(`Invalid registered-service status: ${code}`);
  }
}

export interface CreateRegisteredServiceStatusInput {
  readonly serviceId: string;
  readonly state: string;
  readonly observedAt: string;
}

export class RegisteredServiceStatus {
  private constructor(
    public readonly serviceId: string,
    public readonly state: ServiceRuntimeState,
    public readonly observedAt: string,
  ) {
    Object.freeze(this);
  }

  public static create(
    input: CreateRegisteredServiceStatusInput,
  ): RegisteredServiceStatus {
    const serviceId = validateServiceId(input.serviceId);
    const state = validateRuntimeState(input.state);
    const observedAt = validateObservationTimestamp(input.observedAt);

    return new RegisteredServiceStatus(serviceId, state, observedAt);
  }
}

const SERVICE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const runtimeStateAllowlist = new Set<string>(SERVICE_RUNTIME_STATES);

function validateServiceId(serviceId: string): string {
  if (
    serviceId.length < 1 ||
    serviceId.length > 64 ||
    !SERVICE_ID_PATTERN.test(serviceId)
  ) {
    throw new RegisteredServiceStatusValidationError("invalid_service_status");
  }

  return serviceId;
}

function validateRuntimeState(state: string): ServiceRuntimeState {
  if (!runtimeStateAllowlist.has(state)) {
    throw new RegisteredServiceStatusValidationError("invalid_service_status");
  }

  return state as ServiceRuntimeState;
}

function validateObservationTimestamp(observedAt: string): string {
  const timestamp = new Date(observedAt);

  if (
    !Number.isFinite(timestamp.getTime()) ||
    timestamp.toISOString() !== observedAt
  ) {
    throw new RegisteredServiceStatusValidationError(
      "invalid_observation_timestamp",
    );
  }

  return observedAt;
}
