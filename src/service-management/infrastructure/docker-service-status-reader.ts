import type { RegisteredService } from "../domain/registered-service.js";
import type { ServiceRuntimeState } from "../domain/registered-service-status.js";
import type { ServiceStatusReader } from "../application/ports/service-status-reader.js";
import type { DockerContainerInspectExecutor } from "./docker-container-inspect-executor.js";
import { parseDockerInspectOutput } from "./docker-inspect-output-parser.js";

export class DockerServiceStatusReaderError extends Error {
  public constructor(
    public readonly code:
      | "unsupported_adapter"
      | "inspection_timeout"
      | "inspection_failed"
      | "inspection_output_invalid"
      | "target_not_found",
    message?: string,
  ) {
    super(message ?? `Docker service status reader failed: ${code}`);
    this.name = "DockerServiceStatusReaderError";
    Object.freeze(this);
  }
}

export class DockerServiceStatusReader implements ServiceStatusReader {
  public constructor(
    private readonly inspectExecutor: DockerContainerInspectExecutor,
  ) {
    Object.freeze(this);
  }

  public async read(service: RegisteredService): Promise<ServiceRuntimeState> {
    if (service.managementAdapter !== "docker") {
      throw new DockerServiceStatusReaderError("unsupported_adapter");
    }

    try {
      const output = await this.inspectExecutor.execute(
        service.externalResourceId,
      );
      const parsed = parseDockerInspectOutput(output);

      return parsed.runtimeState;
    } catch (error) {
      if (error instanceof DockerServiceStatusReaderError) {
        throw error;
      }

      const errorMessage =
        error instanceof Error ? error.message : String(error);

      if (errorMessage.includes("inspection_timeout")) {
        throw new DockerServiceStatusReaderError("inspection_timeout");
      }

      if (errorMessage.includes("target_not_found")) {
        throw new DockerServiceStatusReaderError("target_not_found");
      }

      if (
        errorMessage.includes("invalid_json") ||
        errorMessage.includes("invalid_array") ||
        errorMessage.includes("empty_array") ||
        errorMessage.includes("multiple_entries") ||
        errorMessage.includes("missing_state") ||
        errorMessage.includes("invalid_timestamp") ||
        errorMessage.includes("invalid_image")
      ) {
        throw new DockerServiceStatusReaderError("inspection_output_invalid");
      }

      throw new DockerServiceStatusReaderError("inspection_failed");
    }
  }
}
