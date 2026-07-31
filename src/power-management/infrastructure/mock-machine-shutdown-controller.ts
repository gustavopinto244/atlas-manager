import type { MachineShutdownController } from "../application/ports/machine-shutdown-controller.js";
import {
  createMachineShutdownResult,
  type MachineShutdownResult,
} from "../domain/machine-shutdown-result.js";

export interface MockMachineShutdownControllerConfiguration {
  readonly failure?: Error;
}

export class MockMachineShutdownController implements MachineShutdownController {
  readonly #failure: Error | undefined;

  public constructor(
    configuration: MockMachineShutdownControllerConfiguration = {},
  ) {
    this.#failure = configuration.failure;
    Object.freeze(this);
  }

  public requestShutdown(requestedAt: string): Promise<MachineShutdownResult> {
    if (this.#failure) {
      return Promise.reject(this.#failure);
    }

    return Promise.resolve(
      createMachineShutdownResult({
        operation: "shutdown",
        requestedAt,
        outcome: "simulated",
      }),
    );
  }
}
