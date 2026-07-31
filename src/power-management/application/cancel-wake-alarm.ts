import type { WakeAlarmMutationResult } from "../domain/wake-alarm-mutation-result.js";
import type { WakeAlarmController } from "./ports/wake-alarm-controller.js";
import type { PowerManagementClock } from "./ports/power-management-clock.js";
import type { AdministrativeAuditTrail } from "../../event-history/application/administrative-audit-trail.js";
import {
  AdministrativeAuditPartialEffectError,
  type AdministrativeAuditTrailError,
} from "../../event-history/application/administrative-audit-trail.js";
import {
  DIRECT_POWER_AUDIT_SOURCE,
  MACHINE_AUDIT_TARGET,
} from "./administrative-audit-context.js";

export class CancelWakeAlarm {
  public constructor(
    private readonly clock: PowerManagementClock,
    private readonly controller: WakeAlarmController,
    private readonly audit?: AdministrativeAuditTrail,
  ) {
    Object.freeze(this);
  }

  public async execute(): Promise<WakeAlarmMutationResult> {
    const requestedAt = this.clock.now().toISOString();
    if (!this.audit) return this.controller.cancel(requestedAt);
    const attempt = await this.audit.begin({
      occurredAt: requestedAt,
      source: DIRECT_POWER_AUDIT_SOURCE,
      target: MACHINE_AUDIT_TARGET,
      operation: "cancel_wake_alarm",
    });
    let result: WakeAlarmMutationResult;
    try {
      result = await this.controller.cancel(requestedAt);
    } catch (error) {
      try {
        await this.audit.complete(attempt, "failed", {
          failureCode: "helper_operation_failed",
        });
      } catch {
        // The primary controller failure remains authoritative.
      }
      throw error;
    }
    try {
      await this.audit.complete(attempt, "succeeded", {
        mutationOutcome: result.outcome,
      });
    } catch (error) {
      if (isAuditError(error))
        throw new AdministrativeAuditPartialEffectError(
          "audit_failed_after_wake_alarm_mutation",
          result,
        );
      throw error;
    }
    return result;
  }
}

function isAuditError(error: unknown): error is AdministrativeAuditTrailError {
  return (
    error instanceof Error && error.name === "AdministrativeAuditTrailError"
  );
}
