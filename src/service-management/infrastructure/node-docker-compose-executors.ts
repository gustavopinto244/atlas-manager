import { execFile } from "node:child_process";

import type {
  DockerComposeProjectStatusExecutor,
  DockerComposeProjectControlExecutor,
  DockerComposeProjectLogExecutor,
  DockerContainerLogExecutor,
} from "./docker-compose-executors.js";
import {
  DockerComposeProjectStatusExecutorError,
  DockerComposeProjectControlExecutorError,
  DockerComposeProjectLogExecutorError,
  DockerContainerLogExecutorError,
} from "./docker-compose-executors.js";

const DEFAULT_STATUS_TIMEOUT_MS = 10_000;
const DEFAULT_CONTROL_TIMEOUT_MS = 30_000;
const DEFAULT_LOG_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BUFFER_BYTES = 1_048_576;

export interface ExecFileLike {
  (
    file: string,
    args: readonly string[],
    options: {
      shell: false;
      encoding: "utf8";
      timeout: number;
      maxBuffer: number;
      windowsHide: boolean;
    },
    callback: (
      error: (Error & { code?: string; killed?: boolean }) | null,
      stdout: string,
      stderr: string,
    ) => void,
  ): void;
}

export class NodeDockerComposeProjectStatusExecutor implements DockerComposeProjectStatusExecutor {
  readonly #execFile: ExecFileLike;
  readonly #timeoutMs: number;
  readonly #maxBufferBytes: number;

  public constructor(deps?: {
    execFile?: ExecFileLike;
    timeoutMs?: number;
    maxBufferBytes?: number;
  }) {
    this.#execFile = deps?.execFile ?? (execFile as unknown as ExecFileLike);
    this.#timeoutMs = deps?.timeoutMs ?? DEFAULT_STATUS_TIMEOUT_MS;
    this.#maxBufferBytes = deps?.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES;
    Object.freeze(this);
  }

  public async execute(
    projectName: string,
    projectDirectory: string,
    composeFile: string,
  ): Promise<string> {
    return this.#execDocker(
      [
        "compose",
        "--project-name",
        projectName,
        "--project-directory",
        projectDirectory,
        "--file",
        composeFile,
        "ps",
        "--all",
        "--format",
        "json",
      ],
      this.#timeoutMs,
      this.#maxBufferBytes,
      new DockerComposeProjectStatusExecutorError("status_command_failed"),
    );
  }

  #execDocker(
    args: readonly string[],
    timeoutMs: number,
    maxBufferBytes: number,
    defaultError: Error,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      this.#execFile(
        "docker",
        args,
        {
          shell: false,
          encoding: "utf8",
          timeout: timeoutMs,
          maxBuffer: maxBufferBytes,
          windowsHide: true,
        },
        (error, stdout: string) => {
          if (error) {
            if (error.code === "ENOENT") {
              reject(
                Object.assign(new Error("Docker executable not found"), {
                  code: "docker_executable_not_found",
                }),
              );
              return;
            }

            if (error.killed) {
              reject(defaultError);
              return;
            }

            reject(defaultError);
            return;
          }

          resolve(stdout);
        },
      );
    });
  }
}

export class NodeDockerComposeProjectControlExecutor implements DockerComposeProjectControlExecutor {
  readonly #execFile: ExecFileLike;
  readonly #timeoutMs: number;
  readonly #maxBufferBytes: number;

  public constructor(deps?: {
    execFile?: ExecFileLike;
    timeoutMs?: number;
    maxBufferBytes?: number;
  }) {
    this.#execFile = deps?.execFile ?? (execFile as unknown as ExecFileLike);
    this.#timeoutMs = deps?.timeoutMs ?? DEFAULT_CONTROL_TIMEOUT_MS;
    this.#maxBufferBytes = deps?.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES;
    Object.freeze(this);
  }

  public async execute(
    operation: "start" | "stop" | "restart",
    projectName: string,
    projectDirectory: string,
    composeFile: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      this.#execFile(
        "docker",
        [
          "compose",
          "--project-name",
          projectName,
          "--project-directory",
          projectDirectory,
          "--file",
          composeFile,
          operation,
        ],
        {
          shell: false,
          encoding: "utf8",
          timeout: this.#timeoutMs,
          maxBuffer: this.#maxBufferBytes,
          windowsHide: true,
        },
        (error) => {
          if (error) {
            reject(
              new DockerComposeProjectControlExecutorError(
                "control_command_failed",
              ),
            );
            return;
          }

          resolve();
        },
      );
    });
  }
}

export class NodeDockerComposeProjectLogExecutor implements DockerComposeProjectLogExecutor {
  readonly #execFile: ExecFileLike;
  readonly #timeoutMs: number;
  readonly #maxBufferBytes: number;

  public constructor(deps?: {
    execFile?: ExecFileLike;
    timeoutMs?: number;
    maxBufferBytes?: number;
  }) {
    this.#execFile = deps?.execFile ?? (execFile as unknown as ExecFileLike);
    this.#timeoutMs = deps?.timeoutMs ?? DEFAULT_LOG_TIMEOUT_MS;
    this.#maxBufferBytes = deps?.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES;
    Object.freeze(this);
  }

  public async execute(
    projectName: string,
    projectDirectory: string,
    composeFile: string,
    tailLines: number,
  ): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      this.#execFile(
        "docker",
        [
          "compose",
          "--project-name",
          projectName,
          "--project-directory",
          projectDirectory,
          "--file",
          composeFile,
          "logs",
          "--no-color",
          "--timestamps",
          "--tail",
          String(tailLines),
        ],
        {
          shell: false,
          encoding: "utf8",
          timeout: this.#timeoutMs,
          maxBuffer: this.#maxBufferBytes,
          windowsHide: true,
        },
        (error, out) => {
          if (error) {
            reject(
              new DockerComposeProjectLogExecutorError("log_command_failed"),
            );
            return;
          }

          resolve({ stdout: out, stderr: "" });
        },
      );
    });
  }
}

export class NodeDockerContainerLogExecutor implements DockerContainerLogExecutor {
  readonly #execFile: ExecFileLike;
  readonly #timeoutMs: number;
  readonly #maxBufferBytes: number;

  public constructor(deps?: {
    execFile?: ExecFileLike;
    timeoutMs?: number;
    maxBufferBytes?: number;
  }) {
    this.#execFile = deps?.execFile ?? (execFile as unknown as ExecFileLike);
    this.#timeoutMs = deps?.timeoutMs ?? DEFAULT_LOG_TIMEOUT_MS;
    this.#maxBufferBytes = deps?.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES;
    Object.freeze(this);
  }

  public async execute(
    target: string,
    tailLines: number,
  ): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      this.#execFile(
        "docker",
        [
          "container",
          "logs",
          "--timestamps",
          "--tail",
          String(tailLines),
          target,
        ],
        {
          shell: false,
          encoding: "utf8",
          timeout: this.#timeoutMs,
          maxBuffer: this.#maxBufferBytes,
          windowsHide: true,
        },
        (error, out) => {
          if (error) {
            reject(new DockerContainerLogExecutorError("log_command_failed"));
            return;
          }

          resolve({ stdout: out, stderr: "" });
        },
      );
    });
  }
}
