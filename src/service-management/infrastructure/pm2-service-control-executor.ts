import { execFile } from "node:child_process";

import {
  SERVICE_CONTROL_OPERATIONS,
  type ServiceControlOperation,
} from "../domain/registered-service-control-result.js";
import { Pm2ServiceControllerError } from "./pm2-service-controller-error.js";

const PM2_EXECUTABLE = "pm2";
const PM2_CONTROL_TIMEOUT_MS = 5_000;
const PM2_CONTROL_MAX_OUTPUT_BYTES = 1_048_576;
const controlOperationAllowlist = new Set<string>(SERVICE_CONTROL_OPERATIONS);

export interface Pm2ServiceControlExecutor {
  execute(operation: ServiceControlOperation, processId: number): Promise<void>;
}

export interface Pm2ControlExecFileOptions {
  readonly encoding: "utf8";
  readonly maxBuffer: number;
  readonly shell: false;
  readonly timeout: number;
  readonly windowsHide: true;
}

export type Pm2ControlExecFile = (
  executable: string,
  arguments_: readonly string[],
  options: Pm2ControlExecFileOptions,
) => Promise<void>;

const executeFile: Pm2ControlExecFile = (executable, arguments_, options) =>
  new Promise((resolve, reject) => {
    execFile(executable, [...arguments_], options, (error) => {
      if (error !== null) {
        reject(
          error instanceof Error
            ? error
            : new Error("PM2 service-control execution failed"),
        );
        return;
      }

      resolve();
    });
  });

export class NodePm2ServiceControlExecutor implements Pm2ServiceControlExecutor {
  public constructor(
    private readonly runFile: Pm2ControlExecFile = executeFile,
  ) {}

  public async execute(
    operation: ServiceControlOperation,
    processId: number,
  ): Promise<void> {
    if (
      !controlOperationAllowlist.has(operation) ||
      !isValidPm2ProcessId(processId)
    ) {
      throw new Pm2ServiceControllerError("pm2_control_command_failed");
    }

    try {
      await this.runFile(PM2_EXECUTABLE, [operation, String(processId)], {
        encoding: "utf8",
        maxBuffer: PM2_CONTROL_MAX_OUTPUT_BYTES,
        shell: false,
        timeout: PM2_CONTROL_TIMEOUT_MS,
        windowsHide: true,
      });
    } catch (error) {
      if (isTimeoutError(error)) {
        throw new Pm2ServiceControllerError("pm2_control_timeout");
      }

      throw new Pm2ServiceControllerError("pm2_control_command_failed");
    }
  }
}

function isValidPm2ProcessId(processId: unknown): processId is number {
  return (
    typeof processId === "number" &&
    Number.isSafeInteger(processId) &&
    processId >= 0
  );
}

function isTimeoutError(error: unknown): boolean {
  return (
    isObject(error) && error["killed"] === true && error["signal"] !== undefined
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
