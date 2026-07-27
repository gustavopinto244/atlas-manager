export interface DockerComposeProjectStatusExecutor {
  execute(
    projectName: string,
    projectDirectory: string,
    composeFile: string,
  ): Promise<string>;
}

export class DockerComposeProjectStatusExecutorError extends Error {
  public constructor(
    public readonly code:
      | "docker_executable_not_found"
      | "docker_daemon_unavailable"
      | "status_timeout"
      | "status_output_exceeded"
      | "status_command_failed"
      | "target_not_found",
    message?: string,
  ) {
    super(message ?? `Docker Compose project status executor failed: ${code}`);
    this.name = "DockerComposeProjectStatusExecutorError";
    Object.freeze(this);
  }
}

export interface DockerComposeProjectControlExecutor {
  execute(
    operation: "start" | "stop" | "restart",
    projectName: string,
    projectDirectory: string,
    composeFile: string,
  ): Promise<void>;
}

export class DockerComposeProjectControlExecutorError extends Error {
  public constructor(
    public readonly code:
      | "docker_executable_not_found"
      | "docker_daemon_unavailable"
      | "control_timeout"
      | "control_output_exceeded"
      | "control_command_failed"
      | "target_not_found",
    message?: string,
  ) {
    super(message ?? `Docker Compose project control executor failed: ${code}`);
    this.name = "DockerComposeProjectControlExecutorError";
    Object.freeze(this);
  }
}

export interface DockerComposeProjectLogExecutor {
  execute(
    projectName: string,
    projectDirectory: string,
    composeFile: string,
    tailLines: number,
  ): Promise<{ stdout: string; stderr: string }>;
}

export class DockerComposeProjectLogExecutorError extends Error {
  public constructor(
    public readonly code:
      | "docker_executable_not_found"
      | "docker_daemon_unavailable"
      | "log_timeout"
      | "log_output_exceeded"
      | "log_command_failed"
      | "target_not_found",
    message?: string,
  ) {
    super(message ?? `Docker Compose project log executor failed: ${code}`);
    this.name = "DockerComposeProjectLogExecutorError";
    Object.freeze(this);
  }
}

export interface DockerContainerLogExecutor {
  execute(
    target: string,
    tailLines: number,
  ): Promise<{ stdout: string; stderr: string }>;
}

export class DockerContainerLogExecutorError extends Error {
  public constructor(
    public readonly code:
      | "docker_executable_not_found"
      | "docker_daemon_unavailable"
      | "log_timeout"
      | "log_output_exceeded"
      | "log_command_failed"
      | "target_not_found",
    message?: string,
  ) {
    super(message ?? `Docker container log executor failed: ${code}`);
    this.name = "DockerContainerLogExecutorError";
    Object.freeze(this);
  }
}
