import { execFile } from "node:child_process";

import { Pm2ServiceStatusReaderError } from "./pm2-service-status-reader-error.js";

const PM2_EXECUTABLE = "pm2";
const PM2_ARGUMENTS = Object.freeze(["jlist"] as const);
const PM2_STATUS_TIMEOUT_MS = 5_000;
const PM2_STATUS_MAX_OUTPUT_BYTES = 1_048_576;

export interface Pm2ProcessListExecutor {
  execute(): Promise<string>;
}

export interface Pm2ExecFileOptions {
  readonly encoding: "utf8";
  readonly maxBuffer: number;
  readonly shell: false;
  readonly timeout: number;
  readonly windowsHide: true;
}

export type Pm2ExecFile = (
  executable: string,
  arguments_: readonly string[],
  options: Pm2ExecFileOptions,
) => Promise<string>;

const executeFile: Pm2ExecFile = (executable, arguments_, options) =>
  new Promise((resolve, reject) => {
    execFile(executable, [...arguments_], options, (error, stdout) => {
      if (error !== null) {
        reject(
          error instanceof Error
            ? error
            : new Error("PM2 process-list execution failed"),
        );
        return;
      }

      resolve(stdout);
    });
  });

export class NodePm2ProcessListExecutor implements Pm2ProcessListExecutor {
  public constructor(private readonly runFile: Pm2ExecFile = executeFile) {}

  public async execute(): Promise<string> {
    try {
      return await this.runFile(PM2_EXECUTABLE, PM2_ARGUMENTS, {
        encoding: "utf8",
        maxBuffer: PM2_STATUS_MAX_OUTPUT_BYTES,
        shell: false,
        timeout: PM2_STATUS_TIMEOUT_MS,
        windowsHide: true,
      });
    } catch (error) {
      if (isTimeoutError(error)) {
        throw new Pm2ServiceStatusReaderError("pm2_status_timeout");
      }

      if (isOutputLimitError(error)) {
        throw new Pm2ServiceStatusReaderError("pm2_status_output_invalid");
      }

      throw new Pm2ServiceStatusReaderError("pm2_status_command_failed");
    }
  }
}

function isTimeoutError(error: unknown): boolean {
  if (!isObject(error)) {
    return false;
  }

  return error["killed"] === true && error["signal"] !== undefined;
}

function isOutputLimitError(error: unknown): boolean {
  return (
    isObject(error) && error["code"] === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
