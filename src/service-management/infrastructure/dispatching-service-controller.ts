import type { ServiceController } from "../application/ports/service-controller.js";
import type { RegisteredService } from "../domain/registered-service.js";
import type { ServiceControlOperation } from "../domain/registered-service-control-result.js";

export interface DispatchingServiceControllerDependencies {
  readonly mock: ServiceController;
  readonly pm2: ServiceController;
  readonly docker: ServiceController;
  readonly "docker-compose"?: ServiceController;
}

export class DispatchingServiceControllerError extends Error {
  public override readonly name = "DispatchingServiceControllerError";
  public readonly code = "service_controller_unavailable";

  public constructor() {
    super("Service controller unavailable");
  }
}

export class DispatchingServiceController implements ServiceController {
  private readonly mockController: ServiceController;
  private readonly pm2Controller: ServiceController;
  private readonly dockerController: ServiceController;
  private readonly composeController: ServiceController;

  public constructor(dependencies: DispatchingServiceControllerDependencies) {
    if (
      !isServiceController(dependencies?.mock) ||
      !isServiceController(dependencies?.pm2) ||
      !isServiceController(dependencies?.docker)
    ) {
      throw new DispatchingServiceControllerError();
    }

    this.mockController = dependencies.mock;
    this.pm2Controller = dependencies.pm2;
    this.dockerController = dependencies.docker;
    this.composeController =
      dependencies["docker-compose"] ?? this.dockerController;
    Object.freeze(this);
  }

  public execute(
    service: RegisteredService,
    operation: ServiceControlOperation,
  ): Promise<void> {
    switch (service.managementAdapter) {
      case "mock":
        return this.mockController.execute(service, operation);
      case "pm2":
        return this.pm2Controller.execute(service, operation);
      case "docker":
        return this.dockerController.execute(service, operation);
      case "docker-compose":
        return this.composeController.execute(service, operation);
      default:
        return Promise.reject(new DispatchingServiceControllerError());
    }
  }
}

function isServiceController(value: unknown): value is ServiceController {
  return (
    typeof value === "object" &&
    value !== null &&
    "execute" in value &&
    typeof value.execute === "function"
  );
}
