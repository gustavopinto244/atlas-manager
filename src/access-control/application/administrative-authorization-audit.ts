import {
  createAdministrativeEventInput,
  type AdministrativeEventSource,
  type AdministrativeEventTarget,
} from "../../event-history/domain/administrative-event.js";
import type { AdministrativeEventAttemptIdGenerator } from "../../event-history/application/ports/administrative-event-attempt-id-generator.js";
import type { AdministrativeEventRecorder } from "../../event-history/application/ports/administrative-event-recorder.js";
import {
  permissionForAdministrativeOperation,
  type AdministrativeOperation,
} from "../domain/administrative-operation.js";
import type { AdministrativeAuthorizationDecision } from "../domain/administrative-authorization-decision.js";
import { AdministrativeAccessControlError } from "./errors.js";

export class AdministrativeAuthorizationAudit {
  readonly #recorder: AdministrativeEventRecorder;
  readonly #ids: AdministrativeEventAttemptIdGenerator;
  readonly #target: AdministrativeEventTarget;

  public constructor(
    recorder: AdministrativeEventRecorder,
    ids: AdministrativeEventAttemptIdGenerator,
    target: AdministrativeEventTarget,
  ) {
    this.#recorder = recorder;
    this.#ids = ids;
    this.#target = target;
    Object.freeze(this);
  }

  public async recordDecision(
    decision: AdministrativeAuthorizationDecision,
    source: AdministrativeEventSource,
  ): Promise<void> {
    await this.record({
      operation: decision.operation,
      permission: decision.permission,
      decision: decision.outcome,
      ...(decision.reason ? { reasonCode: decision.reason } : {}),
      occurredAt: decision.evaluatedAt,
      source,
    });
  }

  public async recordRejection(input: {
    readonly operation: AdministrativeOperation;
    readonly occurredAt: string;
    readonly source: AdministrativeEventSource;
    readonly reasonCode:
      | "credentials_absent"
      | "credentials_invalid"
      | "signature_invalid"
      | "issuer_mismatch"
      | "audience_mismatch"
      | "claims_invalid"
      | "key_unavailable"
      | "identity_provider_unavailable";
  }): Promise<void> {
    await this.record({
      operation: input.operation,
      permission: permissionForAdministrativeOperation(input.operation),
      decision: "denied",
      reasonCode: input.reasonCode,
      occurredAt: input.occurredAt,
      source: input.source,
    });
  }

  private async record(input: {
    readonly operation: AdministrativeOperation;
    readonly permission: string;
    readonly decision: "allowed" | "denied";
    readonly reasonCode?: string;
    readonly occurredAt: string;
    readonly source: AdministrativeEventSource;
  }): Promise<void> {
    const attemptId = this.#ids.generate();
    try {
      await this.#recorder.record(
        createAdministrativeEventInput({
          attemptId,
          occurredAt: input.occurredAt,
          source: input.source,
          target: this.#target,
          operation: "authorize_administrative_operation",
          status: input.decision === "allowed" ? "succeeded" : "rejected",
          details: {
            requestedOperation: input.operation,
            permission: input.permission,
            decision: input.decision,
            ...(input.reasonCode ? { reasonCode: input.reasonCode } : {}),
          },
        }),
      );
    } catch {
      throw new AdministrativeAccessControlError(
        "authorization_audit_unavailable",
      );
    }
  }
}
