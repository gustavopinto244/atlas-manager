// Technology-neutral resource observation for a registered service. Adapter
// details (Docker stats, PM2 monit) are translated into this shape so the
// dashboard and API never need to know which adapter produced a value.
//
// Absence is explicit: a missing memory limit is `null`, never `0`, and a
// failed or unsupported read is `unavailable` with a stable reason rather
// than a fabricated zero value.

export type ServiceResourceUnavailableReason =
  | "unsupported"
  | "unavailable"
  | "timeout"
  | "permission_denied"
  | "invalid_response";

export type ServiceCpuObservation =
  | Readonly<{ outcome: "available"; usagePercent: number }>
  | Readonly<{
      outcome: "unavailable";
      reason: ServiceResourceUnavailableReason;
    }>;

export type ServiceMemoryObservation =
  | Readonly<{
      outcome: "available";
      usageBytes: number;
      limitBytes: number | null;
      usagePercent: number | null;
    }>
  | Readonly<{
      outcome: "unavailable";
      reason: ServiceResourceUnavailableReason;
    }>;

export type ServiceResourceObservation =
  | Readonly<{
      outcome: "available";
      observedAt: string;
      cpu: ServiceCpuObservation;
      memory: ServiceMemoryObservation;
      uptimeSeconds: number | null;
    }>
  | Readonly<{
      outcome: "unavailable";
      observedAt: string;
      reason: ServiceResourceUnavailableReason;
    }>;

export class ServiceResourceObservationValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ServiceResourceObservationValidationError";
    Object.freeze(this);
  }
}

export function createAvailableServiceResourceObservation(input: {
  readonly observedAt: string;
  readonly cpu: ServiceCpuObservation;
  readonly memory: ServiceMemoryObservation;
  readonly uptimeSeconds: number | null;
}): ServiceResourceObservation {
  validateObservedAt(input.observedAt);
  validateCpu(input.cpu);
  validateMemory(input.memory);
  if (
    input.uptimeSeconds !== null &&
    (!Number.isFinite(input.uptimeSeconds) || input.uptimeSeconds < 0)
  )
    throw new ServiceResourceObservationValidationError(
      "invalid uptimeSeconds",
    );
  return Object.freeze({
    outcome: "available" as const,
    observedAt: input.observedAt,
    cpu: input.cpu,
    memory: input.memory,
    uptimeSeconds: input.uptimeSeconds,
  });
}

export function createUnavailableServiceResourceObservation(
  observedAt: string,
  reason: ServiceResourceUnavailableReason,
): ServiceResourceObservation {
  validateObservedAt(observedAt);
  return Object.freeze({
    outcome: "unavailable" as const,
    observedAt,
    reason,
  });
}

function validateObservedAt(observedAt: string): void {
  if (typeof observedAt !== "string" || Number.isNaN(Date.parse(observedAt)))
    throw new ServiceResourceObservationValidationError("invalid observedAt");
}

function validateCpu(cpu: ServiceCpuObservation): void {
  if (cpu.outcome !== "available") return;
  if (!Number.isFinite(cpu.usagePercent) || cpu.usagePercent < 0)
    throw new ServiceResourceObservationValidationError(
      "invalid cpu.usagePercent",
    );
}

function validateMemory(memory: ServiceMemoryObservation): void {
  if (memory.outcome !== "available") return;
  if (!Number.isFinite(memory.usageBytes) || memory.usageBytes < 0)
    throw new ServiceResourceObservationValidationError(
      "invalid memory.usageBytes",
    );
  if (
    memory.limitBytes !== null &&
    (!Number.isFinite(memory.limitBytes) || memory.limitBytes < 0)
  )
    throw new ServiceResourceObservationValidationError(
      "invalid memory.limitBytes",
    );
  if (
    memory.usagePercent !== null &&
    (!Number.isFinite(memory.usagePercent) || memory.usagePercent < 0)
  )
    throw new ServiceResourceObservationValidationError(
      "invalid memory.usagePercent",
    );
}
