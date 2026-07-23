import type { RegisteredServiceCatalog } from "../application/ports/registered-service-catalog.js";
import { RegisteredService } from "../domain/registered-service.js";

export type RegisteredServiceCatalogErrorCode =
  | "invalid_registered_service"
  | "duplicate_service_id"
  | "duplicate_external_resource";

export class RegisteredServiceCatalogError extends Error {
  public override readonly name = "RegisteredServiceCatalogError";

  public constructor(public readonly code: RegisteredServiceCatalogErrorCode) {
    super(`Invalid registered-service catalog: ${code}`);
  }
}

export class InMemoryRegisteredServiceCatalog implements RegisteredServiceCatalog {
  private constructor(private readonly services: readonly RegisteredService[]) {
    Object.freeze(this);
  }

  public static create(
    services: readonly RegisteredService[],
  ): InMemoryRegisteredServiceCatalog {
    validateServices(services);

    return new InMemoryRegisteredServiceCatalog(Object.freeze([...services]));
  }

  public list(): Promise<readonly RegisteredService[]> {
    return Promise.resolve(this.services);
  }

  public findById(serviceId: string): Promise<RegisteredService | null> {
    const service = this.services.find(
      (registeredService) => registeredService.id === serviceId,
    );

    return Promise.resolve(service ?? null);
  }
}

function validateServices(services: readonly RegisteredService[]): void {
  const serviceIds = new Set<string>();
  const externalResourcesByAdapter = new Map<string, Set<string>>();

  for (const service of services) {
    if (!(service instanceof RegisteredService)) {
      throw new RegisteredServiceCatalogError("invalid_registered_service");
    }

    if (serviceIds.has(service.id)) {
      throw new RegisteredServiceCatalogError("duplicate_service_id");
    }

    serviceIds.add(service.id);

    const adapterResources =
      externalResourcesByAdapter.get(service.managementAdapter) ??
      new Set<string>();

    if (adapterResources.has(service.externalResourceId)) {
      throw new RegisteredServiceCatalogError("duplicate_external_resource");
    }

    adapterResources.add(service.externalResourceId);
    externalResourcesByAdapter.set(service.managementAdapter, adapterResources);
  }
}
