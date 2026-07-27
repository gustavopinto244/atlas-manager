import type { DockerContainerHealthState } from "./docker-container-health-state.js";
import type { DockerContainerResourceUsage } from "./docker-container-resource-usage.js";
import type { DockerContainerRuntimeState } from "./docker-container-runtime-state.js";

export interface DockerContainerDetails {
  readonly serviceId: string;
  readonly runtimeState: DockerContainerRuntimeState;
  readonly healthState: DockerContainerHealthState;
  readonly observedAt: string;
  readonly startedAt: string | null;
  readonly uptimeSeconds: number | null;
  readonly image: string;
  readonly resourceUsage: DockerContainerResourceUsage;
}

export function createDockerContainerDetails(params: {
  serviceId: string;
  runtimeState: DockerContainerRuntimeState;
  healthState: DockerContainerHealthState;
  observedAt: string;
  startedAt: string | null;
  uptimeSeconds: number | null;
  image: string;
  resourceUsage: DockerContainerResourceUsage;
}): DockerContainerDetails {
  if (!params.serviceId || params.serviceId.trim() === "") {
    throw new Error("serviceId is required");
  }
  if (!params.observedAt || params.observedAt.trim() === "") {
    throw new Error("observedAt is required");
  }
  if (!params.image || params.image.trim() === "") {
    throw new Error("image is required");
  }
  if (params.uptimeSeconds !== null && params.uptimeSeconds < 0) {
    throw new Error("uptimeSeconds cannot be negative");
  }

  return Object.freeze({
    serviceId: params.serviceId,
    runtimeState: params.runtimeState,
    healthState: params.healthState,
    observedAt: params.observedAt,
    startedAt: params.startedAt,
    uptimeSeconds: params.uptimeSeconds,
    image: params.image,
    resourceUsage: params.resourceUsage,
  });
}
