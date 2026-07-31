import type { MachineShutdownServicePreparationController } from "../application/ports/machine-shutdown-preparation-controllers.js";
import type { MachineShutdownOccurrence } from "../domain/machine-shutdown-occurrence.js";
import { createMachineShutdownServicePreparationResult } from "../domain/machine-shutdown-service-preparation-result.js";
import type { OrchestrateRegisteredServicesStopPort } from "../../service-management/application/orchestrate-registered-services-stop.js";
export class ServiceManagementMachineShutdownPreparationController implements MachineShutdownServicePreparationController {
  public constructor(
    private readonly services: OrchestrateRegisteredServicesStopPort,
  ) {
    Object.freeze(this);
  }
  public async prepare(input: {
    readonly occurrence: MachineShutdownOccurrence;
    readonly requestedAt: string;
    readonly serviceIds: readonly string[];
  }) {
    try {
      const result = await this.services.execute(
        { serviceIds: input.serviceIds, authority: "machine_shutdown" },
        input.requestedAt,
      );
      return createMachineShutdownServicePreparationResult({
        requestedAt: result.requestedAt,
        steps: result.steps,
        successful: result.successful,
      });
    } catch {
      throw new MachineShutdownServicePreparationError();
    }
  }
}

export class MachineShutdownServicePreparationError extends Error {
  public override readonly name = "MachineShutdownServicePreparationError";
  public readonly code = "service_preparation_failed" as const;
  public constructor() {
    super("Machine shutdown service preparation failed");
    Object.freeze(this);
  }
}
