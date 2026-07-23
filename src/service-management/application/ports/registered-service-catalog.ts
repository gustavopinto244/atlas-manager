import type { RegisteredService } from "../../domain/registered-service.js";

export interface RegisteredServiceCatalog {
  list(): Promise<readonly RegisteredService[]>;
}
