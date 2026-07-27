import type { ServiceRuntimeState } from "./registered-service-status.js";

export interface ServiceLogBatch {
  readonly serviceId: string;
  readonly collectedAt: string;
  readonly stdoutLines: readonly string[];
  readonly stderrLines: readonly string[];
  readonly truncated: boolean;
}

export function createServiceLogBatch(params: {
  serviceId: string;
  collectedAt: string;
  stdoutLines: readonly string[];
  stderrLines: readonly string[];
  truncated: boolean;
}): ServiceLogBatch {
  if (!params.serviceId || params.serviceId.trim() === "") {
    throw new Error("serviceId is required");
  }
  if (!params.collectedAt || params.collectedAt.trim() === "") {
    throw new Error("collectedAt is required");
  }

  return Object.freeze({
    serviceId: params.serviceId,
    collectedAt: params.collectedAt,
    stdoutLines: Object.freeze([...params.stdoutLines]),
    stderrLines: Object.freeze([...params.stderrLines]),
    truncated: params.truncated,
  });
}

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

export interface ComposeProjectDetails {
  readonly serviceId: string;
  readonly observedAt: string;
  readonly runtimeState: ComposeProjectAggregateRuntimeState;
  readonly healthState:
    | "not_configured"
    | "healthy"
    | "unhealthy"
    | "starting"
    | "mixed"
    | "unknown";
  readonly services: readonly ComposeProjectService[];
  readonly runningServiceCount: number;
  readonly stoppedServiceCount: number;
  readonly failedServiceCount: number;
  readonly unknownServiceCount: number;
}
