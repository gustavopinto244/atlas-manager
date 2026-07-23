import type { RegisteredService } from "../../domain/registered-service.js";
import type { ServiceRuntimeState } from "../../domain/registered-service-status.js";

export interface ServiceStatusReader {
  read(service: RegisteredService): Promise<ServiceRuntimeState>;
}
