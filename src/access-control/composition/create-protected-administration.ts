import type { EventHistoryCapabilities } from "../../event-history/composition/create-event-history.js";
import type { AdministrativeEventRecorder } from "../../event-history/application/ports/administrative-event-recorder.js";
import type { AdministrativeEventAttemptIdGenerator } from "../../event-history/application/ports/administrative-event-attempt-id-generator.js";
import { NodeAdministrativeEventAttemptIdGenerator } from "../../event-history/infrastructure/node-administrative-event-attempt-id-generator.js";
import type { PowerManagementClock } from "../../power-management/application/ports/power-management-clock.js";
import type { PowerManagementCapabilities } from "../../power-management/composition/create-power-management.js";
import { administrativePrincipalActorId } from "../domain/administrative-principal.js";
import type { AdministrativePrincipal } from "../domain/administrative-principal.js";
import type { AdministrativeOperation } from "../domain/administrative-operation.js";
import type { AuthenticateAdministrativeRequest } from "../application/authenticate-administrative-request.js";
import type { AuthorizeAdministrativeOperation } from "../application/authorize-administrative-operation.js";
import { AdministrativeAuthorizationAudit } from "../application/administrative-authorization-audit.js";
import { AdministrativeAccessControlError } from "../application/errors.js";
import type { AdministrativeAccessControlCapabilities } from "./create-administrative-access-control.js";
import type { AdministrativeEventSource } from "../../event-history/domain/administrative-event.js";
import {
  AdministrativeAuditPartialEffectError,
  AdministrativeAuditTrailError,
} from "../../event-history/application/administrative-audit-trail.js";

export interface ProtectedAdministrationCompositionInput {
  readonly accessControl: AdministrativeAccessControlCapabilities;
  readonly powerManagement: PowerManagementCapabilities;
  readonly eventHistory: EventHistoryCapabilities;
  readonly clock: PowerManagementClock;
  readonly administrativeEventAttemptIdGenerator?: AdministrativeEventAttemptIdGenerator;
}

export interface ProtectedAdministrationCapabilities {
  readonly scheduleWakeAlarm: Readonly<{
    execute(input: unknown): Promise<unknown>;
  }>;
  readonly cancelWakeAlarm: Readonly<{ execute(): Promise<unknown> }>;
  readonly requestMachineShutdown: Readonly<{ execute(): Promise<unknown> }>;
  readonly prepareMachineShutdownOccurrence: Readonly<{
    execute(input: unknown): Promise<unknown>;
  }>;
  readonly executeMachineShutdownOccurrence: Readonly<{
    execute(input: unknown): Promise<unknown>;
  }>;
  readonly runMachinePowerSchedulerTick: Readonly<{
    execute(): Promise<unknown>;
  }>;
  readonly getAdministrativeEventHistory: Readonly<{
    execute(input?: unknown): Promise<unknown>;
  }>;
}

export function createProtectedAdministration(
  input: ProtectedAdministrationCompositionInput,
): ProtectedAdministrationCapabilities {
  const recorder: AdministrativeEventRecorder = {
    record: (event) =>
      input.eventHistory.recordAdministrativeEvent.execute(event),
  };
  const audit = new AdministrativeAuthorizationAudit(
    recorder,
    input.administrativeEventAttemptIdGenerator ??
      new NodeAdministrativeEventAttemptIdGenerator(),
    Object.freeze({ kind: "machine", id: "atlas" }),
  );
  const runner = new ExecuteProtectedAdministrativeOperation(
    input.accessControl.authenticateAdministrativeRequest,
    input.accessControl.authorizeAdministrativeOperation,
    audit,
    input.clock,
  );
  const power = input.powerManagement;
  const scheduleWakeAlarm = Object.freeze({
    execute: (value: unknown) =>
      runner.run("schedule_wake_alarm", (at, source) =>
        power.scheduleWakeAlarm.executeAsAuthorized(value, at, source),
      ),
  });
  const cancelWakeAlarm = Object.freeze({
    execute: () =>
      runner.run("cancel_wake_alarm", (at, source) =>
        power.cancelWakeAlarm.executeAsAuthorized(at, source),
      ),
  });
  const requestMachineShutdown = Object.freeze({
    execute: () =>
      runner.run("request_machine_shutdown", (at, source) =>
        power.requestMachineShutdown.executeAsAuthorized(at, source),
      ),
  });
  const prepareMachineShutdownOccurrence = Object.freeze({
    execute: (value: unknown) =>
      runner.run("prepare_machine_shutdown_occurrence", (at, source) =>
        power.prepareMachineShutdownOccurrence.executeAsAuthorized(
          value,
          at,
          source,
        ),
      ),
  });
  const executeMachineShutdownOccurrence = Object.freeze({
    execute: (value: unknown) =>
      runner.run("execute_machine_shutdown_occurrence", (at, source) =>
        power.executeMachineShutdownOccurrence.executeAt(value, at, source),
      ),
  });
  const runMachinePowerSchedulerTick = Object.freeze({
    execute: () =>
      runner.run("run_machine_power_scheduler_tick", (at, source) =>
        power.runMachinePowerSchedulerTick.executeAsAuthorized(at, source),
      ),
  });
  const getAdministrativeEventHistory = Object.freeze({
    execute: (value?: unknown) =>
      runner.run("read_administrative_event_history", async () =>
        input.eventHistory.getAdministrativeEventHistory.execute(value),
      ),
  });
  return Object.freeze({
    scheduleWakeAlarm,
    cancelWakeAlarm,
    requestMachineShutdown,
    prepareMachineShutdownOccurrence,
    executeMachineShutdownOccurrence,
    runMachinePowerSchedulerTick,
    getAdministrativeEventHistory,
  });
}

// This coordinator is deliberately private to the composition. Public callers
// receive only operation-specific facades, never an arbitrary callback runner.
class ExecuteProtectedAdministrativeOperation {
  readonly #authenticate: AuthenticateAdministrativeRequest;
  readonly #authorize: AuthorizeAdministrativeOperation;
  readonly #audit: AdministrativeAuthorizationAudit;
  readonly #clock: PowerManagementClock;

  public constructor(
    authenticate: AuthenticateAdministrativeRequest,
    authorize: AuthorizeAdministrativeOperation,
    audit: AdministrativeAuthorizationAudit,
    clock: PowerManagementClock,
  ) {
    this.#authenticate = authenticate;
    this.#authorize = authorize;
    this.#audit = audit;
    this.#clock = clock;
    Object.freeze(this);
  }

  public async run<T>(
    operation: AdministrativeOperation,
    invoke: (
      evaluatedAt: string,
      source: AdministrativeEventSource,
    ) => Promise<T>,
  ): Promise<T> {
    const evaluatedAt = this.#clock.now().toISOString();
    const authentication = await this.#authenticate.execute();
    if (authentication.outcome !== "authenticated") {
      const source = Object.freeze({
        kind: "administrative" as const,
        actorId: "unauthenticated" as const,
      });
      try {
        await this.#audit.recordRejection({
          operation,
          occurredAt: evaluatedAt,
          source,
          reasonCode:
            authentication.outcome === "unavailable"
              ? "identity_provider_unavailable"
              : authentication.reason,
        });
      } catch {
        throw new AdministrativeAccessControlError(
          "authorization_audit_unavailable",
        );
      }
      throw new AdministrativeAccessControlError(
        authentication.outcome === "unavailable"
          ? "administrative_identity_unavailable"
          : "administrative_authentication_required",
      );
    }
    const principal = authentication.principal;
    let decision;
    try {
      decision = await this.#authorize.execute({
        principal,
        operation,
        evaluatedAt,
      });
    } catch {
      throw new AdministrativeAccessControlError(
        "administrative_authorization_unavailable",
      );
    }
    const source = sourceForPrincipal(principal);
    try {
      await this.#audit.recordDecision(decision, source);
    } catch {
      throw new AdministrativeAccessControlError(
        "authorization_audit_unavailable",
      );
    }
    if (decision.outcome === "denied")
      throw new AdministrativeAccessControlError(
        "administrative_authorization_denied",
      );
    try {
      return await invoke(evaluatedAt, source);
    } catch (error) {
      if (
        error instanceof AdministrativeAuditPartialEffectError ||
        error instanceof AdministrativeAuditTrailError
      )
        throw error;
      throw new AdministrativeAccessControlError("protected_operation_failed");
    }
  }
}

function sourceForPrincipal(
  principal: AdministrativePrincipal,
): AdministrativeEventSource {
  return Object.freeze({
    kind: "administrative" as const,
    actorId: administrativePrincipalActorId(principal),
  });
}
