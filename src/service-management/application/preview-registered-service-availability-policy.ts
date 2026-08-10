import { createServiceAvailabilityPolicy } from "../../service-scheduling/domain/service-availability-policy.js";
import { evaluateRegisteredServiceAvailabilityForInterval } from "../domain/registered-service-availability-interval.js";
import type { RegisteredServiceAvailabilityInterval } from "../domain/registered-service-availability-interval.js";
import type { RegisteredServiceCatalog } from "./ports/registered-service-catalog.js";
import type { ServiceAvailabilityOverrideStore } from "./ports/service-availability-override-store.js";
import { RegisteredServiceNotFoundError } from "./registered-service-not-found-error.js";

export interface PreviewRegisteredServiceAvailabilityPolicyInput {
  readonly serviceId: string;
  readonly policy: unknown;
  readonly startsAt: string;
  readonly endsAt: string;
}

export type PreviewRegisteredServiceAvailabilityPolicyResult =
  RegisteredServiceAvailabilityInterval &
    Readonly<{ source: "candidate_preview" }>;

// Evaluates a candidate (unsaved) availability policy over an interval
// without persisting it, reusing the same domain validation
// (createServiceAvailabilityPolicy) and the same evaluator
// (evaluateRegisteredServiceAvailabilityForInterval) the authoritative save
// and interval-preview paths already use, so the browser never computes
// transitions on its own -- it only renders what this use case returns.
//
// The "source" tag is added here, at the application boundary, rather than
// inside the shared domain evaluator: the same evaluator also backs
// GetRegisteredServiceAvailabilityForInterval's persisted-policy preview,
// and that call site has no reason to carry a "candidate" label.
export class PreviewRegisteredServiceAvailabilityPolicy {
  public constructor(
    private readonly catalog: RegisteredServiceCatalog,
    private readonly overrideStore: ServiceAvailabilityOverrideStore,
  ) {
    Object.freeze(this);
  }

  public async execute(
    input: PreviewRegisteredServiceAvailabilityPolicyInput,
  ): Promise<PreviewRegisteredServiceAvailabilityPolicyResult> {
    const service = await this.catalog.findById(input.serviceId);
    if (service === null) throw new RegisteredServiceNotFoundError();

    const policy = createServiceAvailabilityPolicy(input.policy);
    const override = await this.overrideStore.findByServiceId(service.id);

    const interval = evaluateRegisteredServiceAvailabilityForInterval(
      service.id,
      policy,
      override,
      input.startsAt,
      input.endsAt,
    );

    return Object.freeze({ ...interval, source: "candidate_preview" as const });
  }
}
