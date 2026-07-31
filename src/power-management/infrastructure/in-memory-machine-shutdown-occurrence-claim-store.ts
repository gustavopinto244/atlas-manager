import {
  createMachineShutdownOccurrence,
  type MachineShutdownOccurrence,
} from "../domain/machine-shutdown-occurrence.js";
import {
  createMachineShutdownOccurrenceClaimResult,
  type MachineShutdownOccurrenceClaimResult,
} from "../domain/machine-shutdown-occurrence-claim-result.js";
import type { MachineShutdownOccurrenceClaimStore } from "../application/ports/machine-shutdown-occurrence-claim-store.js";

export interface InMemoryMachineShutdownOccurrenceClaimStoreConfiguration {
  readonly failure?: Error;
}

export class InMemoryMachineShutdownOccurrenceClaimStore implements MachineShutdownOccurrenceClaimStore {
  readonly #claims = new Map<string, Set<string>>();
  readonly #failure?: Error;
  public constructor(
    configuration: InMemoryMachineShutdownOccurrenceClaimStoreConfiguration = {},
  ) {
    if (configuration.failure) this.#failure = configuration.failure;
    Object.freeze(this);
  }
  public claim(
    input: MachineShutdownOccurrence,
  ): Promise<MachineShutdownOccurrenceClaimResult> {
    const occurrence = createMachineShutdownOccurrence(input);
    if (this.#failure) return Promise.reject(this.#failure);
    let wakes = this.#claims.get(occurrence.scheduledFor);
    if (!wakes) {
      wakes = new Set<string>();
      this.#claims.set(occurrence.scheduledFor, wakes);
    }
    const duplicate = wakes.has(occurrence.wakeScheduledFor);
    if (!duplicate) wakes.add(occurrence.wakeScheduledFor);
    return Promise.resolve(
      createMachineShutdownOccurrenceClaimResult({
        outcome: duplicate ? "duplicate" : "claimed",
      }),
    );
  }
}
