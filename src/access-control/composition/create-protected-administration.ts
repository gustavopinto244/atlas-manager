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
import {
  assertWakeAlarmScheduleIsFuture,
  createWakeAlarmSchedule,
  WakeAlarmScheduleValidationError,
} from "../../power-management/domain/wake-alarm-schedule.js";
import type { MachineShutdownConfirmationReader } from "../../power-management/application/ports/machine-shutdown-readiness-readers.js";
import { MachineShutdownOccurrenceExecutionError } from "../../power-management/application/execute-machine-shutdown-occurrence.js";
import type { ServiceManagementCapabilities } from "../../service-management/composition/create-service-management.js";
import { AdministrativeAuditTrail } from "../../event-history/application/administrative-audit-trail.js";
import { RegisteredServiceNotFoundError } from "../../service-management/application/registered-service-not-found-error.js";
import type { BackupManagementCapabilities } from "../../backup-management/composition/create-backup-management.js";
import type { AdministrativeEventHistoryOperations } from "../../event-history/application/ports/administrative-event-history-operations.js";

export interface ProtectedAdministrationCompositionInput {
  readonly accessControl: AdministrativeAccessControlCapabilities;
  readonly powerManagement?: PowerManagementCapabilities;
  readonly serviceManagement?: ServiceManagementCapabilities;
  readonly backupManagement?: BackupManagementCapabilities;
  readonly eventHistory: EventHistoryCapabilities;
  readonly clock: PowerManagementClock;
  readonly machineShutdownConfirmationReader?: MachineShutdownConfirmationReader;
  readonly administrativeEventAttemptIdGenerator?: AdministrativeEventAttemptIdGenerator;
  readonly eventHistoryOperations?: AdministrativeEventHistoryOperations;
  readonly securityPostureReader?: Readonly<{
    execute(): Promise<unknown>;
  }>;
}

export interface ProtectedAdministrationCapabilities {
  readonly getNextWakeAlarm: Readonly<{ execute(): Promise<unknown> }>;
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
  readonly getRegisteredServices: Readonly<{ execute(): Promise<unknown> }>;
  readonly getRegisteredService: Readonly<{
    execute(serviceId: string): Promise<unknown>;
  }>;
  readonly getRegisteredServiceLogs: Readonly<{
    execute(serviceId: string, tailLines?: number): Promise<unknown>;
  }>;
  readonly startRegisteredService: Readonly<{
    execute(serviceId: string): Promise<unknown>;
  }>;
  readonly stopRegisteredService: Readonly<{
    execute(serviceId: string): Promise<unknown>;
  }>;
  readonly restartRegisteredService: Readonly<{
    execute(serviceId: string): Promise<unknown>;
  }>;
  readonly getRegisteredServiceAvailability: Readonly<{
    execute(serviceId: string): Promise<unknown>;
  }>;
  readonly getRegisteredServiceAvailabilityPreview: Readonly<{
    execute(
      serviceId: string,
      input: { readonly startsAt: string; readonly endsAt: string },
    ): Promise<unknown>;
  }>;
  readonly getRegisteredServiceSchedule: Readonly<{
    execute(serviceId: string): Promise<unknown>;
  }>;
  readonly setRegisteredServiceSchedule: Readonly<{
    execute(serviceId: string, input: unknown): Promise<unknown>;
  }>;
  readonly removeRegisteredServiceSchedule: Readonly<{
    execute(serviceId: string): Promise<unknown>;
  }>;
  readonly setRegisteredServiceAvailability: Readonly<{
    execute(serviceId: string, input: unknown): Promise<unknown>;
  }>;
  readonly removeRegisteredServiceAvailability: Readonly<{
    execute(serviceId: string): Promise<unknown>;
  }>;
  readonly getOperationsOverview: Readonly<{ execute(): Promise<unknown> }>;
  readonly getAdministrativeDashboard: Readonly<{
    execute(): Promise<unknown>;
  }>;
  readonly getAdministrativeSecurityPosture: Readonly<{
    execute(): Promise<unknown>;
  }>;
  readonly getRegisteredBackupTargets: Readonly<{
    execute(): Promise<unknown>;
  }>;
  readonly getRegisteredBackupTarget: Readonly<{
    execute(targetId: string): Promise<unknown>;
  }>;
  readonly getBackupRuns: Readonly<{
    execute(query?: unknown): Promise<unknown>;
  }>;
  readonly getBackupRun: Readonly<{ execute(runId: string): Promise<unknown> }>;
  readonly runRegisteredBackup: Readonly<{
    execute(targetId: string): Promise<unknown>;
  }>;
  readonly getBackupSchedule: Readonly<{
    execute(targetId: string): Promise<unknown>;
  }>;
  readonly setBackupSchedule: Readonly<{
    execute(targetId: string, value: unknown): Promise<unknown>;
  }>;
  readonly removeBackupSchedule: Readonly<{
    execute(targetId: string): Promise<unknown>;
  }>;
  readonly getBackupRetention: Readonly<{
    execute(targetId: string): Promise<unknown>;
  }>;
  readonly setBackupRetention: Readonly<{
    execute(targetId: string, value: unknown): Promise<unknown>;
  }>;
  readonly pruneBackupRetention: Readonly<{
    execute(targetId: string): Promise<unknown>;
  }>;
  readonly runBackupSchedulerTick: Readonly<{ execute(): Promise<unknown> }>;
  readonly verifyEventHistoryIntegrity: Readonly<{
    execute(): Promise<unknown>;
  }>;
  readonly rotateEventHistory: Readonly<{ execute(): Promise<unknown> }>;
  readonly getEventHistoryRetention: Readonly<{ execute(): Promise<unknown> }>;
  readonly setEventHistoryRetention: Readonly<{
    execute(value: unknown): Promise<unknown>;
  }>;
  readonly pruneEventHistory: Readonly<{ execute(): Promise<unknown> }>;
  readonly listEventHistoryExports: Readonly<{ execute(): Promise<unknown> }>;
  readonly getEventHistoryExport: Readonly<{
    execute(exportId: string): Promise<unknown>;
  }>;
  readonly createEventHistoryExport: Readonly<{
    execute(value: unknown): Promise<unknown>;
  }>;
  readonly downloadEventHistoryExport: Readonly<{
    execute(exportId: string): Promise<unknown>;
  }>;
  readonly pruneEventHistoryExports: Readonly<{ execute(): Promise<unknown> }>;
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
  const operationAudit = new AdministrativeAuditTrail(
    recorder,
    input.administrativeEventAttemptIdGenerator ??
      new NodeAdministrativeEventAttemptIdGenerator(),
  );
  const runner = new ExecuteProtectedAdministrativeOperation(
    input.accessControl.authenticateAdministrativeRequest,
    input.accessControl.authorizeAdministrativeOperation,
    audit,
    input.clock,
  );
  const power = input.powerManagement;
  const requirePower = (): PowerManagementCapabilities => {
    if (power === undefined)
      throw new Error("Power-management composition is unavailable");
    return power;
  };
  const confirmationReader = input.machineShutdownConfirmationReader;
  const getNextWakeAlarm = Object.freeze({
    execute: () =>
      runner.run("read_wake_alarm", (at) =>
        requirePower().getNextWakeAlarm.executeAt(at),
      ),
  });
  const scheduleWakeAlarm = Object.freeze({
    execute: (value: unknown) =>
      runner.run(
        "schedule_wake_alarm",
        (at, source) =>
          requirePower().scheduleWakeAlarm.executeAsAuthorized(
            value,
            at,
            source,
          ),
        (at) => {
          const schedule = createWakeAlarmSchedule(value);
          assertWakeAlarmScheduleIsFuture(at, schedule.scheduledFor);
        },
      ),
  });
  const cancelWakeAlarm = Object.freeze({
    execute: () =>
      runner.run("cancel_wake_alarm", (at, source) =>
        requirePower().cancelWakeAlarm.executeAsAuthorized(at, source),
      ),
  });
  const requestMachineShutdown = Object.freeze({
    execute: () =>
      runner.run("request_machine_shutdown", (at, source) =>
        requirePower().requestMachineShutdown.executeAsAuthorized(at, source),
      ),
  });
  const prepareMachineShutdownOccurrence = Object.freeze({
    execute: (value: unknown) =>
      runner.run("prepare_machine_shutdown_occurrence", (at, source) =>
        requirePower().prepareMachineShutdownOccurrence.executeAsAuthorized(
          value,
          at,
          source,
          confirmationReader,
        ),
      ),
  });
  const executeMachineShutdownOccurrence = Object.freeze({
    execute: (value: unknown) =>
      runner.run("execute_machine_shutdown_occurrence", (at, source) =>
        requirePower().executeMachineShutdownOccurrence.executeAt(
          value,
          at,
          source,
          confirmationReader === undefined
            ? {}
            : { confirmationReader, automaticallyPrepare: false },
        ),
      ),
  });
  const runMachinePowerSchedulerTick = Object.freeze({
    execute: () =>
      runner.run("run_machine_power_scheduler_tick", (at, source) =>
        requirePower().runMachinePowerSchedulerTick.executeAsAuthorized(
          at,
          source,
        ),
      ),
  });
  const getAdministrativeEventHistory = Object.freeze({
    execute: (value?: unknown) =>
      runner.run("read_administrative_event_history", async () =>
        input.eventHistory.getAdministrativeEventHistory.execute(value),
      ),
  });
  const getAdministrativeSecurityPosture = Object.freeze({
    execute: () =>
      runner.run("read_administrative_security_posture", () => {
        if (input.securityPostureReader === undefined)
          throw new Error("administrative_security_status_unavailable");
        return input.securityPostureReader.execute();
      }),
  });
  const requireServices = (): ServiceManagementCapabilities => {
    if (input.serviceManagement === undefined)
      throw new Error("Service-management composition is unavailable");
    return input.serviceManagement;
  };
  const requireBackups = (): BackupManagementCapabilities => {
    if (input.backupManagement === undefined)
      throw new Error("Backup-management composition is unavailable");
    return input.backupManagement;
  };
  const requireEventHistoryOperations =
    (): AdministrativeEventHistoryOperations => {
      const operations =
        input.eventHistoryOperations ?? input.eventHistory.operations;
      if (operations === undefined)
        throw new Error("Event-history operational composition is unavailable");
      return operations;
    };
  const readService = async (serviceId: string): Promise<unknown> => {
    const services = requireServices();
    const service = (await services.listRegisteredServices.execute()).find(
      (candidate) => candidate.id === serviceId,
    );
    if (service === undefined) throw new Error("registered_service_not_found");
    const [status, effectiveAvailability] = await Promise.all([
      services.getRegisteredServiceStatus.execute(serviceId),
      services.getRegisteredServiceEffectiveAvailability.execute(serviceId),
    ]);
    return Object.freeze({ service, status, effectiveAvailability });
  };
  const getRegisteredServices = Object.freeze({
    execute: () =>
      runner.run("read_registered_services", async () => {
        const services =
          await requireServices().listRegisteredServices.execute();
        return Promise.all(services.map((service) => readService(service.id)));
      }),
  });
  const getRegisteredService = Object.freeze({
    execute: (serviceId: string) =>
      runner.run("read_registered_service", () => readService(serviceId)),
  });
  const getRegisteredServiceLogs = Object.freeze({
    execute: (serviceId: string, tailLines?: number) =>
      runner.run("read_registered_service_logs", () =>
        requireServices().getRegisteredServiceLogs.execute(
          serviceId,
          tailLines,
        ),
      ),
  });
  const runServiceMutation = (
    operation:
      | "start_registered_service"
      | "stop_registered_service"
      | "restart_registered_service"
      | "update_registered_service_availability"
      | "remove_registered_service_availability"
      | "update_registered_service_schedule"
      | "remove_registered_service_schedule",
    serviceId: string,
    invoke: () => Promise<unknown>,
  ): Promise<unknown> =>
    runner.run(operation, async (occurredAt, source) => {
      const attempt = await operationAudit.begin({
        occurredAt,
        source,
        target: Object.freeze({ kind: "machine", id: "atlas" }),
        operation,
        details: Object.freeze({ serviceId }),
      });
      try {
        const result = await invoke();
        try {
          await operationAudit.complete(
            attempt,
            "succeeded",
            Object.freeze({ serviceId, outcome: "succeeded" }),
          );
        } catch {
          throw new AdministrativeAuditPartialEffectError(
            "audit_failed_after_service_operation",
            result,
          );
        }
        return result;
      } catch (error) {
        if (error instanceof AdministrativeAuditPartialEffectError) throw error;
        try {
          await operationAudit.complete(
            attempt,
            "failed",
            Object.freeze({ serviceId, failureCode: "service_failed" }),
          );
        } catch {
          throw new AdministrativeAuditTrailError(
            "administrative_audit_failed",
          );
        }
        throw error;
      }
    });
  const startRegisteredService = Object.freeze({
    execute: (serviceId: string) =>
      runServiceMutation("start_registered_service", serviceId, () =>
        requireServices().orchestrateRegisteredServiceControl.execute(
          serviceId,
          "start",
        ),
      ),
  });
  const stopRegisteredService = Object.freeze({
    execute: (serviceId: string) =>
      runServiceMutation("stop_registered_service", serviceId, () =>
        requireServices().orchestrateRegisteredServiceControl.execute(
          serviceId,
          "stop",
        ),
      ),
  });
  const restartRegisteredService = Object.freeze({
    execute: (serviceId: string) =>
      runServiceMutation("restart_registered_service", serviceId, () =>
        requireServices().orchestrateRegisteredServiceControl.execute(
          serviceId,
          "restart",
        ),
      ),
  });
  const getRegisteredServiceAvailability = Object.freeze({
    execute: (serviceId: string) =>
      runner.run("read_registered_service_schedule", async (observedAt) => {
        const service = (
          await requireServices().listRegisteredServices.execute()
        ).find((candidate) => candidate.id === serviceId);
        if (service === undefined)
          throw new Error("registered_service_not_found");
        return Object.freeze({
          serviceId,
          policy: service.availabilityPolicy,
          effectiveAvailability:
            await requireServices().getRegisteredServiceEffectiveAvailability.execute(
              serviceId,
            ),
          observedAt,
        });
      }),
  });
  const getRegisteredServiceAvailabilityPreview = Object.freeze({
    execute: (
      serviceId: string,
      input: { readonly startsAt: string; readonly endsAt: string },
    ) =>
      runner.run("read_registered_service_availability_preview", () =>
        requireServices().getRegisteredServiceAvailabilityForInterval.execute({
          serviceId,
          ...input,
        }),
      ),
  });
  const setRegisteredServiceAvailability = Object.freeze({
    execute: (serviceId: string, value: unknown) =>
      runServiceMutation(
        "update_registered_service_availability",
        serviceId,
        () =>
          requireServices().setRegisteredServiceAvailabilityOverride.execute(
            serviceId,
            value,
          ),
      ),
  });
  const getRegisteredServiceSchedule = Object.freeze({
    execute: (serviceId: string) =>
      runner.run("read_registered_service_availability", async (observedAt) => {
        const service = (
          await requireServices().listRegisteredServices.execute()
        ).find((candidate) => candidate.id === serviceId);
        if (service === undefined)
          throw new Error("registered_service_not_found");
        return Object.freeze({
          serviceId,
          policy: service.availabilityPolicy,
          observedAt,
        });
      }),
  });
  const setRegisteredServiceSchedule = Object.freeze({
    execute: (serviceId: string, value: unknown) =>
      runServiceMutation("update_registered_service_schedule", serviceId, () =>
        requireServices().updateRegisteredServiceAvailabilityPolicy.execute(
          serviceId,
          value,
        ),
      ),
  });
  const removeRegisteredServiceSchedule = Object.freeze({
    execute: (serviceId: string) =>
      runServiceMutation(
        "remove_registered_service_schedule",
        serviceId,
        async () => {
          const service = (
            await requireServices().listRegisteredServices.execute()
          ).find((candidate) => candidate.id === serviceId);
          if (service === undefined)
            throw new Error("registered_service_not_found");
          await requireServices().removeRegisteredServiceAvailabilityPolicy.execute(
            serviceId,
          );
          return service.availabilityPolicy;
        },
      ),
  });
  const removeRegisteredServiceAvailability = Object.freeze({
    execute: (serviceId: string) =>
      runServiceMutation(
        "remove_registered_service_availability",
        serviceId,
        () =>
          requireServices().cancelRegisteredServiceAvailabilityOverride.execute(
            serviceId,
          ),
      ),
  });
  const runBackupMutation = (
    operation:
      | "run_registered_backup"
      | "update_backup_schedule"
      | "remove_backup_schedule"
      | "update_backup_retention"
      | "run_backup_retention_prune",
    targetId: string,
    invoke: () => Promise<unknown>,
  ): Promise<unknown> =>
    runner.run(operation, async (occurredAt, source) => {
      const attempt = await operationAudit.begin({
        occurredAt,
        source,
        target: Object.freeze({ kind: "machine", id: "atlas" }),
        operation,
        details: Object.freeze({ targetId }),
      });
      try {
        const result = await invoke();
        try {
          await operationAudit.complete(
            attempt,
            "succeeded",
            Object.freeze({ targetId, outcome: "succeeded" }),
          );
        } catch {
          throw new AdministrativeAuditPartialEffectError(
            "audit_failed_after_backup_operation",
            result,
          );
        }
        return result;
      } catch (error) {
        if (error instanceof AdministrativeAuditPartialEffectError) throw error;
        try {
          await operationAudit.complete(
            attempt,
            "failed",
            Object.freeze({ targetId, failureCode: "backup_operation_failed" }),
          );
        } catch {
          throw new AdministrativeAuditTrailError(
            "administrative_audit_failed",
          );
        }
        throw error;
      }
    });
  const getRegisteredBackupTargets = Object.freeze({
    execute: () =>
      runner.run("read_registered_backup_targets", () =>
        Promise.resolve(requireBackups().listRegisteredBackupTargets()),
      ),
  });
  const getRegisteredBackupTarget = Object.freeze({
    execute: (targetId: string) =>
      runner.run("read_registered_backup_target", () => {
        const target = requireBackups().getRegisteredBackupTarget(targetId);
        if (target === null)
          throw new Error("registered_backup_target_not_found");
        return Promise.resolve(target);
      }),
  });
  const getBackupRuns = Object.freeze({
    execute: (query?: unknown) =>
      runner.run("read_backup_runs", () =>
        requireBackups().getBackupRuns(query as never),
      ),
  });
  const getBackupRun = Object.freeze({
    execute: (runId: string) =>
      runner.run("read_backup_run", async () => {
        const run = await requireBackups().getBackupRun(runId);
        if (run === null) throw new Error("backup_run_not_found");
        return run;
      }),
  });
  const runRegisteredBackup = Object.freeze({
    execute: (targetId: string) =>
      runBackupMutation("run_registered_backup", targetId, () =>
        requireBackups().runRegisteredBackup({ targetId, trigger: "manual" }),
      ),
  });
  const getBackupSchedule = Object.freeze({
    execute: (targetId: string) =>
      runner.run("read_backup_schedule", () =>
        Promise.resolve(requireBackups().getBackupSchedule(targetId)),
      ),
  });
  const setBackupSchedule = Object.freeze({
    execute: (targetId: string, value: unknown) =>
      runBackupMutation("update_backup_schedule", targetId, () =>
        Promise.resolve(requireBackups().setBackupSchedule(targetId, value)),
      ),
  });
  const removeBackupSchedule = Object.freeze({
    execute: (targetId: string) =>
      runBackupMutation("remove_backup_schedule", targetId, () =>
        Promise.resolve(requireBackups().removeBackupSchedule(targetId)),
      ),
  });
  const getBackupRetention = Object.freeze({
    execute: (targetId: string) =>
      runner.run("read_backup_retention", () =>
        Promise.resolve(requireBackups().getBackupRetention(targetId)),
      ),
  });
  const setBackupRetention = Object.freeze({
    execute: (targetId: string, value: unknown) =>
      runBackupMutation("update_backup_retention", targetId, () =>
        Promise.resolve(requireBackups().setBackupRetention(targetId, value)),
      ),
  });
  const pruneBackupRetention = Object.freeze({
    execute: (targetId: string) =>
      runBackupMutation("run_backup_retention_prune", targetId, () =>
        requireBackups().pruneBackupRetention(targetId),
      ),
  });
  const runBackupSchedulerTick = Object.freeze({
    execute: () =>
      runner.run("run_backup_scheduler_tick", async (occurredAt, source) => {
        const attempt = await operationAudit.begin({
          occurredAt,
          source,
          target: Object.freeze({ kind: "machine", id: "atlas" }),
          operation: "run_backup_scheduler_tick",
          details: Object.freeze({}),
        });
        try {
          const result = await requireBackups().runBackupSchedulerTick();
          await operationAudit.complete(
            attempt,
            "succeeded",
            Object.freeze({ outcome: "succeeded" }),
          );
          return result;
        } catch (error) {
          try {
            await operationAudit.complete(
              attempt,
              "failed",
              Object.freeze({ failureCode: "backup_operation_failed" }),
            );
          } catch {
            throw new AdministrativeAuditTrailError(
              "administrative_audit_failed",
            );
          }
          throw error;
        }
      }),
  });
  const runEventHistoryMutation = (
    operation:
      | "rotate_administrative_event_history"
      | "update_administrative_event_history_retention"
      | "prune_administrative_event_history"
      | "create_administrative_event_history_export"
      | "prune_administrative_event_history_exports",
    invoke: () => Promise<unknown>,
    details: Readonly<Record<string, unknown>> = Object.freeze({}),
  ): Promise<unknown> =>
    runner.run(
      operation === "rotate_administrative_event_history"
        ? "rotate_event_history"
        : operation === "update_administrative_event_history_retention"
          ? "update_event_history_retention"
          : operation === "prune_administrative_event_history"
            ? "prune_event_history"
            : operation === "create_administrative_event_history_export"
              ? "create_event_history_export"
              : "prune_event_history_exports",
      async (occurredAt, source) => {
        const attempt = await operationAudit.begin({
          occurredAt,
          source,
          target: Object.freeze({ kind: "machine", id: "atlas" }),
          operation,
          details,
        });
        try {
          const result = await invoke();
          try {
            await operationAudit.complete(
              attempt,
              "succeeded",
              Object.freeze({ outcome: "succeeded" }),
            );
          } catch {
            throw new AdministrativeAuditPartialEffectError(
              "audit_failed_after_event_history_operation",
              result,
            );
          }
          return result;
        } catch (error) {
          if (error instanceof AdministrativeAuditPartialEffectError)
            throw error;
          try {
            await operationAudit.complete(
              attempt,
              "failed",
              Object.freeze({ failureCode: "administrative_audit_failed" }),
            );
          } catch {
            throw new AdministrativeAuditTrailError(
              "administrative_audit_failed",
            );
          }
          throw error;
        }
      },
    );
  const verifyEventHistoryIntegrity = Object.freeze({
    execute: () =>
      runner.run("verify_event_history_integrity", () =>
        requireEventHistoryOperations().verifyIntegrity(),
      ),
  });
  const rotateEventHistory = Object.freeze({
    execute: () =>
      runEventHistoryMutation("rotate_administrative_event_history", () =>
        requireEventHistoryOperations().rotate(),
      ),
  });
  const getEventHistoryRetention = Object.freeze({
    execute: () =>
      runner.run("read_event_history_retention", () =>
        requireEventHistoryOperations().getRetentionSummary(),
      ),
  });
  const setEventHistoryRetention = Object.freeze({
    execute: (value: unknown) =>
      runEventHistoryMutation(
        "update_administrative_event_history_retention",
        () => requireEventHistoryOperations().setRetentionPolicy(value),
      ),
  });
  const pruneEventHistory = Object.freeze({
    execute: () =>
      runEventHistoryMutation("prune_administrative_event_history", () =>
        requireEventHistoryOperations().pruneSegments(),
      ),
  });
  const listEventHistoryExports = Object.freeze({
    execute: () =>
      runner.run("list_event_history_exports", () =>
        requireEventHistoryOperations().listExports(),
      ),
  });
  const getEventHistoryExport = Object.freeze({
    execute: (exportId: string) =>
      runner.run("read_event_history_export", async () => {
        const value = await requireEventHistoryOperations().getExport(exportId);
        if (value === undefined)
          throw new Error("event_history_export_not_found");
        return value;
      }),
  });
  const createEventHistoryExport = Object.freeze({
    execute: (value: unknown) =>
      runEventHistoryMutation(
        "create_administrative_event_history_export",
        () => requireEventHistoryOperations().createExport(value),
        typeof value === "object" && value !== null
          ? (value as Readonly<Record<string, unknown>>)
          : Object.freeze({}),
      ),
  });
  const downloadEventHistoryExport = Object.freeze({
    execute: (exportId: string) =>
      runner.run("download_event_history_export", () =>
        requireEventHistoryOperations().readExport(exportId),
      ),
  });
  const pruneEventHistoryExports = Object.freeze({
    execute: () =>
      runEventHistoryMutation(
        "prune_administrative_event_history_exports",
        () => requireEventHistoryOperations().pruneExports(),
      ),
  });
  const getOperationsOverview = Object.freeze({
    execute: () =>
      runner.run("read_operations_overview", async (observedAt) => {
        const services =
          await requireServices().listRegisteredServices.execute();
        const entries = (await Promise.all(
          services.map((service) => readService(service.id)),
        )) as readonly Readonly<{
          status: { state: string };
          effectiveAvailability: string;
        }>[];
        const stateCounts: Record<string, number> = {};
        const availabilityCounts: Record<string, number> = {};
        for (const entry of entries) {
          stateCounts[entry.status.state] =
            (stateCounts[entry.status.state] ?? 0) + 1;
          availabilityCounts[entry.effectiveAvailability] =
            (availabilityCounts[entry.effectiveAvailability] ?? 0) + 1;
        }
        const backupRuns =
          input.backupManagement === undefined
            ? []
            : await input.backupManagement.getBackupRuns({ limit: 100 });
        const backupTargets =
          input.backupManagement?.listRegisteredBackupTargets() ?? [];
        return Object.freeze({
          observedAt,
          services: Object.freeze({
            registered: entries.length,
            ...stateCounts,
          }),
          availability: Object.freeze(availabilityCounts),
          powerSafety: Object.freeze({
            backend: "mock",
            effects: "disabled",
            machineScheduler: "disabled",
            helper: "unused",
          }),
          machinePlan:
            power === undefined ? null : power.getMachinePowerPlan.execute(),
          machineSchedule:
            power === undefined ? null : power.machineOperatingPolicy,
          backups: Object.freeze({
            registeredTargets: backupTargets.length,
            enabledTargets: backupTargets.filter(
              (target) => target.schedule.mode !== "disabled",
            ).length,
            scheduledTargets: backupTargets.filter(
              (target) => target.schedule.mode === "scheduled",
            ).length,
            activeRuns: backupRuns.filter((run) => run.status === "started")
              .length,
            interruptedRuns: backupRuns.filter(
              (run) => run.status === "interrupted",
            ).length,
            lastSuccessfulAt:
              backupRuns
                .filter((run) => run.status === "succeeded")
                .map((run) => run.completedAt)
                .filter((value): value is string => value !== null)
                .sort()
                .at(-1) ?? null,
            schedulerState:
              input.backupManagement === undefined ? "disabled" : "available",
          }),
        });
      }),
  });
  const getAdministrativeDashboard = Object.freeze({
    execute: () =>
      runner.run("read_administrative_dashboard", async (observedAt) => {
        const services =
          await requireServices().listRegisteredServices.execute();
        const entries = (await Promise.all(
          services.map((service) => readService(service.id)),
        )) as readonly Readonly<{
          status: { state: string };
          effectiveAvailability: string;
        }>[];
        const states: Record<string, number> = {};
        for (const entry of entries)
          states[entry.status.state] = (states[entry.status.state] ?? 0) + 1;
        return Object.freeze({
          observedAt,
          services: Object.freeze({ registered: entries.length, ...states }),
          powerSafety: Object.freeze({
            backend: "mock",
            effects: "disabled",
            machineScheduler: "disabled",
            helper: "unused",
          }),
        });
      }),
  });
  return Object.freeze({
    getNextWakeAlarm,
    scheduleWakeAlarm,
    cancelWakeAlarm,
    requestMachineShutdown,
    prepareMachineShutdownOccurrence,
    executeMachineShutdownOccurrence,
    runMachinePowerSchedulerTick,
    getAdministrativeEventHistory,
    getAdministrativeSecurityPosture,
    getRegisteredServices,
    getRegisteredService,
    getRegisteredServiceLogs,
    startRegisteredService,
    stopRegisteredService,
    restartRegisteredService,
    getRegisteredServiceAvailability,
    getRegisteredServiceAvailabilityPreview,
    getRegisteredServiceSchedule,
    setRegisteredServiceSchedule,
    removeRegisteredServiceSchedule,
    setRegisteredServiceAvailability,
    removeRegisteredServiceAvailability,
    getOperationsOverview,
    getAdministrativeDashboard,
    getRegisteredBackupTargets,
    getRegisteredBackupTarget,
    getBackupRuns,
    getBackupRun,
    runRegisteredBackup,
    getBackupSchedule,
    setBackupSchedule,
    removeBackupSchedule,
    getBackupRetention,
    setBackupRetention,
    pruneBackupRetention,
    runBackupSchedulerTick,
    verifyEventHistoryIntegrity,
    rotateEventHistory,
    getEventHistoryRetention,
    setEventHistoryRetention,
    pruneEventHistory,
    listEventHistoryExports,
    getEventHistoryExport,
    createEventHistoryExport,
    downloadEventHistoryExport,
    pruneEventHistoryExports,
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
    validate?: (evaluatedAt: string) => void,
  ): Promise<T> {
    const evaluatedAt = this.#clock.now().toISOString();
    validate?.(evaluatedAt);
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
    if (decision.outcome === "denied") {
      if (
        decision.reason === "role_assignment_unavailable" ||
        decision.reason === "authorization_policy_unavailable"
      )
        throw new AdministrativeAccessControlError(
          "administrative_authorization_unavailable",
        );
      throw new AdministrativeAccessControlError(
        "administrative_authorization_denied",
      );
    }
    try {
      return await invoke(evaluatedAt, source);
    } catch (error) {
      if (
        error instanceof AdministrativeAuditPartialEffectError ||
        error instanceof AdministrativeAuditTrailError
      )
        throw error;
      if (
        error instanceof Error &&
        (error.message === "registered_service_not_found" ||
          error.message === "registered_backup_target_not_found" ||
          error.message === "backup_run_not_found" ||
          error.message === "backup_target_disabled" ||
          error.message === "backup_target_not_scheduled" ||
          error.message === "backup_operation_busy")
      )
        throw error;
      if (error instanceof RegisteredServiceNotFoundError) throw error;
      if (error instanceof WakeAlarmScheduleValidationError) throw error;
      if (error instanceof MachineShutdownOccurrenceExecutionError) throw error;
      throw new AdministrativeAccessControlError(
        "protected_operation_failed",
        operation,
      );
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
