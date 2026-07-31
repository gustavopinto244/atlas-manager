import type { PowerManagementClock } from "./ports/power-management-clock.js";
import type { MachineShutdownOccurrenceClaimStore } from "./ports/machine-shutdown-occurrence-claim-store.js";
import type { WakeAlarmController } from "./ports/wake-alarm-controller.js";
import type { MachineShutdownController } from "./ports/machine-shutdown-controller.js";
import { createMachineShutdownOccurrence } from "../domain/machine-shutdown-occurrence.js";
import { createMachineShutdownOccurrenceClaimResult } from "../domain/machine-shutdown-occurrence-claim-result.js";
import { createMachineShutdownOccurrenceExecutionResult } from "../domain/machine-shutdown-occurrence-execution-result.js";
import { createWakeAlarmMutationResult } from "../domain/wake-alarm-mutation-result.js";
import { createMachineShutdownResult } from "../domain/machine-shutdown-result.js";
import type { EvaluateMachineShutdownReadiness } from "./evaluate-machine-shutdown-readiness.js";
import type { PrepareMachineShutdownOccurrence } from "./prepare-machine-shutdown-occurrence.js";

export type MachineShutdownOccurrenceExecutionErrorCode =
  | "claim_failed"
  | "wake_alarm_preparation_failed"
  | "shutdown_failed_after_wake_scheduled";
export class MachineShutdownOccurrenceExecutionError extends Error {
  public override readonly name = "MachineShutdownOccurrenceExecutionError";
  public constructor(
    public readonly code: MachineShutdownOccurrenceExecutionErrorCode,
  ) {
    super(`Machine shutdown occurrence execution failed: ${code}`);
    Object.freeze(this);
  }
}

export class ExecuteMachineShutdownOccurrence {
  readonly #clock: PowerManagementClock;
  readonly #claims: MachineShutdownOccurrenceClaimStore;
  readonly #wake: WakeAlarmController;
  readonly #shutdown: MachineShutdownController;
  readonly #readiness: EvaluateMachineShutdownReadiness | undefined;
  readonly #preparation: PrepareMachineShutdownOccurrence | undefined;
  public constructor(
    clock: PowerManagementClock,
    claims: MachineShutdownOccurrenceClaimStore,
    wake: WakeAlarmController,
    shutdown: MachineShutdownController,
    readiness?: EvaluateMachineShutdownReadiness,
    preparation?: PrepareMachineShutdownOccurrence,
  ) {
    this.#clock = clock;
    this.#claims = claims;
    this.#wake = wake;
    this.#shutdown = shutdown;
    this.#readiness = readiness;
    this.#preparation = preparation;
    Object.freeze(this);
  }
  public async execute(
    input: unknown,
  ): Promise<
    ReturnType<typeof createMachineShutdownOccurrenceExecutionResult>
  > {
    const occurrence = createMachineShutdownOccurrence(input);
    const processedAt = this.#clock.now().toISOString();
    const processed = Date.parse(processedAt);
    const scheduled = Date.parse(occurrence.scheduledFor);
    const wakeAt = Date.parse(occurrence.wakeScheduledFor);
    if (processed < scheduled)
      return createMachineShutdownOccurrenceExecutionResult({
        occurrence,
        processedAt,
        outcome: "not_due",
      });
    if (processed >= wakeAt)
      return createMachineShutdownOccurrenceExecutionResult({
        occurrence,
        processedAt,
        outcome: "stale",
      });
    let decision;
    if (this.#readiness) {
      decision = await this.#readiness.evaluateAt(occurrence, processedAt);
      if (!this.#preparation && decision.outcome === "rejected")
        return createMachineShutdownOccurrenceExecutionResult({
          occurrence,
          processedAt,
          outcome: "rejected",
          decision,
        });
    }
    let preparationReport;
    if (this.#preparation && decision) {
      preparationReport = await this.#preparation.prepareAt(
        occurrence,
        processedAt,
        decision,
      );
      if (preparationReport.outcome === "blocked")
        return createMachineShutdownOccurrenceExecutionResult({
          occurrence,
          processedAt,
          outcome: "rejected",
          decision,
          preparationReport,
        });
      if (preparationReport.outcome === "incomplete")
        return createMachineShutdownOccurrenceExecutionResult({
          occurrence,
          processedAt,
          outcome: "preparation_incomplete",
          preparationReport,
        });
    }
    let claim;
    try {
      claim = createMachineShutdownOccurrenceClaimResult(
        await this.#claims.claim(occurrence),
      );
    } catch {
      throw new MachineShutdownOccurrenceExecutionError("claim_failed");
    }
    if (claim.outcome === "duplicate")
      return createMachineShutdownOccurrenceExecutionResult({
        occurrence,
        processedAt,
        outcome: "duplicate",
      });
    let wake;
    try {
      wake = createWakeAlarmMutationResult(
        await this.#wake.schedule(processedAt, occurrence.wakeScheduledFor),
      );
    } catch {
      throw new MachineShutdownOccurrenceExecutionError(
        "wake_alarm_preparation_failed",
      );
    }
    let shutdown;
    try {
      shutdown = createMachineShutdownResult(
        await this.#shutdown.requestShutdown(processedAt),
      );
    } catch {
      throw new MachineShutdownOccurrenceExecutionError(
        "shutdown_failed_after_wake_scheduled",
      );
    }
    try {
      return createMachineShutdownOccurrenceExecutionResult({
        occurrence,
        processedAt,
        outcome: "executed",
        ...(preparationReport ? { preparationReport } : {}),
        wakeAlarmMutation: wake,
        shutdownResult: shutdown,
      });
    } catch {
      throw new MachineShutdownOccurrenceExecutionError(
        "shutdown_failed_after_wake_scheduled",
      );
    }
  }
}
