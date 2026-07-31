/* eslint-disable @typescript-eslint/require-await */
import type { MachineShutdownPreparationEvent } from "../domain/machine-shutdown-preparation-event.js";
import { createMachineShutdownPreparationEvent } from "../domain/machine-shutdown-preparation-event.js";
import type { MachineShutdownPreparationEventRecorder } from "../application/ports/machine-shutdown-preparation-controllers.js";
export class InMemoryMachineShutdownPreparationEventRecorder implements MachineShutdownPreparationEventRecorder {
  readonly #events: MachineShutdownPreparationEvent[] = [];
  readonly #nextSequence = new Map<string, number>();
  readonly #rejectedSequences = new Set<string>();
  readonly #terminalAttempts = new Set<string>();
  public constructor(private readonly rejectAt?: number) {}
  public async record(input: MachineShutdownPreparationEvent): Promise<void> {
    const event = createMachineShutdownPreparationEvent(input);
    const key = attemptKey(event);
    if (event.sequence === 1 && this.#terminalAttempts.has(key)) {
      this.#nextSequence.set(key, 1);
      this.#terminalAttempts.delete(key);
    }
    const rejectionKey = `${key}:${event.sequence}`;
    if (
      this.rejectAt === event.sequence &&
      !this.#rejectedSequences.has(rejectionKey)
    ) {
      this.#rejectedSequences.add(rejectionKey);
      throw new Error("event_recording_failed");
    }
    const expected = this.#nextSequence.get(key) ?? 1;
    if (event.sequence !== expected) throw new Error("event_sequence_invalid");
    this.#events.push(event);
    this.#nextSequence.set(key, expected + 1);
    if (
      event.kind === "preparation_failed" ||
      event.kind === "final_readiness_approved" ||
      event.kind === "final_readiness_rejected"
    )
      this.#terminalAttempts.add(key);
  }
  public get events(): readonly MachineShutdownPreparationEvent[] {
    return Object.freeze([...this.#events]);
  }
}

function attemptKey(event: MachineShutdownPreparationEvent): string {
  return [
    event.occurrence.operation,
    event.occurrence.scheduledFor,
    event.occurrence.wakeScheduledFor,
    event.occurredAt,
  ].join("|");
}
