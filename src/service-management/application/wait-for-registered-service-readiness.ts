import type { Clock } from "./ports/clock.js";
import type { ServiceReadinessReader } from "./ports/service-readiness-reader.js";
import type { ServiceReadinessTimer } from "./ports/service-readiness-timer.js";
import type { RegisteredServiceCatalog } from "./ports/registered-service-catalog.js";
import { RegisteredServiceNotFoundError } from "./registered-service-not-found-error.js";

export class RegisteredServiceReadinessTimeoutError extends Error {
  public readonly serviceId: string;

  public constructor(serviceId: string) {
    super(`Readiness timeout for registered service: ${serviceId}`);
    this.name = "RegisteredServiceReadinessTimeoutError";
    this.serviceId = serviceId;
    Object.freeze(this);
  }
}

export class InvalidReadinessPolicyError extends Error {
  public constructor(message: string) {
    super(`Invalid readiness policy: ${message}`);
    this.name = "InvalidReadinessPolicyError";
    Object.freeze(this);
  }
}

export interface WaitForRegisteredServiceReadinessPort {
  readonly execute: (serviceId: string) => Promise<void | {
    readonly serviceId: string;
    readonly observedAt: string;
  }>;
}

function computeMaxAttempts(
  timeoutMilliseconds: number,
  pollIntervalMilliseconds: number,
): number {
  if (
    !Number.isFinite(timeoutMilliseconds) ||
    !Number.isFinite(pollIntervalMilliseconds)
  ) {
    throw new InvalidReadinessPolicyError(
      `timeout and pollInterval must be finite numbers (got timeout=${timeoutMilliseconds}, pollInterval=${pollIntervalMilliseconds})`,
    );
  }

  if (
    !Number.isInteger(timeoutMilliseconds) ||
    !Number.isInteger(pollIntervalMilliseconds)
  ) {
    throw new InvalidReadinessPolicyError(
      `timeout and pollInterval must be integers (got timeout=${timeoutMilliseconds}, pollInterval=${pollIntervalMilliseconds})`,
    );
  }

  if (timeoutMilliseconds <= 0) {
    throw new InvalidReadinessPolicyError(
      `timeout must be positive (got ${timeoutMilliseconds})`,
    );
  }

  if (pollIntervalMilliseconds <= 0) {
    throw new InvalidReadinessPolicyError(
      `pollInterval must be positive (got ${pollIntervalMilliseconds})`,
    );
  }

  return Math.ceil(timeoutMilliseconds / pollIntervalMilliseconds) + 1;
}

export class WaitForRegisteredServiceReadiness implements WaitForRegisteredServiceReadinessPort {
  public constructor(
    private readonly catalog: RegisteredServiceCatalog,
    private readonly readinessReader: ServiceReadinessReader,
    private readonly timer: ServiceReadinessTimer,
    private readonly clock: Clock,
  ) {
    Object.freeze(this);
  }

  public async execute(serviceId: string): Promise<{
    readonly serviceId: string;
    readonly observedAt: string;
  }> {
    const service = await this.catalog.findById(serviceId);
    if (!service) {
      throw new RegisteredServiceNotFoundError();
    }

    const policy = service.readinessPolicy;
    const maxAttempts = computeMaxAttempts(
      policy.timeoutMilliseconds,
      policy.pollIntervalMilliseconds,
    );

    const startTime = this.clock.now().getTime();
    const deadline = startTime + policy.timeoutMilliseconds;
    let attempts = 0;

    while (attempts < maxAttempts) {
      attempts++;
      const result = await this.readinessReader.check(service);
      if (result.state === "ready") {
        return Object.freeze({
          serviceId,
          observedAt: result.observedAt,
        });
      }

      const now = this.clock.now().getTime();
      if (now >= deadline) {
        throw new RegisteredServiceReadinessTimeoutError(serviceId);
      }

      const remaining = deadline - now;
      const waitTime = Math.min(policy.pollIntervalMilliseconds, remaining);
      if (waitTime < 1) {
        throw new RegisteredServiceReadinessTimeoutError(serviceId);
      }
      await this.timer.sleep(waitTime);
    }

    throw new RegisteredServiceReadinessTimeoutError(serviceId);
  }
}
