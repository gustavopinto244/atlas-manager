import {
  assertWakeAlarmScheduleIsFuture,
  createWakeAlarmSchedule,
} from "../domain/wake-alarm-schedule.js";
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
import type { AdministrativeEventSource } from "../../event-history/domain/administrative-event.js";

export class ScheduleWakeAlarm {
  public constructor(
    private readonly clock: PowerManagementClock,
    private readonly controller: WakeAlarmController,
    private readonly audit?: AdministrativeAuditTrail,
  ) {
    Object.freeze(this);
  }

  public async execute(input: unknown): Promise<WakeAlarmMutationResult> {
    const schedule = createWakeAlarmSchedule(input);
    const requestedAt = this.clock.now().toISOString();
    assertWakeAlarmScheduleIsFuture(requestedAt, schedule.scheduledFor);
    return this.executeAsAuthorized(
      input,
      requestedAt,
      DIRECT_POWER_AUDIT_SOURCE,
    );
  }

  public async executeAsAuthorized(
    input: unknown,
    requestedAt: string,
    source: AdministrativeEventSource,
  ): Promise<WakeAlarmMutationResult> {
    const schedule = createWakeAlarmSchedule(input);
    assertWakeAlarmScheduleIsFuture(requestedAt, schedule.scheduledFor);
    if (!this.audit)
      return this.controller.schedule(requestedAt, schedule.scheduledFor);
    const attempt = await this.audit.begin({
      occurredAt: requestedAt,
      source,
      target: MACHINE_AUDIT_TARGET,
      operation: "schedule_wake_alarm",
      details: { scheduledFor: schedule.scheduledFor },
    });
    let result: WakeAlarmMutationResult;
    try {
      result = await this.controller.schedule(
        requestedAt,
        schedule.scheduledFor,
      );
    } catch (error) {
      await recordFailure(this.audit, attempt, "helper_operation_failed");
      throw error;
    }
    try {
      await this.audit.complete(attempt, "succeeded", {
        scheduledFor: schedule.scheduledFor,
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

async function recordFailure(
  audit: AdministrativeAuditTrail,
  attempt: Parameters<AdministrativeAuditTrail["complete"]>[0],
  failureCode: "helper_operation_failed",
): Promise<void> {
  try {
    await audit.complete(attempt, "failed", { failureCode });
  } catch {
    // The primary controller failure remains authoritative.
  }
}

function isAuditError(error: unknown): error is AdministrativeAuditTrailError {
  return (
    error instanceof Error && error.name === "AdministrativeAuditTrailError"
  );
}
