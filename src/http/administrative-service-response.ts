import type { RegisteredService } from "../service-management/domain/registered-service.js";
import type { RegisteredServiceStatus } from "../service-management/domain/registered-service-status.js";

export interface AdministrativeServiceResponse {
  readonly id: string;
  readonly displayName: string;
  readonly status: string;
  readonly availability: string;
  readonly supportedOperations: readonly string[];
  readonly managementKind: string;
  readonly dependencies: readonly string[];
}

export function mapAdministrativeService(
  value: Readonly<{
    service: RegisteredService;
    status: RegisteredServiceStatus;
    effectiveAvailability: string;
  }>,
): AdministrativeServiceResponse {
  return Object.freeze({
    id: value.service.id,
    displayName: value.service.displayName,
    status: value.status.state,
    availability: value.effectiveAvailability,
    supportedOperations: Object.freeze([...value.service.supportedOperations]),
    managementKind: value.service.managementAdapter,
    dependencies: Object.freeze([...value.service.dependencies]),
  });
}

export function mapAdministrativeServiceList(
  values: readonly Readonly<{
    service: RegisteredService;
    status: RegisteredServiceStatus;
    effectiveAvailability: string;
  }>[],
): Readonly<{ services: readonly AdministrativeServiceResponse[] }> {
  const services = values
    .map(mapAdministrativeService)
    .sort((left, right) => left.id.localeCompare(right.id));
  return Object.freeze({ services: Object.freeze(services) });
}

export function mapAdministrativeServiceDetail(
  value: Readonly<{
    service: RegisteredService;
    status: RegisteredServiceStatus;
    effectiveAvailability: string;
  }>,
): Readonly<{
  service: AdministrativeServiceResponse;
  dependents: readonly string[];
}> {
  return Object.freeze({
    service: mapAdministrativeService(value),
    dependents: Object.freeze([]),
  });
}

export function mapAdministrativeAvailability(
  value: Readonly<{
    serviceId: string;
    policy: unknown;
    effectiveAvailability: string;
    observedAt: string;
  }>,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    serviceId: value.serviceId,
    policy: mapPolicy(value.policy),
    effectiveAvailability: value.effectiveAvailability,
    observedAt: value.observedAt,
  });
}

function mapPolicy(policy: unknown): unknown {
  if (typeof policy !== "object" || policy === null) return null;
  const value = policy as Record<string, unknown>;
  if (value.mode !== "scheduled") return Object.freeze({ mode: value.mode });
  const schedule = value.schedule;
  const windows: readonly unknown[] =
    typeof schedule === "object" &&
    schedule !== null &&
    Array.isArray((schedule as Record<string, unknown>).windows)
      ? ((schedule as Record<string, unknown>).windows as readonly unknown[])
      : [];
  return Object.freeze({
    mode: "scheduled",
    timezone: value.timezone,
    windows: Object.freeze(
      windows.map((window) => {
        const entry = window as Record<string, unknown>;
        return Object.freeze({
          weekday: entry.weekday,
          start: entry.start,
          end: entry.end,
        });
      }),
    ),
  });
}
