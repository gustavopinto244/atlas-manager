import type {
  ExecuteRegisteredServiceAvailabilityReconciliationOccurrence,
  ExecuteRegisteredServiceAvailabilityReconciliationOccurrenceResult,
} from "./execute-registered-service-availability-reconciliation-occurrence.js";
import type { GenerateRegisteredServiceAvailabilityReconciliationOccurrences } from "./generate-registered-service-availability-reconciliation-occurrences.js";
import type { ListRegisteredServices } from "./list-registered-services.js";
import type { ServiceAvailabilityReconciliationOccurrence } from "../domain/service-availability-reconciliation-occurrence.js";

export type ServiceAvailabilityReconciliationTickOccurrenceResult =
  | Readonly<{
      kind: "completed";
      occurrence: ServiceAvailabilityReconciliationOccurrence;
      result: ExecuteRegisteredServiceAvailabilityReconciliationOccurrenceResult;
    }>
  | Readonly<{
      kind: "failed";
      occurrence: ServiceAvailabilityReconciliationOccurrence;
      error: unknown;
    }>;

export type ServiceAvailabilityReconciliationTickServiceResult =
  | Readonly<{
      kind: "completed";
      serviceId: string;
      occurrenceResults: readonly ServiceAvailabilityReconciliationTickOccurrenceResult[];
    }>
  | Readonly<{
      kind: "failed";
      serviceId: string;
      error: unknown;
    }>;

export class RunServiceAvailabilityReconciliationTick {
  public constructor(
    private readonly listRegisteredServices: ListRegisteredServices,
    private readonly generateOccurrences: GenerateRegisteredServiceAvailabilityReconciliationOccurrences,
    private readonly executeOccurrence: ExecuteRegisteredServiceAvailabilityReconciliationOccurrence,
  ) {}

  public async execute(
    fromExclusive: Date,
    toInclusive: Date,
  ): Promise<readonly ServiceAvailabilityReconciliationTickServiceResult[]> {
    const services = await this.listRegisteredServices.execute();
    const serviceResults: ServiceAvailabilityReconciliationTickServiceResult[] =
      [];

    for (const service of services) {
      let occurrences: readonly ServiceAvailabilityReconciliationOccurrence[];

      try {
        occurrences = await this.generateOccurrences.execute(
          service.id,
          fromExclusive,
          toInclusive,
        );
      } catch (error) {
        serviceResults.push(
          Object.freeze({
            kind: "failed",
            serviceId: service.id,
            error,
          }),
        );
        continue;
      }

      const occurrenceResults: ServiceAvailabilityReconciliationTickOccurrenceResult[] =
        [];

      for (const occurrence of occurrences) {
        try {
          const result = await this.executeOccurrence.execute(occurrence);

          occurrenceResults.push(
            Object.freeze({
              kind: "completed",
              occurrence,
              result,
            }),
          );
        } catch (error) {
          occurrenceResults.push(
            Object.freeze({
              kind: "failed",
              occurrence,
              error,
            }),
          );
        }
      }

      serviceResults.push(
        Object.freeze({
          kind: "completed",
          serviceId: service.id,
          occurrenceResults: Object.freeze(occurrenceResults),
        }),
      );
    }

    return Object.freeze(serviceResults);
  }
}
