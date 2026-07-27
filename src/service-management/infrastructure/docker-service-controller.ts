import type { RegisteredService } from "../domain/registered-service.js";
import type { ServiceControlOperation } from "../domain/registered-service-control-result.js";
import type { ServiceController } from "../application/ports/service-controller.js";
import type { DockerContainerControlExecutor } from "./docker-container-control-executor.js";
import type { DockerContainerInspectExecutor } from "./docker-container-inspect-executor.js";

export class DockerServiceControllerError extends Error {
  public constructor(
    public readonly code:
      | "unsupported_adapter"
      | "invalid_operation"
      | "target_not_found"
      | "inspection_timeout"
      | "inspection_failed"
      | "inspection_output_invalid"
      | "control_timeout"
      | "control_command_failed",
    message?: string,
  ) {
    super(message ?? `Docker service controller failed: ${code}`);
    this.name = "DockerServiceControllerError";
    Object.freeze(this);
  }
}

export class DockerServiceController implements ServiceController {
  public constructor(
    private readonly inspectExecutor: DockerContainerInspectExecutor,
    private readonly controlExecutor: DockerContainerControlExecutor,
  ) {
    Object.freeze(this);
  }

  public async execute(
    service: RegisteredService,
    operation: ServiceControlOperation,
  ): Promise<void> {
    if (service.managementAdapter !== "docker") {
      throw new DockerServiceControllerError("unsupported_adapter");
    }

    if (
      operation !== "start" &&
      operation !== "stop" &&
      operation !== "restart"
    ) {
      throw new DockerServiceControllerError("invalid_operation");
    }

    try {
      await this.controlExecutor.execute(operation, service.externalResourceId);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      if (errorMessage.includes("target_not_found")) {
        await this.verifyTargetExists(service.externalResourceId);
        throw new DockerServiceControllerError("target_not_found");
      }

      if (errorMessage.includes("control_timeout")) {
        throw new DockerServiceControllerError("control_timeout");
      }

      throw new DockerServiceControllerError("control_command_failed");
    }
  }

  private async verifyTargetExists(target: string): Promise<void> {
    try {
      await this.inspectExecutor.execute(target);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      if (errorMessage.includes("inspection_timeout")) {
        throw new DockerServiceControllerError("inspection_timeout");
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
        throw new DockerServiceControllerError("inspection_output_invalid");
      }

      throw new DockerServiceControllerError("inspection_failed");
    }
  }
}
