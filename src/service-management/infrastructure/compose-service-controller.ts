import type { RegisteredService } from "../domain/registered-service.js";
import type { ServiceControlOperation } from "../domain/registered-service-control-result.js";
import type { ServiceController } from "../application/ports/service-controller.js";
import type { DockerComposeProjectControlExecutor } from "./docker-compose-executors.js";

export class ComposeServiceControllerError extends Error {
  public constructor(
    public readonly code:
      | "unsupported_adapter"
      | "invalid_operation"
      | "target_not_found"
      | "control_timeout"
      | "control_command_failed",
    message?: string,
  ) {
    super(message ?? `Compose service controller failed: ${code}`);
    this.name = "ComposeServiceControllerError";
    Object.freeze(this);
  }
}

export class ComposeServiceController implements ServiceController {
  public constructor(
    private readonly controlExecutor: DockerComposeProjectControlExecutor,
  ) {
    Object.freeze(this);
  }

  public async execute(
    service: RegisteredService,
    operation: ServiceControlOperation,
  ): Promise<void> {
    if (service.managementAdapter !== "docker-compose") {
      throw new ComposeServiceControllerError("unsupported_adapter");
    }

    if (
      operation !== "start" &&
      operation !== "stop" &&
      operation !== "restart"
    ) {
      throw new ComposeServiceControllerError("invalid_operation");
    }

    const config = service.managementConfiguration;
    if (!config) {
      throw new ComposeServiceControllerError("target_not_found");
    }

    try {
      await this.controlExecutor.execute(
        operation,
        service.externalResourceId,
        config.projectDirectory,
        config.composeFile,
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("timeout")) {
        throw new ComposeServiceControllerError("control_timeout");
      }
      throw new ComposeServiceControllerError("control_command_failed");
    }
  }
}
