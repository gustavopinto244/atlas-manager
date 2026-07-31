import type { MachineShutdownServiceReadinessReader } from "../application/ports/machine-shutdown-readiness-readers.js";
import type { MachineShutdownOccurrence } from "../domain/machine-shutdown-occurrence.js";
import {
  createMachineShutdownReadinessBlocker,
  type MachineShutdownReadinessBlocker,
} from "../domain/machine-shutdown-readiness-blocker.js";

export interface PublicServiceManagementReadinessCapabilities {
  listRegisteredServices: {
    execute(): Promise<readonly Readonly<{ id: string }>[]>;
  };
  getRegisteredServiceAvailabilityForInterval: {
    execute(input: {
      serviceId: string;
      startsAt: string;
      endsAt: string;
    }): Promise<
      Readonly<{
        outcome: "not_required" | "required";
        firstRequiredAt?: string;
      }>
    >;
  };
  getRegisteredServiceStatus: {
    execute(serviceId: string): Promise<
      Readonly<{
        serviceId: string;
        state: "running" | "stopped" | "failed" | "unknown";
      }>
    >;
  };
}
export class ServiceManagementMachineShutdownReadinessReader implements MachineShutdownServiceReadinessReader {
  readonly #services: PublicServiceManagementReadinessCapabilities;
  public constructor(services: PublicServiceManagementReadinessCapabilities) {
    this.#services = services;
    Object.freeze(this);
  }
  public async read(
    occurrence: MachineShutdownOccurrence,
    _evaluatedAt: string,
  ): Promise<
    | Readonly<{ state: "ready"; blockers: readonly [] }>
    | Readonly<{
        state: "blocked";
        blockers: readonly MachineShutdownReadinessBlocker[];
      }>
  > {
    void _evaluatedAt;
    let registered: readonly Readonly<{ id: string }>[];
    try {
      registered = (await this.#services.listRegisteredServices.execute())
        .slice()
        .sort((left, right) => left.id.localeCompare(right.id));
    } catch {
      return blocked([
        createMachineShutdownReadinessBlocker({
          area: "services",
          code: "service_readiness_unavailable",
        }),
      ]);
    }
    const blockers: MachineShutdownReadinessBlocker[] = [];
    for (const service of registered) {
      try {
        const availability =
          await this.#services.getRegisteredServiceAvailabilityForInterval.execute(
            {
              serviceId: service.id,
              startsAt: occurrence.scheduledFor,
              endsAt: occurrence.wakeScheduledFor,
            },
          );
        if (availability.outcome === "required")
          blockers.push(
            createMachineShutdownReadinessBlocker({
              area: "services",
              code: "service_required_during_offline_interval",
              serviceId: service.id,
              firstRequiredAt: availability.firstRequiredAt,
            }),
          );
      } catch {
        blockers.push(
          createMachineShutdownReadinessBlocker({
            area: "services",
            code: "service_readiness_unavailable",
            serviceId: service.id,
          }),
        );
      }
      try {
        const status = await this.#services.getRegisteredServiceStatus.execute(
          service.id,
        );
        if (status.state !== "stopped")
          blockers.push(
            createMachineShutdownReadinessBlocker({
              area: "services",
              code:
                status.state === "running"
                  ? "service_running"
                  : status.state === "failed"
                    ? "service_failed"
                    : "service_state_unknown",
              serviceId: service.id,
            }),
          );
      } catch {
        blockers.push(
          createMachineShutdownReadinessBlocker({
            area: "services",
            code: "service_readiness_unavailable",
            serviceId: service.id,
          }),
        );
      }
    }
    return blockers.length === 0
      ? { state: "ready", blockers: [] }
      : blocked(blockers);
  }
}
function blocked(
  blockers: readonly MachineShutdownReadinessBlocker[],
): Readonly<{
  state: "blocked";
  blockers: readonly MachineShutdownReadinessBlocker[];
}> {
  return Object.freeze({
    state: "blocked" as const,
    blockers: Object.freeze([...blockers]),
  });
}
