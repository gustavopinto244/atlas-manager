import { execFile } from "node:child_process";

import type { DockerContainerInspectExecutor } from "./docker-container-inspect-executor.js";
import { DockerContainerInspectExecutorError } from "./docker-container-inspect-executor.js";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BUFFER_BYTES = 1_048_576;

export interface NodeDockerContainerInspectExecutorDependencies {
  readonly execFile: typeof execFile;
  readonly timeoutMs: number;
  readonly maxBufferBytes: number;
}

const defaultDependencies: NodeDockerContainerInspectExecutorDependencies =
  Object.freeze({
    execFile,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxBufferBytes: DEFAULT_MAX_BUFFER_BYTES,
  });

export class NodeDockerContainerInspectExecutor implements DockerContainerInspectExecutor {
  readonly #dependencies: NodeDockerContainerInspectExecutorDependencies;

  public constructor(
    dependencies: Partial<NodeDockerContainerInspectExecutorDependencies> = {},
  ) {
    this.#dependencies = Object.freeze({
      ...defaultDependencies,
      ...dependencies,
    });
    Object.freeze(this);
  }

  public async execute(target: string): Promise<string> {
    if (!target || target.trim() === "") {
      throw new Error("Docker container target is required");
    }

    return new Promise((resolve, reject) => {
      this.#dependencies.execFile(
        "docker",
        ["container", "inspect", target],
        {
          shell: false,
          encoding: "utf8",
          timeout: this.#dependencies.timeoutMs,
          maxBuffer: this.#dependencies.maxBufferBytes,
          windowsHide: true,
        },
        (error, stdout, stderr) => {
          if (error) {
            if (error.code === "ENOENT") {
              reject(
                new DockerContainerInspectExecutorError(
                  "docker_executable_not_found",
                ),
              );
              return;
            }

            if (error.killed) {
              reject(
                new DockerContainerInspectExecutorError("inspection_timeout"),
              );
              return;
            }

            const errorMessage = stderr ?? error.message ?? "";

            if (errorMessage.includes("connection refused")) {
              reject(
                new DockerContainerInspectExecutorError(
                  "docker_daemon_unavailable",
                ),
              );
              return;
            }

            if (errorMessage.includes("permission denied")) {
              reject(
                new DockerContainerInspectExecutorError(
                  "docker_permission_denied",
                ),
              );
              return;
            }

            if (errorMessage.includes("No such object")) {
              reject(
                new DockerContainerInspectExecutorError("target_not_found"),
              );
              return;
            }

            reject(
              new DockerContainerInspectExecutorError(
                "inspection_command_failed",
              ),
            );
            return;
          }

          resolve(stdout);
        },
      );
    });
  }
}
