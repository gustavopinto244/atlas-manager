import type { ServiceController } from "../application/ports/service-controller.js";
import type { RegisteredService } from "../domain/registered-service.js";
import {
  SERVICE_CONTROL_OPERATIONS,
  type ServiceControlOperation,
} from "../domain/registered-service-control-result.js";
import type { Pm2ProcessListExecutor } from "./pm2-process-list-executor.js";
import {
  Pm2ServiceStatusReaderError,
  type Pm2ServiceStatusReaderErrorCode,
} from "./pm2-service-status-reader-error.js";
import type { Pm2ServiceControlExecutor } from "./pm2-service-control-executor.js";
import { Pm2ServiceControllerError } from "./pm2-service-controller-error.js";

interface Pm2ControlTargetReference {
  readonly name: string;
  readonly processId: unknown;
}

const controlOperationAllowlist = new Set<string>(SERVICE_CONTROL_OPERATIONS);

export class Pm2ServiceController implements ServiceController {
  public constructor(
    private readonly processListExecutor: Pm2ProcessListExecutor,
    private readonly controlExecutor: Pm2ServiceControlExecutor,
  ) {}

  public async execute(
    service: RegisteredService,
    operation: ServiceControlOperation,
  ): Promise<void> {
    if (service.managementAdapter !== "pm2") {
      throw new Pm2ServiceControllerError("unsupported_control_adapter");
    }

    if (!controlOperationAllowlist.has(operation)) {
      throw new Pm2ServiceControllerError("pm2_control_operation_invalid");
    }

    const output = await this.readProcessList();
    const targets = parseControlTargetReferences(output);
    const matchingTargets = targets.filter(
      (target) => target.name === service.externalResourceId,
    );

    if (matchingTargets.length === 0) {
      throw new Pm2ServiceControllerError("pm2_control_target_not_found");
    }

    if (matchingTargets.length > 1) {
      throw new Pm2ServiceControllerError("duplicate_pm2_control_target");
    }

    const matchingTarget = matchingTargets[0];

    if (
      matchingTarget === undefined ||
      !isValidPm2ProcessId(matchingTarget.processId)
    ) {
      throw new Pm2ServiceControllerError("pm2_control_target_invalid");
    }

    await this.controlExecutor.execute(operation, matchingTarget.processId);
  }

  private async readProcessList(): Promise<string> {
    try {
      return await this.processListExecutor.execute();
    } catch (error) {
      if (
        error instanceof Pm2ServiceStatusReaderError &&
        isStatusTimeout(error.code)
      ) {
        throw new Pm2ServiceControllerError("pm2_control_timeout");
      }

      throw new Pm2ServiceControllerError("pm2_control_command_failed");
    }
  }
}

function parseControlTargetReferences(
  output: string,
): readonly Pm2ControlTargetReference[] {
  let parsedOutput: unknown;

  try {
    parsedOutput = JSON.parse(output);
  } catch {
    throw new Pm2ServiceControllerError("pm2_control_process_list_invalid");
  }

  if (!Array.isArray(parsedOutput)) {
    throw new Pm2ServiceControllerError("pm2_control_process_list_invalid");
  }

  return parsedOutput.map((entry) => {
    if (!isObject(entry) || typeof entry["name"] !== "string") {
      throw new Pm2ServiceControllerError("pm2_control_process_list_invalid");
    }

    return {
      name: entry["name"],
      processId: entry["pm_id"],
    };
  });
}

function isValidPm2ProcessId(processId: unknown): processId is number {
  return (
    typeof processId === "number" &&
    Number.isSafeInteger(processId) &&
    processId >= 0
  );
}

function isStatusTimeout(code: Pm2ServiceStatusReaderErrorCode): boolean {
  return code === "pm2_status_timeout";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
