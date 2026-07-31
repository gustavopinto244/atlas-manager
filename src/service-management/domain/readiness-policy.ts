export type ReadinessMode = "runtime" | "health";

export interface ReadinessPolicy {
  readonly mode: ReadinessMode;
  readonly timeoutMilliseconds: number;
  readonly pollIntervalMilliseconds: number;
}

export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_POLL_INTERVAL_MS = 500;
export const MIN_TIMEOUT_MS = 1_000;
export const MAX_TIMEOUT_MS = 120_000;
export const MIN_POLL_INTERVAL_MS = 100;
export const MAX_POLL_INTERVAL_MS = 5_000;

export class ReadinessPolicyValidationError extends Error {
  public constructor(
    public readonly code:
      | "invalid_mode"
      | "invalid_timeout"
      | "invalid_poll_interval"
      | "poll_interval_exceeds_timeout"
      | "invalid_field",
    message?: string,
  ) {
    super(message ?? `Readiness policy validation failed: ${code}`);
    this.name = "ReadinessPolicyValidationError";
    Object.freeze(this);
  }
}

export function createReadinessPolicy(
  input: Record<string, unknown>,
): ReadinessPolicy {
  const allowedFields = new Set([
    "mode",
    "timeoutMilliseconds",
    "pollIntervalMilliseconds",
  ]);
  if (Object.keys(input).some((field) => !allowedFields.has(field))) {
    throw new ReadinessPolicyValidationError("invalid_field");
  }

  const mode = validateMode(input.mode);
  const timeoutMilliseconds = validateTimeout(input.timeoutMilliseconds);
  const pollIntervalMilliseconds = validatePollInterval(
    input.pollIntervalMilliseconds,
    timeoutMilliseconds,
  );

  return Object.freeze({
    mode,
    timeoutMilliseconds,
    pollIntervalMilliseconds,
  });
}

export function defaultReadinessPolicy(): ReadinessPolicy {
  return Object.freeze({
    mode: "runtime",
    timeoutMilliseconds: DEFAULT_TIMEOUT_MS,
    pollIntervalMilliseconds: DEFAULT_POLL_INTERVAL_MS,
  });
}

function validateMode(value: unknown): ReadinessMode {
  if (typeof value !== "string") {
    throw new ReadinessPolicyValidationError("invalid_mode");
  }
  if (value !== "runtime" && value !== "health") {
    throw new ReadinessPolicyValidationError("invalid_mode");
  }
  return value;
}

function validateTimeout(value: unknown): number {
  if (value === undefined) return DEFAULT_TIMEOUT_MS;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    !Number.isFinite(value)
  ) {
    throw new ReadinessPolicyValidationError("invalid_timeout");
  }
  if (value < MIN_TIMEOUT_MS || value > MAX_TIMEOUT_MS) {
    throw new ReadinessPolicyValidationError("invalid_timeout");
  }
  return value;
}

function validatePollInterval(value: unknown, timeout: number): number {
  if (value === undefined) return DEFAULT_POLL_INTERVAL_MS;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    !Number.isFinite(value)
  ) {
    throw new ReadinessPolicyValidationError("invalid_poll_interval");
  }
  if (value < MIN_POLL_INTERVAL_MS || value > MAX_POLL_INTERVAL_MS) {
    throw new ReadinessPolicyValidationError("invalid_poll_interval");
  }
  if (value > timeout) {
    throw new ReadinessPolicyValidationError("poll_interval_exceeds_timeout");
  }
  return value;
}
