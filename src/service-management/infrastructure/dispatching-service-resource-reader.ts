import type { ServiceResourceReader } from "../application/ports/service-resource-reader.js";
import type { RegisteredService } from "../domain/registered-service.js";
import type { ServiceResourceObservation } from "../domain/service-resource-observation.js";
import { createUnavailableServiceResourceObservation } from "../domain/service-resource-observation.js";
import type { Clock } from "../application/ports/clock.js";

export interface DispatchingServiceResourceReaderDependencies {
  readonly mock: ServiceResourceReader;
  readonly pm2: ServiceResourceReader;
  readonly docker: ServiceResourceReader;
  readonly "docker-compose": ServiceResourceReader;
}

export class DispatchingServiceResourceReaderError extends Error {
  public override readonly name = "DispatchingServiceResourceReaderError";

  public constructor() {
    super("Service resource reader unavailable");
  }
}

export class DispatchingServiceResourceReader implements ServiceResourceReader {
  private readonly mockReader: ServiceResourceReader;
  private readonly pm2Reader: ServiceResourceReader;
  private readonly dockerReader: ServiceResourceReader;
  private readonly composeReader: ServiceResourceReader;
  private readonly clock: Clock;

  public constructor(
    dependencies: DispatchingServiceResourceReaderDependencies,
    clock: Clock,
  ) {
    if (
      !isServiceResourceReader(dependencies?.mock) ||
      !isServiceResourceReader(dependencies?.pm2) ||
      !isServiceResourceReader(dependencies?.docker) ||
      !isServiceResourceReader(dependencies?.["docker-compose"])
    ) {
      throw new DispatchingServiceResourceReaderError();
    }

    this.mockReader = dependencies.mock;
    this.pm2Reader = dependencies.pm2;
    this.dockerReader = dependencies.docker;
    this.composeReader = dependencies["docker-compose"];
    this.clock = clock;
    Object.freeze(this);
  }

  public read(service: RegisteredService): Promise<ServiceResourceObservation> {
    switch (service.managementAdapter) {
      case "mock":
        return this.mockReader.read(service);
      case "pm2":
        return this.pm2Reader.read(service);
      case "docker":
        return this.dockerReader.read(service);
      case "docker-compose":
        return this.composeReader.read(service);
      default:
        return Promise.resolve(
          createUnavailableServiceResourceObservation(
            this.clock.now().toISOString(),
            "unsupported",
          ),
        );
    }
  }
}

function isServiceResourceReader(
  value: unknown,
): value is ServiceResourceReader {
  return (
    typeof value === "object" &&
    value !== null &&
    "read" in value &&
    typeof value.read === "function"
  );
}
