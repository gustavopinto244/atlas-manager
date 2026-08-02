import type { MachineShutdownConfirmationReader } from "../application/ports/machine-shutdown-readiness-readers.js";
import { createMachineShutdownOccurrencesForInterval } from "../domain/machine-shutdown-occurrence-interval.js";
import {
  createMachineShutdownOccurrence,
  isSameMachineShutdownOccurrence,
  type MachineShutdownOccurrence,
} from "../domain/machine-shutdown-occurrence.js";
import type { MachineOperatingPolicy } from "../domain/machine-operating-policy.js";

const MINUTE = 60_000;

export class ScheduledPolicyMachineShutdownConfirmationError extends Error {
  public override readonly name =
    "ScheduledPolicyMachineShutdownConfirmationError";

  public constructor(public readonly code: "policy_evaluation_failed") {
    super(`Scheduled policy confirmation failed: ${code}`);
    Object.freeze(this);
  }
}

export class ScheduledPolicyMachineShutdownConfirmationReader implements MachineShutdownConfirmationReader {
  readonly #policy: MachineOperatingPolicy;

  public constructor(policy: MachineOperatingPolicy) {
    this.#policy = policy;
    Object.freeze(this);
  }

  public read(
    occurrence: MachineShutdownOccurrence,
    evaluatedAt: string,
  ): Promise<"confirmed" | "not_confirmed"> {
    void evaluatedAt;
    if (this.#policy.mode !== "scheduled")
      return Promise.resolve("not_confirmed");

    let canonicalOccurrence: MachineShutdownOccurrence;
    try {
      canonicalOccurrence = createMachineShutdownOccurrence(occurrence);
    } catch {
      return Promise.resolve("not_confirmed");
    }

    const scheduledAt = Date.parse(canonicalOccurrence.scheduledFor);
    const completedThrough = new Date(scheduledAt - MINUTE).toISOString();
    let generated: readonly MachineShutdownOccurrence[];
    try {
      generated = createMachineShutdownOccurrencesForInterval(
        this.#policy,
        completedThrough,
        canonicalOccurrence.scheduledFor,
      );
    } catch {
      return Promise.reject(
        new ScheduledPolicyMachineShutdownConfirmationError(
          "policy_evaluation_failed",
        ),
      );
    }

    return Promise.resolve(
      generated.length === 1 &&
        isSameMachineShutdownOccurrence(generated[0]!, canonicalOccurrence)
        ? "confirmed"
        : "not_confirmed",
    );
  }
}
