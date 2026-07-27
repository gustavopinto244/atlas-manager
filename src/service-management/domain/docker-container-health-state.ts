export type DockerContainerHealthState =
  "not_configured" | "starting" | "healthy" | "unhealthy" | "unknown";

export const DOCKER_CONTAINER_HEALTH_STATES: readonly DockerContainerHealthState[] =
  Object.freeze([
    "not_configured",
    "starting",
    "healthy",
    "unhealthy",
    "unknown",
  ]);

export function isDockerContainerHealthState(
  value: string,
): value is DockerContainerHealthState {
  return (DOCKER_CONTAINER_HEALTH_STATES as readonly string[]).includes(value);
}
