import {
  getServiceAvailabilityEvaluationTimestamp,
  isServiceAvailabilityOverrideExpiredAt,
} from "../../service-scheduling/domain/service-availability-override-evaluator.js";
import type { ListRegisteredServices } from "./list-registered-services.js";
import type { Clock } from "./ports/clock.js";
import type { ServiceAvailabilityOverrideStore } from "./ports/service-availability-override-store.js";

export type PruneExpiredRegisteredServiceAvailabilityOverridesServiceResult =
  | Readonly<{
      kind: "no_override";
      serviceId: string;
    }>
  | Readonly<{
      kind: "active";
      serviceId: string;
    }>
  | Readonly<{
      kind: "removed";
      serviceId: string;
    }>
  | Readonly<{
      kind: "not_removed";
      serviceId: string;
    }>
  | Readonly<{
      kind: "failed";
      serviceId: string;
      error: unknown;
    }>;

export class PruneExpiredRegisteredServiceAvailabilityOverrides {
  public constructor(
    private readonly listRegisteredServices: ListRegisteredServices,
    private readonly overrideStore: ServiceAvailabilityOverrideStore,
    private readonly clock: Clock,
  ) {}

  public async execute(): Promise<
    readonly PruneExpiredRegisteredServiceAvailabilityOverridesServiceResult[]
  > {
    const services = await this.listRegisteredServices.execute();
    const pruningInstant = this.clock.now();

    getServiceAvailabilityEvaluationTimestamp(pruningInstant);

    const results: PruneExpiredRegisteredServiceAvailabilityOverridesServiceResult[] =
      [];

    for (const service of services) {
      try {
        const override = await this.overrideStore.findByServiceId(service.id);

        if (override === null) {
          results.push(
            Object.freeze({
              kind: "no_override",
              serviceId: service.id,
            }),
          );
          continue;
        }

        if (!isServiceAvailabilityOverrideExpiredAt(override, pruningInstant)) {
          results.push(
            Object.freeze({
              kind: "active",
              serviceId: service.id,
            }),
          );
          continue;
        }

        const removalResult =
          await this.overrideStore.removeByServiceIdIfMatches(
            service.id,
            override,
          );

        results.push(
          Object.freeze({
            kind: removalResult.kind,
            serviceId: service.id,
          }),
        );
      } catch (error) {
        results.push(
          Object.freeze({
            kind: "failed",
            serviceId: service.id,
            error,
          }),
        );
      }
    }

    return Object.freeze(results);
  }
}
