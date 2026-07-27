import type { RegisteredService } from "../domain/registered-service.js";
import type { ServiceRuntimeState } from "../domain/registered-service-status.js";
import type { ServiceStatusReader } from "../application/ports/service-status-reader.js";
import type { DockerComposeProjectStatusExecutor } from "./docker-compose-executors.js";
import { parseComposeProjectStatus } from "./compose-status-parser.js";

export class ComposeServiceStatusReaderError extends Error {
  public constructor(
    public readonly code:
      | "unsupported_adapter"
      | "status_timeout"
      | "status_failed"
      | "status_output_invalid"
      | "target_not_found",
    message?: string,
  ) {
    super(message ?? `Compose service status reader failed: ${code}`);
    this.name = "ComposeServiceStatusReaderError";
    Object.freeze(this);
  }
}

export class ComposeServiceStatusReader implements ServiceStatusReader {
  public constructor(
    private readonly statusExecutor: DockerComposeProjectStatusExecutor,
  ) {
    Object.freeze(this);
  }

  public async read(service: RegisteredService): Promise<ServiceRuntimeState> {
    if (service.managementAdapter !== "docker-compose") {
      throw new ComposeServiceStatusReaderError("unsupported_adapter");
    }

    const config = service.managementConfiguration;
    if (!config) {
      throw new ComposeServiceStatusReaderError("target_not_found");
    }

    try {
      const output = await this.statusExecutor.execute(
        service.externalResourceId,
        config.projectDirectory,
        config.composeFile,
      );
      const parsed = parseComposeProjectStatus(output);
      return parsed.runtimeState;
    } catch (error) {
      if (error instanceof ComposeServiceStatusReaderError) {
        throw error;
      }
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("timeout")) {
        throw new ComposeServiceStatusReaderError("status_timeout");
      }
      throw new ComposeServiceStatusReaderError("status_failed");
    }
  }
}
