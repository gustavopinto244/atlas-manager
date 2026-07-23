import type { RegisteredService } from "../domain/registered-service.js";
import type { RegisteredServiceCatalog } from "./ports/registered-service-catalog.js";

export class ListRegisteredServices {
  public constructor(private readonly catalog: RegisteredServiceCatalog) {}

  public execute(): Promise<readonly RegisteredService[]> {
    return this.catalog.list();
  }
}
