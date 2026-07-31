import {
  createMachinePowerSchedulerCursor,
  isSameMachinePowerSchedulerCursor,
  type MachinePowerSchedulerCursor,
} from "../domain/machine-power-scheduler-cursor.js";
import {
  createMachinePowerSchedulerCursorAdvanceResult,
  type MachinePowerSchedulerCursorAdvanceResult,
} from "../domain/machine-power-scheduler-cursor-result.js";
import type { MachinePowerSchedulerCursorStore } from "../application/ports/machine-power-scheduler-cursor-store.js";

export interface InMemoryMachinePowerSchedulerCursorStoreConfiguration {
  readonly failure?: Error;
}
export class InMemoryMachinePowerSchedulerCursorStore implements MachinePowerSchedulerCursorStore {
  #cursor: MachinePowerSchedulerCursor | null = null;
  readonly #failure?: Error;
  public constructor(
    configuration: InMemoryMachinePowerSchedulerCursorStoreConfiguration = {},
  ) {
    if (configuration.failure) this.#failure = configuration.failure;
    Object.freeze(this);
  }
  public read(): Promise<MachinePowerSchedulerCursor | null> {
    if (this.#failure) return Promise.reject(this.#failure);
    return Promise.resolve(this.#cursor);
  }
  public advance(
    expected: MachinePowerSchedulerCursor | null,
    nextInput: MachinePowerSchedulerCursor,
  ): Promise<MachinePowerSchedulerCursorAdvanceResult> {
    if (this.#failure) return Promise.reject(this.#failure);
    const next = createMachinePowerSchedulerCursor(nextInput);
    if (!isSameMachinePowerSchedulerCursor(expected, this.#cursor))
      return Promise.resolve(
        createMachinePowerSchedulerCursorAdvanceResult({
          kind: "conflict",
          cursor: this.#cursor,
        }),
      );
    if (this.#cursor && next.completedThrough <= this.#cursor.completedThrough)
      return Promise.reject(
        new InMemoryMachinePowerSchedulerCursorStoreError("non_forward_cursor"),
      );
    this.#cursor = next;
    return Promise.resolve(
      createMachinePowerSchedulerCursorAdvanceResult({
        kind: "advanced",
        cursor: next,
      }),
    );
  }
}
export class InMemoryMachinePowerSchedulerCursorStoreError extends Error {
  public override readonly name =
    "InMemoryMachinePowerSchedulerCursorStoreError";
  public constructor(public readonly code: "non_forward_cursor") {
    super(`In-memory machine power scheduler cursor store failed: ${code}`);
    Object.freeze(this);
  }
}
