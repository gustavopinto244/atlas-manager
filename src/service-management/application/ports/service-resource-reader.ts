import type { RegisteredService } from "../../domain/registered-service.js";
import type { ServiceResourceObservation } from "../../domain/service-resource-observation.js";

export interface ServiceResourceReader {
  read(service: RegisteredService): Promise<ServiceResourceObservation>;
}
