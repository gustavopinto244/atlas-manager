import type { RegisteredService } from "../../domain/registered-service.js";
import type { ServiceControlOperation } from "../../domain/registered-service-control-result.js";

export interface ServiceController {
  execute(
    service: RegisteredService,
    operation: ServiceControlOperation,
  ): Promise<void>;
}
