import type { RegisteredServiceCatalog } from "./ports/registered-service-catalog.js";
import type { ServiceResourceReader } from "./ports/service-resource-reader.js";
import type { ServiceResourceObservation } from "../domain/service-resource-observation.js";
import { createUnavailableServiceResourceObservation } from "../domain/service-resource-observation.js";
import type { Clock } from "./ports/clock.js";
import { RegisteredServiceNotFoundError } from "./registered-service-not-found-error.js";

export class GetRegisteredServiceResources {
  public constructor(
    private readonly catalog: RegisteredServiceCatalog,
    private readonly resourceReader: ServiceResourceReader,
    private readonly clock: Clock,
  ) {
    Object.freeze(this);
  }

  public async execute(serviceId: string): Promise<ServiceResourceObservation> {
    const service = await this.catalog.findById(serviceId);
    if (!service) throw new RegisteredServiceNotFoundError();

    try {
      // Readers are expected to translate every adapter condition (timeout,
      // unsupported adapter, malformed output) into an "unavailable"
      // observation with a stable reason rather than throwing; this catch is
      // a defensive fallback for an unexpected reader bug, so a resource
      // read failure never propagates and hides the service's basic status
      // or controls.
      return await this.resourceReader.read(service);
    } catch {
      return createUnavailableServiceResourceObservation(
        this.clock.now().toISOString(),
        "unavailable",
      );
    }
  }
}
