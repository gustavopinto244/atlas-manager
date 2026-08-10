import {
  evaluateServiceAvailabilityWithOverride,
  isServiceAvailabilityOverrideExpiredAt,
} from "../../service-scheduling/domain/service-availability-override-evaluator.js";
import type { ServiceAvailabilityExpectation } from "../../service-scheduling/domain/service-availability-policy-evaluator.js";
import type { ServiceAvailabilityOverride } from "../../service-scheduling/domain/service-availability-override.js";
import type { Clock } from "./ports/clock.js";
import type { RegisteredServiceCatalog } from "./ports/registered-service-catalog.js";
import type { ServiceAvailabilityOverrideStore } from "./ports/service-availability-override-store.js";
import { RegisteredServiceNotFoundError } from "./registered-service-not-found-error.js";

export interface GetRegisteredServiceEffectiveAvailabilityPort {
  readonly execute: (
    serviceId: string,
  ) => Promise<ServiceAvailabilityExpectation>;
}

export interface RegisteredServiceEffectiveAvailabilityWithOverride {
  readonly expectation: ServiceAvailabilityExpectation;
  readonly override: ServiceAvailabilityOverride | null;
}

export class GetRegisteredServiceEffectiveAvailability implements GetRegisteredServiceEffectiveAvailabilityPort {
  public constructor(
    private readonly catalog: RegisteredServiceCatalog,
    private readonly overrideStore: ServiceAvailabilityOverrideStore,
    private readonly clock: Clock,
  ) {}

  public async execute(
    serviceId: string,
  ): Promise<ServiceAvailabilityExpectation> {
    const result = await this.resolve(serviceId);
    return result.expectation;
  }

  // Additive sibling to execute() that also surfaces the raw override (kind
  // + expiresAt) driving that expectation, for callers that need to render
  // "why" as well as "what" (e.g. the administrative availability response).
  // execute() stays string-returning so the existing port contract and its
  // callers (dependency-gating in orchestrate-registered-service-control.ts)
  // are untouched.
  public async executeWithOverride(
    serviceId: string,
  ): Promise<RegisteredServiceEffectiveAvailabilityWithOverride> {
    return this.resolve(serviceId);
  }

  private async resolve(
    serviceId: string,
  ): Promise<RegisteredServiceEffectiveAvailabilityWithOverride> {
    const service = await this.catalog.findById(serviceId);

    if (service === null) {
      throw new RegisteredServiceNotFoundError();
    }

    const override = await this.overrideStore.findByServiceId(service.id);
    const evaluationInstant = this.clock.now();

    const expectation = evaluateServiceAvailabilityWithOverride(
      service.availabilityPolicy,
      override,
      evaluationInstant,
    );

    const activeOverride =
      override !== null &&
      !isServiceAvailabilityOverrideExpiredAt(override, evaluationInstant)
        ? override
        : null;

    return { expectation, override: activeOverride };
  }
}
