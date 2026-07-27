export interface DockerContainerStatsExecutor {
  execute(target: string): Promise<string>;
}

export class DockerContainerStatsExecutorError extends Error {
  public constructor(
    public readonly code:
      | "docker_executable_not_found"
      | "docker_daemon_unavailable"
      | "docker_permission_denied"
      | "target_not_found"
      | "stats_timeout"
      | "stats_output_exceeded"
      | "stats_command_failed",
    message?: string,
  ) {
    super(message ?? `Docker container stats executor failed: ${code}`);
    this.name = "DockerContainerStatsExecutorError";
    Object.freeze(this);
  }
}
