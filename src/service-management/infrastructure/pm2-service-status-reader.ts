import type { ServiceStatusReader } from "../application/ports/service-status-reader.js";
import type { RegisteredService } from "../domain/registered-service.js";
import type { ServiceRuntimeState } from "../domain/registered-service-status.js";
import type { Pm2ProcessListExecutor } from "./pm2-process-list-executor.js";
import { Pm2ServiceStatusReaderError } from "./pm2-service-status-reader-error.js";

interface Pm2ProcessReference {
  readonly name: string;
  readonly status: unknown;
}

export class Pm2ServiceStatusReader implements ServiceStatusReader {
  public constructor(private readonly executor: Pm2ProcessListExecutor) {}

  public async read(service: RegisteredService): Promise<ServiceRuntimeState> {
    if (service.managementAdapter !== "pm2") {
      throw new Pm2ServiceStatusReaderError("unsupported_status_adapter");
    }

    const output = await this.executor.execute();
    const processes = parseProcessReferences(output);
    const matchingProcesses = processes.filter(
      (process) => process.name === service.externalResourceId,
    );

    if (matchingProcesses.length === 0) {
      throw new Pm2ServiceStatusReaderError("pm2_service_not_found");
    }

    if (matchingProcesses.length > 1) {
      throw new Pm2ServiceStatusReaderError("duplicate_pm2_service");
    }

    const matchingProcess = matchingProcesses[0];

    if (matchingProcess === undefined) {
      throw new Pm2ServiceStatusReaderError("pm2_status_output_invalid");
    }

    return mapPm2Status(readPm2Status(matchingProcess.status));
  }
}

function parseProcessReferences(
  output: string,
): readonly Pm2ProcessReference[] {
  let parsedOutput: unknown;

  try {
    parsedOutput = JSON.parse(output);
  } catch {
    throw new Pm2ServiceStatusReaderError("pm2_status_output_invalid");
  }

  if (!Array.isArray(parsedOutput)) {
    throw new Pm2ServiceStatusReaderError("pm2_status_output_invalid");
  }

  return parsedOutput.map((entry) => {
    if (!isObject(entry) || typeof entry["name"] !== "string") {
      throw new Pm2ServiceStatusReaderError("pm2_status_output_invalid");
    }

    const environment = entry["pm2_env"];

    return {
      name: entry["name"],
      status: isObject(environment) ? environment["status"] : undefined,
    };
  });
}

function readPm2Status(status: unknown): string {
  if (typeof status !== "string") {
    throw new Pm2ServiceStatusReaderError("pm2_status_output_invalid");
  }

  return status;
}

function mapPm2Status(status: string): ServiceRuntimeState {
  switch (status) {
    case "online":
      return "running";
    case "stopped":
      return "stopped";
    case "errored":
      return "failed";
    default:
      return "unknown";
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
