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
import type { AdministrativeAuditTrail } from "../../event-history/application/administrative-audit-trail.js";
import {
  AdministrativeAuditPartialEffectError,
  type AdministrativeAuditTrailError,
} from "../../event-history/application/administrative-audit-trail.js";
import type { AdministrativeEventSource } from "../../event-history/domain/administrative-event.js";
import {
  DIRECT_POWER_AUDIT_SOURCE,
  MACHINE_AUDIT_TARGET,
} from "./administrative-audit-context.js";

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
  readonly #audit: AdministrativeAuditTrail | undefined;
  public constructor(
    clock: PowerManagementClock,
    claims: MachineShutdownOccurrenceClaimStore,
    wake: WakeAlarmController,
    shutdown: MachineShutdownController,
    readiness?: EvaluateMachineShutdownReadiness,
    preparation?: PrepareMachineShutdownOccurrence,
    audit?: AdministrativeAuditTrail,
  ) {
    this.#clock = clock;
    this.#claims = claims;
    this.#wake = wake;
    this.#shutdown = shutdown;
    this.#readiness = readiness;
    this.#preparation = preparation;
    this.#audit = audit;
    Object.freeze(this);
  }
  public async execute(
    input: unknown,
  ): Promise<
    ReturnType<typeof createMachineShutdownOccurrenceExecutionResult>
  > {
    const occurrence = createMachineShutdownOccurrence(input);
    const processedAt = this.#clock.now().toISOString();
    return this.executeAt(occurrence, processedAt, DIRECT_POWER_AUDIT_SOURCE);
  }

  public async executeAt(
    input: unknown,
    processedAt: string,
    source: AdministrativeEventSource = DIRECT_POWER_AUDIT_SOURCE,
  ): Promise<
    ReturnType<typeof createMachineShutdownOccurrenceExecutionResult>
  > {
    const occurrence = createMachineShutdownOccurrence(input);
    if (!this.#audit) return this.executeCore(occurrence, processedAt);
    const attempt = await this.#audit.begin({
      occurredAt: processedAt,
      source,
      target: MACHINE_AUDIT_TARGET,
      operation: "execute_machine_shutdown_occurrence",
      details: {
        scheduledFor: occurrence.scheduledFor,
        wakeScheduledFor: occurrence.wakeScheduledFor,
      },
    });
    let result: ReturnType<
      typeof createMachineShutdownOccurrenceExecutionResult
    >;
    try {
      result = await this.executeCore(occurrence, processedAt);
    } catch (error) {
      try {
        await this.#audit.complete(attempt, "failed", {
          failureCode: mapExecutionFailure(error),
        });
      } catch {
        // The primary execution failure remains authoritative.
      }
      throw error;
    }
    const terminal = mapExecutionAudit(result);
    try {
      await this.#audit.complete(attempt, terminal.status, terminal.details);
    } catch (error) {
      if (isAuditError(error)) {
        if (result.outcome === "executed")
          throw new AdministrativeAuditPartialEffectError(
            "audit_failed_after_shutdown_execution",
            result,
          );
        throw error;
      }
      throw error;
    }
    return result;
  }

  private async executeCore(
    occurrence: ReturnType<typeof createMachineShutdownOccurrence>,
    processedAt: string,
  ): Promise<
    ReturnType<typeof createMachineShutdownOccurrenceExecutionResult>
  > {
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

function mapExecutionFailure(
  error: unknown,
):
  | "claim_failed"
  | "wake_alarm_preparation_failed"
  | "shutdown_failed_after_wake_scheduled"
  | "unexpected_execution_failure" {
  if (error instanceof MachineShutdownOccurrenceExecutionError)
    return error.code;
  return "unexpected_execution_failure";
}

function mapExecutionAudit(
  result: ReturnType<typeof createMachineShutdownOccurrenceExecutionResult>,
): {
  readonly status: "succeeded" | "rejected";
  readonly details: Record<string, unknown>;
} {
  if (result.outcome === "executed")
    return {
      status: "succeeded",
      details: {
        executionOutcome: result.outcome,
        ...(result.preparationReport
          ? { preparationOutcome: result.preparationReport.outcome }
          : {}),
        wakeMutationOutcome: result.wakeAlarmMutation.outcome,
        shutdownAccepted: true,
      },
    };
  return {
    status: "rejected",
    details: {
      executionOutcome: result.outcome,
      ...(result.outcome === "preparation_incomplete"
        ? { preparationOutcome: result.preparationReport.outcome }
        : {}),
      ...(result.outcome === "rejected"
        ? {
            blockerCodes: result.decision.blockers.map(
              (blocker) => blocker.code,
            ),
          }
        : {}),
    },
  };
}

function isAuditError(error: unknown): error is AdministrativeAuditTrailError {
  return (
    error instanceof Error && error.name === "AdministrativeAuditTrailError"
  );
}
