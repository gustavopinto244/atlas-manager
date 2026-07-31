import type {
  ExecuteRegisteredServiceAvailabilityReconciliationOccurrence,
  ExecuteRegisteredServiceAvailabilityReconciliationOccurrenceResult,
} from "./execute-registered-service-availability-reconciliation-occurrence.js";
import type { GenerateRegisteredServiceAvailabilityReconciliationOccurrences } from "./generate-registered-service-availability-reconciliation-occurrences.js";
import type { ListRegisteredServices } from "./list-registered-services.js";
import type { RegisteredServiceDependencyGraph } from "../domain/dependency-graph.js";
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

interface CollectedOccurrence {
  readonly occurrence: ServiceAvailabilityReconciliationOccurrence;
  readonly serviceId: string;
}

export class RunServiceAvailabilityReconciliationTick {
  public constructor(
    private readonly listRegisteredServices: ListRegisteredServices,
    private readonly generateOccurrences: GenerateRegisteredServiceAvailabilityReconciliationOccurrences,
    private readonly executeOccurrence: ExecuteRegisteredServiceAvailabilityReconciliationOccurrence,
    private readonly getGraph: () => Promise<RegisteredServiceDependencyGraph>,
  ) {}

  public async execute(
    fromExclusive: Date,
    toInclusive: Date,
  ): Promise<readonly ServiceAvailabilityReconciliationTickServiceResult[]> {
    const services = await this.listRegisteredServices.execute();
    const graph = await this.getGraph();
    const allOccurrences: CollectedOccurrence[] = [];
    const generationFailures: ServiceAvailabilityReconciliationTickServiceResult[] =
      [];

    for (const service of services) {
      try {
        const occurrences = await this.generateOccurrences.execute(
          service.id,
          fromExclusive,
          toInclusive,
        );

        for (const occurrence of occurrences) {
          allOccurrences.push({ occurrence, serviceId: service.id });
        }
      } catch (error) {
        generationFailures.push(
          Object.freeze({
            kind: "failed",
            serviceId: service.id,
            error,
          }),
        );
      }
    }

    const ordered = orderCollectedOccurrences(allOccurrences, graph);
    const serviceResultMap = new Map<
      string,
      {
        kind: "completed";
        serviceId: string;
        occurrenceResults: ServiceAvailabilityReconciliationTickOccurrenceResult[];
      }
    >();

    for (const collected of ordered) {
      const { occurrence, serviceId } = collected;
      let serviceResult = serviceResultMap.get(serviceId);

      if (!serviceResult) {
        serviceResult = {
          kind: "completed",
          serviceId,
          occurrenceResults: [],
        };
        serviceResultMap.set(serviceId, serviceResult);
      }

      try {
        const result = await this.executeOccurrence.execute(occurrence);

        serviceResult.occurrenceResults.push(
          Object.freeze({
            kind: "completed",
            occurrence,
            result,
          }),
        );
      } catch (error) {
        serviceResult.occurrenceResults.push(
          Object.freeze({
            kind: "failed",
            occurrence,
            error,
          }),
        );
      }
    }

    const tickResults: ServiceAvailabilityReconciliationTickServiceResult[] = [
      ...generationFailures,
    ];

    for (const service of services) {
      const serviceResult = serviceResultMap.get(service.id);
      if (serviceResult) {
        tickResults.push(
          Object.freeze({
            kind: "completed",
            serviceId: serviceResult.serviceId,
            occurrenceResults: Object.freeze(serviceResult.occurrenceResults),
          }),
        );
      } else if (
        !generationFailures.some(
          (f) => f.kind === "failed" && f.serviceId === service.id,
        )
      ) {
        tickResults.push(
          Object.freeze({
            kind: "completed",
            serviceId: service.id,
            occurrenceResults: Object.freeze([]),
          }),
        );
      }
    }

    return Object.freeze(tickResults);
  }
}

function orderCollectedOccurrences(
  collected: readonly CollectedOccurrence[],
  graph: RegisteredServiceDependencyGraph,
): readonly CollectedOccurrence[] {
  const groupedByScheduledFor = new Map<string, CollectedOccurrence[]>();

  for (const entry of collected) {
    const key = entry.occurrence.scheduledFor;
    const group = groupedByScheduledFor.get(key) ?? [];
    group.push(entry);
    groupedByScheduledFor.set(key, group);
  }

  const sortedKeys = [...groupedByScheduledFor.keys()].sort();
  const result: CollectedOccurrence[] = [];

  for (const key of sortedKeys) {
    const group = groupedByScheduledFor.get(key)!;
    const stops = group.filter((c) => c.occurrence.operation === "stop");
    const starts = group.filter((c) => c.occurrence.operation === "start");

    if (stops.length > 0) {
      const stopServiceIds = stops.map((c) => c.serviceId);
      const orderedStopIds = graph.topologicalDependentsFirst(stopServiceIds);
      const orderedStops: CollectedOccurrence[] = [];

      for (const id of orderedStopIds) {
        for (const stop of stops) {
          if (stop.serviceId === id && !orderedStops.includes(stop)) {
            orderedStops.push(stop);
          }
        }
      }

      result.push(...orderedStops);
    }

    if (starts.length > 0) {
      const startServiceIds = starts.map((c) => c.serviceId);
      const orderedStartIds =
        graph.topologicalDependenciesFirst(startServiceIds);
      const orderedStarts: CollectedOccurrence[] = [];

      for (const id of orderedStartIds) {
        for (const start of starts) {
          if (start.serviceId === id && !orderedStarts.includes(start)) {
            orderedStarts.push(start);
          }
        }
      }

      result.push(...orderedStarts);
    }
  }

  return Object.freeze(result);
}
