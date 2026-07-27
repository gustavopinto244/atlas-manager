import type { RegisteredServiceCatalog } from "./ports/registered-service-catalog.js";
import type { Clock } from "./ports/clock.js";
import type { ServiceLogReader } from "./ports/service-log-reader.js";
import type { ServiceLogBatch } from "../domain/service-log-batch.js";
import {
  validateTailLines,
  defaultTailLines,
} from "../domain/service-log-tail-lines.js";
import { RegisteredServiceNotFoundError } from "./registered-service-not-found-error.js";

export class ServiceLogOperationNotSupportedError extends Error {
  public constructor() {
    super("Service does not support log retrieval");
    this.name = "ServiceLogOperationNotSupportedError";
    Object.freeze(this);
  }
}

export class GetRegisteredServiceLogs {
  public constructor(
    private readonly catalog: RegisteredServiceCatalog,
    private readonly logReader: ServiceLogReader,
    private readonly clock: Clock,
  ) {
    Object.freeze(this);
  }

  public async execute(
    serviceId: string,
    tailLines: number = defaultTailLines(),
  ): Promise<ServiceLogBatch> {
    validateTailLines(tailLines);

    const service = await this.catalog.findById(serviceId);

    if (!service) {
      throw new RegisteredServiceNotFoundError();
    }

    if (!service.supportedOperations.includes("readLogs")) {
      throw new ServiceLogOperationNotSupportedError();
    }

    const collectedAt = this.clock.now();

    return this.logReader.readLogs(service, tailLines, collectedAt);
  }
}
