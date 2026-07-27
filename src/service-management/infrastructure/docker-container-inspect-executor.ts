export interface DockerContainerInspectExecutor {
  execute(target: string): Promise<string>;
}

export class DockerContainerInspectExecutorError extends Error {
  public constructor(
    public readonly code:
      | "docker_executable_not_found"
      | "docker_daemon_unavailable"
      | "docker_permission_denied"
      | "target_not_found"
      | "inspection_timeout"
      | "inspection_output_exceeded"
      | "inspection_command_failed",
    message?: string,
  ) {
    super(message ?? `Docker container inspect executor failed: ${code}`);
    this.name = "DockerContainerInspectExecutorError";
    Object.freeze(this);
  }
}
