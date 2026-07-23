import type { ServiceStatusReader } from "../application/ports/service-status-reader.js";
import type { RegisteredService } from "../domain/registered-service.js";
import type { ServiceRuntimeState } from "../domain/registered-service-status.js";

export interface DispatchingServiceStatusReaderDependencies {
  readonly mock: ServiceStatusReader;
  readonly pm2: ServiceStatusReader;
}

export class DispatchingServiceStatusReaderError extends Error {
  public override readonly name = "DispatchingServiceStatusReaderError";
  public readonly code = "service_status_reader_unavailable";

  public constructor() {
    super("Service status reader unavailable");
  }
}

export class DispatchingServiceStatusReader implements ServiceStatusReader {
  private readonly mockReader: ServiceStatusReader;
  private readonly pm2Reader: ServiceStatusReader;

  public constructor(dependencies: DispatchingServiceStatusReaderDependencies) {
    if (
      !isServiceStatusReader(dependencies?.mock) ||
      !isServiceStatusReader(dependencies?.pm2)
    ) {
      throw new DispatchingServiceStatusReaderError();
    }

    this.mockReader = dependencies.mock;
    this.pm2Reader = dependencies.pm2;
    Object.freeze(this);
  }

  public read(service: RegisteredService): Promise<ServiceRuntimeState> {
    switch (service.managementAdapter) {
      case "mock":
        return this.mockReader.read(service);
      case "pm2":
        return this.pm2Reader.read(service);
      default:
        return Promise.reject(new DispatchingServiceStatusReaderError());
    }
  }
}

function isServiceStatusReader(value: unknown): value is ServiceStatusReader {
  return (
    typeof value === "object" &&
    value !== null &&
    "read" in value &&
    typeof value.read === "function"
  );
}
