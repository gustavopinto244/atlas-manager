import {
  createAdministrativeEventInput,
  type AdministrativeEvent,
  type AdministrativeEventDetails,
  type AdministrativeEventOperation,
  type AdministrativeEventSource,
  type AdministrativeEventStatus,
  type AdministrativeEventTarget,
} from "../domain/administrative-event.js";
import type { AdministrativeEventAttemptIdGenerator } from "./ports/administrative-event-attempt-id-generator.js";
import type { AdministrativeEventRecorder } from "./ports/administrative-event-recorder.js";

export interface AdministrativeAuditAttemptInput {
  readonly occurredAt: string;
  readonly source: AdministrativeEventSource;
  readonly target: AdministrativeEventTarget;
  readonly operation: AdministrativeEventOperation;
  readonly details?: AdministrativeEventDetails;
}

export interface AdministrativeAuditAttempt {
  readonly attemptId: string;
  readonly started: AdministrativeEvent;
  readonly operation: AdministrativeEventOperation;
  readonly occurredAt: string;
  readonly source: AdministrativeEventSource;
  readonly target: AdministrativeEventTarget;
}

export type AdministrativeAuditTrailErrorCode = "administrative_audit_failed";

export class AdministrativeAuditTrailError extends Error {
  public override readonly name = "AdministrativeAuditTrailError";
  public constructor(public readonly code: AdministrativeAuditTrailErrorCode) {
    super(`Administrative audit recording failed: ${code}`);
    Object.freeze(this);
  }
}

export class AdministrativeAuditPartialEffectError extends Error {
  public override readonly name = "AdministrativeAuditPartialEffectError";
  public constructor(
    public readonly code:
      | "audit_failed_after_wake_alarm_mutation"
      | "audit_failed_after_shutdown_request"
      | "audit_failed_after_shutdown_execution"
      | "audit_failed_after_shutdown_preparation"
      | "audit_failed_after_scheduler_tick",
    public readonly result?: unknown,
  ) {
    super(`Administrative audit failed after an effect: ${code}`);
    Object.freeze(this);
  }
}

export class AdministrativeAuditTrail {
  readonly #recorder: AdministrativeEventRecorder;
  readonly #ids: AdministrativeEventAttemptIdGenerator;

  public constructor(
    recorder: AdministrativeEventRecorder,
    ids: AdministrativeEventAttemptIdGenerator,
  ) {
    this.#recorder = recorder;
    this.#ids = ids;
    Object.freeze(this);
  }

  public async begin(
    input: AdministrativeAuditAttemptInput,
  ): Promise<AdministrativeAuditAttempt> {
    const attemptId = this.#ids.generate();
    const startedInput = createAdministrativeEventInput({
      attemptId,
      occurredAt: input.occurredAt,
      source: input.source,
      target: input.target,
      operation: input.operation,
      status: "started",
      ...(input.details ? { details: input.details } : {}),
    });
    let started: AdministrativeEvent;
    try {
      started = await this.#recorder.record(startedInput);
    } catch {
      throw new AdministrativeAuditTrailError("administrative_audit_failed");
    }
    return Object.freeze({
      attemptId,
      started,
      operation: input.operation,
      occurredAt: input.occurredAt,
      source: input.source,
      target: input.target,
    });
  }

  public async complete(
    attempt: AdministrativeAuditAttempt,
    status: Exclude<AdministrativeEventStatus, "started">,
    details?: AdministrativeEventDetails,
  ): Promise<AdministrativeEvent> {
    const eventInput = createAdministrativeEventInput({
      attemptId: attempt.attemptId,
      occurredAt: attempt.occurredAt,
      source: attempt.source,
      target: attempt.target,
      operation: attempt.operation,
      status,
      ...(details ? { details } : {}),
    });
    try {
      return await this.#recorder.record(eventInput);
    } catch {
      throw new AdministrativeAuditTrailError("administrative_audit_failed");
    }
  }
}
