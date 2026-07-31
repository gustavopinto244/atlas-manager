import {
  createMachineShutdownOccurrence,
  type MachineShutdownOccurrence,
} from "../domain/machine-shutdown-occurrence.js";
import {
  createMachineShutdownOccurrenceClaimResult,
  type MachineShutdownOccurrenceClaimResult,
} from "../domain/machine-shutdown-occurrence-claim-result.js";
import type { MachineShutdownOccurrenceClaimStore } from "../application/ports/machine-shutdown-occurrence-claim-store.js";
import type { MachinePowerSchedulerCursor } from "../domain/machine-power-scheduler-cursor.js";
import {
  createMachineShutdownOccurrenceClaimPruningResult,
  type MachineShutdownOccurrenceClaimPruningResult,
} from "../domain/machine-shutdown-occurrence-claim-pruning-result.js";

export interface InMemoryMachineShutdownOccurrenceClaimStoreConfiguration {
  readonly failure?: Error;
}

export class InMemoryMachineShutdownOccurrenceClaimStore implements MachineShutdownOccurrenceClaimStore {
  readonly #claims = new Map<string, Set<string>>();
  readonly #failure?: Error;
  #operationQueue: Promise<void> = Promise.resolve();
  public constructor(
    configuration: InMemoryMachineShutdownOccurrenceClaimStoreConfiguration = {},
  ) {
    if (configuration.failure) this.#failure = configuration.failure;
    Object.freeze(this);
  }
  public claim(
    input: MachineShutdownOccurrence,
  ): Promise<MachineShutdownOccurrenceClaimResult> {
    return this.#enqueue(() => {
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
    });
  }
  public pruneCompletedThrough(
    cursor: MachinePowerSchedulerCursor,
  ): Promise<MachineShutdownOccurrenceClaimPruningResult> {
    return this.#enqueue(() => {
      if (this.#failure) return Promise.reject(this.#failure);
      let removed = false;
      for (const [scheduledFor, wakes] of this.#claims) {
        if (scheduledFor <= cursor.completedThrough) {
          this.#claims.delete(scheduledFor);
          removed = true;
        } else if (wakes.size === 0) this.#claims.delete(scheduledFor);
      }
      return Promise.resolve(
        createMachineShutdownOccurrenceClaimPruningResult({
          outcome: removed ? "pruned" : "unchanged",
        }),
      );
    });
  }
  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#operationQueue.then(operation);
    this.#operationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
