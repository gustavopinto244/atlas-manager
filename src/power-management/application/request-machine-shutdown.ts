import type { MachineShutdownResult } from "../domain/machine-shutdown-result.js";
import type { MachineShutdownController } from "./ports/machine-shutdown-controller.js";
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

export class RequestMachineShutdown {
  public constructor(
    private readonly clock: PowerManagementClock,
    private readonly controller: MachineShutdownController,
    private readonly audit?: AdministrativeAuditTrail,
  ) {
    Object.freeze(this);
  }

  public async execute(): Promise<MachineShutdownResult> {
    const requestedAt = this.clock.now().toISOString();
    if (!this.audit) return this.controller.requestShutdown(requestedAt);
    const attempt = await this.audit.begin({
      occurredAt: requestedAt,
      source: DIRECT_POWER_AUDIT_SOURCE,
      target: MACHINE_AUDIT_TARGET,
      operation: "request_machine_shutdown",
    });
    let result: MachineShutdownResult;
    try {
      result = await this.controller.requestShutdown(requestedAt);
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
      await this.audit.complete(attempt, "succeeded", { accepted: true });
    } catch (error) {
      if (isAuditError(error))
        throw new AdministrativeAuditPartialEffectError(
          "audit_failed_after_shutdown_request",
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
