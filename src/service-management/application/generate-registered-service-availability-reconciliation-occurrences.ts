import { calculateServiceAvailabilityPolicyTransitions } from "../../service-scheduling/domain/service-availability-policy-transition-calculator.js";
import { ServiceAvailabilityReconciliationOccurrence } from "../domain/service-availability-reconciliation-occurrence.js";
import type { ServiceAvailabilityReconciliationOperation } from "../domain/service-availability-reconciliation-decision.js";
import type { RegisteredServiceCatalog } from "./ports/registered-service-catalog.js";
import { RegisteredServiceNotFoundError } from "./registered-service-not-found-error.js";

const EMPTY_OCCURRENCES = Object.freeze(
  [] as ServiceAvailabilityReconciliationOccurrence[],
);

export class GenerateRegisteredServiceAvailabilityReconciliationOccurrences {
  public constructor(
    private readonly registeredServiceCatalog: RegisteredServiceCatalog,
  ) {}

  public async execute(
    serviceId: string,
    fromExclusive: Date,
    toInclusive: Date,
  ): Promise<readonly ServiceAvailabilityReconciliationOccurrence[]> {
    const registeredService =
      await this.registeredServiceCatalog.findById(serviceId);

    if (registeredService === null) {
      throw new RegisteredServiceNotFoundError();
    }

    const transitions = calculateServiceAvailabilityPolicyTransitions(
      registeredService.availabilityPolicy,
      fromExclusive,
      toInclusive,
    );

    if (transitions.length === 0) {
      return EMPTY_OCCURRENCES;
    }

    return Object.freeze(
      transitions.map((transition) =>
        ServiceAvailabilityReconciliationOccurrence.create({
          serviceId: registeredService.id,
          operation: mapTransitionToOperation(transition.kind),
          scheduledFor: transition.scheduledFor,
        }),
      ),
    );
  }
}

function mapTransitionToOperation(
  transitionKind: "became_available" | "became_unavailable",
): ServiceAvailabilityReconciliationOperation {
  return transitionKind === "became_available" ? "start" : "stop";
}
