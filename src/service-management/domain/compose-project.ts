import type { ServiceRuntimeState } from "./registered-service-status.js";

export type ComposeProjectAggregateRuntimeState =
  "running" | "stopped" | "failed" | "unknown";

export function calculateComposeAggregateRuntimeState(
  serviceStates: readonly ServiceRuntimeState[],
): ComposeProjectAggregateRuntimeState {
  if (serviceStates.length === 0) {
    return "unknown";
  }

  const hasFailed = serviceStates.some((s) => s === "failed");
  if (hasFailed) return "failed";

  const hasUnknown = serviceStates.some((s) => s === "unknown");
  if (hasUnknown) return "unknown";

  const allRunning = serviceStates.every((s) => s === "running");
  if (allRunning) return "running";

  const allStopped = serviceStates.every((s) => s === "stopped");
  if (allStopped) return "stopped";

  return "unknown";
}

export interface ComposeProjectService {
  readonly serviceName: string;
  readonly runtimeState: ServiceRuntimeState;
  readonly healthState: "healthy" | "unhealthy" | "starting" | "none";
  readonly exitCode: number | null;
}

export type ComposeProjectAggregateHealthState =
  "not_configured" | "healthy" | "unhealthy" | "starting" | "mixed" | "unknown";

export function calculateComposeAggregateHealthState(
  services: readonly ComposeProjectService[],
): ComposeProjectAggregateHealthState {
  if (services.length === 0) {
    return "unknown";
  }

  const healthStates = services.map((s) => s.healthState);

  const hasUnhealthy = healthStates.some((h) => h === "unhealthy");
  if (hasUnhealthy) return "unhealthy";

  const hasStarting = healthStates.some((h) => h === "starting");
  if (hasStarting) return "starting";

  const hasConfig = healthStates.some((h) => h !== "none");
  const allNone = healthStates.every((h) => h === "none");

  if (allNone) return "not_configured";

  if (hasConfig && !allNone) {
    const configHealth = healthStates.filter((h) => h !== "none");
    const allHealthy = configHealth.every((h) => h === "healthy");
    if (allHealthy) return "mixed";
    return "unknown";
  }

  const allHealthy = healthStates.every((h) => h === "healthy");
  if (allHealthy) return "healthy";

  return "unknown";
}

export interface ComposeProjectDetails {
  readonly serviceId: string;
  readonly observedAt: string;
  readonly runtimeState: ComposeProjectAggregateRuntimeState;
  readonly healthState: ComposeProjectAggregateHealthState;
  readonly services: readonly ComposeProjectService[];
  readonly runningServiceCount: number;
  readonly stoppedServiceCount: number;
  readonly failedServiceCount: number;
  readonly unknownServiceCount: number;
}

export function createComposeProjectDetails(params: {
  serviceId: string;
  observedAt: string;
  runtimeState: ComposeProjectAggregateRuntimeState;
  healthState: ComposeProjectAggregateHealthState;
  services: readonly ComposeProjectService[];
  runningServiceCount: number;
  stoppedServiceCount: number;
  failedServiceCount: number;
  unknownServiceCount: number;
}): ComposeProjectDetails {
  if (!params.serviceId || params.serviceId.trim() === "") {
    throw new Error("serviceId is required");
  }
  if (!params.observedAt || params.observedAt.trim() === "") {
    throw new Error("observedAt is required");
  }

  const total =
    params.runningServiceCount +
    params.stoppedServiceCount +
    params.failedServiceCount +
    params.unknownServiceCount;

  if (total !== params.services.length) {
    throw new Error("service counts must match the total number of services");
  }

  return Object.freeze({
    serviceId: params.serviceId,
    observedAt: params.observedAt,
    runtimeState: params.runtimeState,
    healthState: params.healthState,
    services: Object.freeze(
      params.services.map((s) => Object.freeze({ ...s })),
    ),
    runningServiceCount: params.runningServiceCount,
    stoppedServiceCount: params.stoppedServiceCount,
    failedServiceCount: params.failedServiceCount,
    unknownServiceCount: params.unknownServiceCount,
  });
}
