/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment */
import type { Clock } from "./ports/clock.js";
import type { RegisteredServiceCatalog } from "./ports/registered-service-catalog.js";
import type { ServiceController } from "./ports/service-controller.js";
import type { ServiceStatusReader } from "./ports/service-status-reader.js";
import type { RegisteredServiceDependencyGraph } from "../domain/dependency-graph.js";
import {
  createRegisteredServicesStopResult,
  type RegisteredServicesStopResult,
} from "../domain/registered-services-stop-result.js";

export interface OrchestrateRegisteredServicesStopPort {
  execute(
    input: unknown,
    requestedAt?: string,
  ): Promise<RegisteredServicesStopResult>;
}

export class OrchestrateRegisteredServicesStop implements OrchestrateRegisteredServicesStopPort {
  public constructor(
    private readonly catalog: RegisteredServiceCatalog,
    private readonly status: ServiceStatusReader,
    private readonly controller: ServiceController,
    private readonly getGraph: () => Promise<RegisteredServiceDependencyGraph>,
    private readonly clock: Clock,
  ) {
    Object.freeze(this);
  }
  public async execute(
    input: unknown,
    requestedAt?: string,
  ): Promise<RegisteredServicesStopResult> {
    const data = validateInput(input, requestedAt ?? this.#now());
    let services: Map<
      string,
      Awaited<ReturnType<RegisteredServiceCatalog["list"]>>[number]
    >;
    try {
      services = new Map(
        (await this.catalog.list()).map((service) => [service.id, service]),
      );
    } catch {
      return failedResult(data.requestedAt, data.serviceIds[0]!);
    }
    if (data.serviceIds.some((id) => !services.has(id)))
      throw new Error("service_plan_invalid");
    const snapshots = new Map<
      string,
      "running" | "stopped" | "failed" | "unknown"
    >();
    for (const id of data.serviceIds) {
      try {
        snapshots.set(id, await this.status.read(services.get(id)!));
      } catch {
        snapshots.set(id, "unknown");
      }
    }
    let graph: RegisteredServiceDependencyGraph;
    try {
      graph = await this.getGraph();
    } catch {
      return failedResult(data.requestedAt, data.serviceIds[0]!);
    }
    let order: readonly string[];
    try {
      order = dependentFirstRequestedOrder(data.serviceIds, graph);
    } catch {
      return failedResult(data.requestedAt, data.serviceIds[0]!);
    }
    const steps: Array<{
      serviceId: string;
      outcome: "stopped" | "already_stopped" | "failed";
      failureCode?:
        | "service_status_failed"
        | "service_stop_not_supported"
        | "service_stop_failed"
        | "service_plan_invalid";
    }> = [];
    for (const id of order) {
      const state = snapshots.get(id);
      if (!state) {
        steps.push({
          serviceId: id,
          outcome: "failed",
          failureCode: "service_plan_invalid",
        });
        break;
      }
      if (state === "stopped") {
        steps.push({ serviceId: id, outcome: "already_stopped" });
        continue;
      }
      if (state !== "running") {
        steps.push({
          serviceId: id,
          outcome: "failed",
          failureCode: "service_status_failed",
        });
        break;
      }
      const service = services.get(id)!;
      if (!service.supportedOperations.includes("stop")) {
        steps.push({
          serviceId: id,
          outcome: "failed",
          failureCode: "service_stop_not_supported",
        });
        break;
      }
      try {
        await this.controller.execute(service, "stop");
        steps.push({ serviceId: id, outcome: "stopped" });
      } catch {
        steps.push({
          serviceId: id,
          outcome: "failed",
          failureCode: "service_stop_failed",
        });
        break;
      }
    }
    return createRegisteredServicesStopResult({
      authority: "machine_shutdown",
      requestedAt: data.requestedAt,
      steps,
      successful: !steps.some((step) => step.outcome === "failed"),
    });
  }

  readonly #now = (): string => this.clock.now().toISOString();
}

function failedResult(
  requestedAt: string,
  serviceId: string,
): RegisteredServicesStopResult {
  return createRegisteredServicesStopResult({
    authority: "machine_shutdown",
    requestedAt,
    steps: [
      {
        serviceId,
        outcome: "failed",
        failureCode: "service_plan_invalid",
      },
    ],
    successful: false,
  });
}

function validateInput(
  input: unknown,
  now: string,
): { serviceIds: readonly string[]; requestedAt: string } {
  if (
    !isRecord(input) ||
    input.authority !== "machine_shutdown" ||
    !Array.isArray(input.serviceIds)
  )
    throw new Error("service_plan_invalid");
  if (
    input.serviceIds.length < 1 ||
    input.serviceIds.length > 64 ||
    input.serviceIds.some(
      (id) => typeof id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(id),
    )
  )
    throw new Error("service_plan_invalid");
  const ids = [...input.serviceIds] as string[];
  if (
    new Set(ids).size !== ids.length ||
    Reflect.ownKeys(input).some(
      (key) =>
        typeof key !== "string" || !["serviceIds", "authority"].includes(key),
    )
  )
    throw new Error("service_plan_invalid");
  return {
    serviceIds: Object.freeze(ids),
    requestedAt: now,
  };
}

function dependentFirstRequestedOrder(
  requested: readonly string[],
  graph: RegisteredServiceDependencyGraph,
): readonly string[] {
  const remaining = new Set(requested);
  const result: string[] = [];
  while (remaining.size > 0) {
    const ready = [...remaining]
      .filter((id) =>
        graph
          .directDependentsOf(id)
          .every((dependent) => !remaining.has(dependent)),
      )
      .sort();
    if (ready.length === 0) throw new Error("service_plan_invalid");
    for (const id of ready) {
      remaining.delete(id);
      result.push(id);
    }
  }
  return Object.freeze(result);
}
function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
