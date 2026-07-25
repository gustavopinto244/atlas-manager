import { evaluateServiceAvailabilityWithOverride } from "../../service-scheduling/domain/service-availability-override-evaluator.js";
import {
  decideServiceAvailabilityReconciliation,
  type ServiceAvailabilityReconciliationDecision,
} from "../domain/service-availability-reconciliation-decision.js";
import type { Clock } from "./ports/clock.js";
import type { RegisteredServiceCatalog } from "./ports/registered-service-catalog.js";
import type { ServiceAvailabilityOverrideStore } from "./ports/service-availability-override-store.js";
import type { ServiceStatusReader } from "./ports/service-status-reader.js";
import { RegisteredServiceNotFoundError } from "./registered-service-not-found-error.js";

export class PlanRegisteredServiceAvailabilityReconciliation {
  public constructor(
    private readonly catalog: RegisteredServiceCatalog,
    private readonly overrideStore: ServiceAvailabilityOverrideStore,
    private readonly statusReader: ServiceStatusReader,
    private readonly clock: Clock,
  ) {}

  public async execute(
    serviceId: string,
  ): Promise<ServiceAvailabilityReconciliationDecision> {
    const service = await this.catalog.findById(serviceId);

    if (service === null) {
      throw new RegisteredServiceNotFoundError();
    }

    const override = await this.overrideStore.findByServiceId(service.id);
    const runtimeState = await this.statusReader.read(service);
    const reconciliationInstant = this.clock.now();
    const expectation = evaluateServiceAvailabilityWithOverride(
      service.availabilityPolicy,
      override,
      reconciliationInstant,
    );

    return decideServiceAvailabilityReconciliation(expectation, runtimeState);
  }
}
