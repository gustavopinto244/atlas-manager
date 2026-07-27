import type { RegisteredService } from "../../domain/registered-service.js";
import type { ServiceLogBatch } from "../../domain/service-log-batch.js";

export interface ServiceLogReader {
  readLogs(
    service: RegisteredService,
    tailLines: number,
    collectedAt: Date,
  ): Promise<ServiceLogBatch>;
}
