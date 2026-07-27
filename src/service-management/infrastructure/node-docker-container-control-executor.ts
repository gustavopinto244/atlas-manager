import { execFile } from "node:child_process";

import type { DockerContainerControlExecutor } from "./docker-container-control-executor.js";
import type { DockerContainerControlOperation } from "./docker-container-control-executor.js";
import { DockerContainerControlExecutorError } from "./docker-container-control-executor.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BUFFER_BYTES = 1_048_576;
const STOP_TIMEOUT_SECONDS = 10;

export interface NodeDockerContainerControlExecutorDependencies {
  readonly execFile: typeof execFile;
  readonly timeoutMs: number;
  readonly maxBufferBytes: number;
  readonly stopTimeoutSeconds: number;
}

const defaultDependencies: NodeDockerContainerControlExecutorDependencies =
  Object.freeze({
    execFile,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxBufferBytes: DEFAULT_MAX_BUFFER_BYTES,
    stopTimeoutSeconds: STOP_TIMEOUT_SECONDS,
  });

export class NodeDockerContainerControlExecutor implements DockerContainerControlExecutor {
  readonly #dependencies: NodeDockerContainerControlExecutorDependencies;

  public constructor(
    dependencies: Partial<NodeDockerContainerControlExecutorDependencies> = {},
  ) {
    this.#dependencies = Object.freeze({
      ...defaultDependencies,
      ...dependencies,
    });
    Object.freeze(this);
  }

  public async execute(
    operation: DockerContainerControlOperation,
    target: string,
  ): Promise<void> {
    if (!target || target.trim() === "") {
      throw new Error("Docker container target is required");
    }

    const args = ["container", operation, target];

    if (operation === "stop" || operation === "restart") {
      args.splice(
        2,
        0,
        "--time",
        String(this.#dependencies.stopTimeoutSeconds),
      );
    }

    return new Promise((resolve, reject) => {
      this.#dependencies.execFile(
        "docker",
        args,
        {
          shell: false,
          encoding: "utf8",
          timeout: this.#dependencies.timeoutMs,
          maxBuffer: this.#dependencies.maxBufferBytes,
          windowsHide: true,
        },
        (error, _stdout, stderr) => {
          if (error) {
            if (error.code === "ENOENT") {
              reject(
                new DockerContainerControlExecutorError(
                  "docker_executable_not_found",
                ),
              );
              return;
            }

            if (error.killed) {
              reject(
                new DockerContainerControlExecutorError("control_timeout"),
              );
              return;
            }

            const errorMessage = stderr ?? error.message ?? "";

            if (errorMessage.includes("connection refused")) {
              reject(
                new DockerContainerControlExecutorError(
                  "docker_daemon_unavailable",
                ),
              );
              return;
            }

            if (errorMessage.includes("permission denied")) {
              reject(
                new DockerContainerControlExecutorError(
                  "docker_permission_denied",
                ),
              );
              return;
            }

            if (errorMessage.includes("No such container")) {
              reject(
                new DockerContainerControlExecutorError("target_not_found"),
              );
              return;
            }

            reject(
              new DockerContainerControlExecutorError("control_command_failed"),
            );
            return;
          }

          resolve();
        },
      );
    });
  }
}
