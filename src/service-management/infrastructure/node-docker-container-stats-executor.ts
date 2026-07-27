import { execFile } from "node:child_process";

import type { DockerContainerStatsExecutor } from "./docker-container-stats-executor.js";
import { DockerContainerStatsExecutorError } from "./docker-container-stats-executor.js";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BUFFER_BYTES = 1_048_576;

const STATS_FORMAT =
  '{"CPU":"{{.CPUPerc}}","MemUsage":"{{.MemUsage}}","MemPerc":"{{.MemPerc}}","NetIO":"{{.NetIO}}","BlockIO":"{{.BlockIO}}","PIDs":"{{.PIDs}}"}';

export interface NodeDockerContainerStatsExecutorDependencies {
  readonly execFile: typeof execFile;
  readonly timeoutMs: number;
  readonly maxBufferBytes: number;
}

const defaultDependencies: NodeDockerContainerStatsExecutorDependencies =
  Object.freeze({
    execFile,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxBufferBytes: DEFAULT_MAX_BUFFER_BYTES,
  });

export class NodeDockerContainerStatsExecutor implements DockerContainerStatsExecutor {
  readonly #dependencies: NodeDockerContainerStatsExecutorDependencies;

  public constructor(
    dependencies: Partial<NodeDockerContainerStatsExecutorDependencies> = {},
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
        ["container", "stats", "--no-stream", "--format", STATS_FORMAT, target],
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
                new DockerContainerStatsExecutorError(
                  "docker_executable_not_found",
                ),
              );
              return;
            }

            if (error.killed) {
              reject(new DockerContainerStatsExecutorError("stats_timeout"));
              return;
            }

            const errorMessage = stderr ?? error.message ?? "";

            if (errorMessage.includes("connection refused")) {
              reject(
                new DockerContainerStatsExecutorError(
                  "docker_daemon_unavailable",
                ),
              );
              return;
            }

            if (errorMessage.includes("permission denied")) {
              reject(
                new DockerContainerStatsExecutorError(
                  "docker_permission_denied",
                ),
              );
              return;
            }

            if (errorMessage.includes("No such object")) {
              reject(new DockerContainerStatsExecutorError("target_not_found"));
              return;
            }

            reject(
              new DockerContainerStatsExecutorError("stats_command_failed"),
            );
            return;
          }

          resolve(stdout);
        },
      );
    });
  }
}
