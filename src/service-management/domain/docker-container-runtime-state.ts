export type DockerContainerRuntimeState =
  "running" | "stopped" | "failed" | "unknown";

export const DOCKER_CONTAINER_RUNTIME_STATES: readonly DockerContainerRuntimeState[] =
  Object.freeze(["running", "stopped", "failed", "unknown"]);

export function isDockerContainerRuntimeState(
  value: string,
): value is DockerContainerRuntimeState {
  return (DOCKER_CONTAINER_RUNTIME_STATES as readonly string[]).includes(value);
}

export function mapDockerStateToRuntimeState(
  dockerState: string,
): DockerContainerRuntimeState {
  switch (dockerState.toLowerCase()) {
    case "running":
      return "running";
    case "created":
    case "exited":
      return "stopped";
    case "dead":
      return "failed";
    case "paused":
    case "restarting":
    case "removing":
    default:
      return "unknown";
  }
}
