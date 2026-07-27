export type DockerContainerControlOperation = "start" | "stop" | "restart";

export interface DockerContainerControlExecutor {
  execute(
    operation: DockerContainerControlOperation,
    target: string,
  ): Promise<void>;
}

export class DockerContainerControlExecutorError extends Error {
  public constructor(
    public readonly code:
      | "docker_executable_not_found"
      | "docker_daemon_unavailable"
      | "docker_permission_denied"
      | "target_not_found"
      | "control_timeout"
      | "control_output_exceeded"
      | "control_command_failed",
    message?: string,
  ) {
    super(message ?? `Docker container control executor failed: ${code}`);
    this.name = "DockerContainerControlExecutorError";
    Object.freeze(this);
  }
}
