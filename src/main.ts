import {
  formatEnvironmentValidationError,
  parseEnvironment,
  type EnvironmentConfig,
} from "./config/environment.js";
import { createApp } from "./http/create-app.js";
import { createAdministrativeRuntime } from "./http/create-administrative-runtime.js";
import {
  createGracefulShutdown,
  registerShutdownSignals,
  type RequestShutdown,
} from "./lifecycle/graceful-shutdown.js";
import { MachinePowerSchedulerRuntime } from "./lifecycle/machine-power-scheduler-runtime.js";
import { ServiceAvailabilityReconciliationSchedulerRuntime } from "./lifecycle/service-availability-reconciliation-scheduler-runtime.js";
import { MachinePowerSchedulerLoop } from "./power-management/application/machine-power-scheduler-loop.js";
import { NodeMachinePowerSchedulerTimer } from "./power-management/infrastructure/node-machine-power-scheduler-timer.js";
import { createEventHistory } from "./event-history/composition/create-event-history.js";
import { createConfiguredPowerManagementRuntime } from "./power-management/composition/create-configured-power-management-runtime.js";
import {
  admitConfiguredMachinePowerEffects,
  isRuntimeIdentityAdmissionError,
} from "./power-management/composition/admit-configured-machine-power-effects.js";
import type { PowerManagementCapabilities } from "./power-management/composition/create-power-management.js";
import {
  createLogger,
  logMachinePowerEffectsActivationAdmitted,
  logMachinePowerEffectsActivationBlocked,
  logMachinePowerEffectsActivationDisabled,
  logMachinePowerRuntimeIdentityAdmitted,
  logMachinePowerRuntimeIdentityBlocked,
  logHttpServerStarted,
  logUnexpectedStartupFailure,
} from "./logging/logger.js";
import { GetServerHealth } from "./server-health/application/get-server-health.js";
import { LinuxCoretempCpuTemperatureReader } from "./server-health/infrastructure/linux-coretemp-cpu-temperature-reader.js";
import {
  createNodeServerHealthReaderDependencies,
  NodeServerHealthReader,
} from "./server-health/infrastructure/node-server-health-reader.js";
import {
  createServiceManagement,
  type ServiceManagementCompositionOverrides,
} from "./service-management/composition/create-service-management.js";
import { FileServiceAvailabilityOverrideStore } from "./service-management/infrastructure/file-service-availability-override-store.js";
import { FileServiceAvailabilityPolicyStore } from "./service-management/infrastructure/file-service-availability-policy-store.js";
import { FileServiceAvailabilityReconciliationOccurrenceClaimStore } from "./service-management/infrastructure/file-service-availability-reconciliation-occurrence-claim-store.js";
import { FileServiceAvailabilityReconciliationSchedulerCursorStore } from "./service-management/infrastructure/file-service-availability-reconciliation-scheduler-cursor-store.js";
import { createBackupManagement } from "./backup-management/composition/create-backup-management.js";
import { FileBackupRunStore } from "./backup-management/infrastructure/file-backup-run-store.js";
import { BackupSchedulerLoop } from "./backup-management/application/backup-scheduler-loop.js";
import type { MachineReadinessState } from "./power-management/application/ports/machine-shutdown-readiness-readers.js";

function start(): void {
  let config: EnvironmentConfig;

  try {
    config = parseEnvironment(process.env);
  } catch (error) {
    const message = formatEnvironmentValidationError(error);

    if (message === undefined) {
      throw error;
    }

    console.error(message);
    process.exitCode = 1;
    return;
  }

  const logger = createLogger(config.logLevel);

  try {
    let activationAdmission:
      ReturnType<typeof admitConfiguredMachinePowerEffects> | undefined;
    try {
      activationAdmission = admitConfiguredMachinePowerEffects(config);
    } catch (error) {
      if (isRuntimeIdentityAdmissionError(error))
        logMachinePowerRuntimeIdentityBlocked(logger, error);
      else logMachinePowerEffectsActivationBlocked(logger, error);
      throw error;
    }
    if (activationAdmission.kind === "disabled") {
      logMachinePowerEffectsActivationDisabled(logger);
    } else {
      logMachinePowerEffectsActivationAdmitted(logger, {
        administrativeWakeEnabled: config.administrativeWakeAlarmHttpEnabled,
        administrativeShutdownEnabled: config.administrativeShutdownHttpEnabled,
        schedulerEnabled: config.machinePowerSchedulerEnabled,
      });
      logMachinePowerRuntimeIdentityAdmitted(logger);
    }
    const cpuTemperatureReader = new LinuxCoretempCpuTemperatureReader();
    const serverHealthReader = new NodeServerHealthReader(
      "/",
      createNodeServerHealthReaderDependencies(cpuTemperatureReader),
    );
    const getServerHealth = new GetServerHealth(serverHealthReader);
    const schedulerCursorStore =
      config.serviceAvailabilityReconciliationSchedulerCursorFilePath ===
      undefined
        ? undefined
        : new FileServiceAvailabilityReconciliationSchedulerCursorStore(
            config.serviceAvailabilityReconciliationSchedulerCursorFilePath,
          );
    const occurrenceClaimStore =
      config.serviceAvailabilityReconciliationOccurrenceClaimFilePath ===
      undefined
        ? undefined
        : new FileServiceAvailabilityReconciliationOccurrenceClaimStore(
            config.serviceAvailabilityReconciliationOccurrenceClaimFilePath,
          );
    const availabilityOverrideStore =
      config.serviceAvailabilityOverrideFilePath === undefined
        ? undefined
        : new FileServiceAvailabilityOverrideStore(
            config.serviceAvailabilityOverrideFilePath,
          );
    const availabilityPolicyStore =
      config.serviceAvailabilityPolicyFilePath === undefined
        ? undefined
        : new FileServiceAvailabilityPolicyStore(
            config.serviceAvailabilityPolicyFilePath,
          );
    const serviceManagementOverrides:
      ServiceManagementCompositionOverrides | undefined =
      schedulerCursorStore === undefined &&
      occurrenceClaimStore === undefined &&
      availabilityOverrideStore === undefined &&
      availabilityPolicyStore === undefined
        ? undefined
        : {
            ...(schedulerCursorStore === undefined
              ? {}
              : {
                  serviceAvailabilityReconciliationSchedulerCursorStore:
                    schedulerCursorStore,
                }),
            ...(occurrenceClaimStore === undefined
              ? {}
              : {
                  serviceAvailabilityReconciliationOccurrenceClaimStore:
                    occurrenceClaimStore,
                }),
            ...(availabilityOverrideStore === undefined
              ? {}
              : {
                  serviceAvailabilityOverrideStore: availabilityOverrideStore,
                }),
            ...(availabilityPolicyStore === undefined
              ? {}
              : {
                  serviceAvailabilityPolicyStore: availabilityPolicyStore,
                }),
          };
    const serviceManagement = createServiceManagement(
      process.env,
      serviceManagementOverrides,
    );
    const backupManagement =
      config.administrativeBackupHttpEnabled === true ||
      config.backupSchedulerEnabled === true
        ? createBackupManagement({
            targets: (
              config.registeredBackupTargets ?? { list: () => [] }
            ).list(),
            ...(config.backupRunHistoryFilePath === undefined
              ? {}
              : {
                  runStore: new FileBackupRunStore(
                    config.backupRunHistoryFilePath,
                  ),
                }),
            ...(config.backupOccurrenceClaimFilePath === undefined
              ? {}
              : { occurrenceClaimFile: config.backupOccurrenceClaimFilePath }),
            ...(config.backupSchedulerCursorFilePath === undefined
              ? {}
              : { schedulerCursorFile: config.backupSchedulerCursorFilePath }),
          })
        : undefined;
    const administrativePowerEnabled =
      config.administrativeWakeAlarmHttpEnabled ||
      config.administrativeShutdownHttpEnabled;
    const eventHistoryRequired =
      config.administrativeEventHistoryHttpEnabled ||
      administrativePowerEnabled ||
      config.machinePowerSchedulerEnabled ||
      config.administrativeServiceManagementHttpEnabled === true ||
      config.administrativeServiceAvailabilityHttpEnabled === true ||
      config.administrativeOverviewHttpEnabled === true ||
      config.administrativeDashboardEnabled === true ||
      config.administrativeBackupHttpEnabled === true ||
      config.administrativeEventHistoryOperationsHttpEnabled === true ||
      config.administrativeSecurityStatusHttpEnabled === true ||
      config.backupSchedulerEnabled;
    if (
      eventHistoryRequired &&
      config.administrativeEventHistoryFilePath === undefined &&
      config.administrativeEventHistoryDirectoryPath === undefined
    ) {
      throw new Error("Event-history persistence is required");
    }
    const eventHistory =
      config.administrativeEventHistoryDirectoryPath !== undefined
        ? createEventHistory({
            directoryPath: config.administrativeEventHistoryDirectoryPath,
            directoryDependencies: {
              lockPath: "/run/atlas-manager/event-history-writer.lock",
              ...(config.administrativeEventHistoryMaxSegmentEvents ===
              undefined
                ? {}
                : {
                    maxSegmentEvents:
                      config.administrativeEventHistoryMaxSegmentEvents,
                  }),
              ...(config.administrativeEventHistoryMaxSegmentBytes === undefined
                ? {}
                : {
                    maxSegmentBytes:
                      config.administrativeEventHistoryMaxSegmentBytes,
                  }),
              ...(config.administrativeEventHistoryRetentionPolicy === undefined
                ? {}
                : {
                    retentionPolicy:
                      config.administrativeEventHistoryRetentionPolicy,
                  }),
            },
          })
        : config.administrativeEventHistoryFilePath === undefined
          ? undefined
          : createEventHistory({
              filePath: config.administrativeEventHistoryFilePath,
            });
    const powerManagement: PowerManagementCapabilities | undefined =
      administrativePowerEnabled || config.machinePowerSchedulerEnabled
        ? createConfiguredPowerManagementRuntime(
            config,
            serviceManagement,
            eventHistory!,
            activationAdmission.kind === "linux_helper"
              ? {
                  expectedHelperGroupId:
                    activationAdmission.runtimeIdentity.helperGroupId,
                  ...(backupManagement === undefined
                    ? {}
                    : {
                        machineShutdownBackupReadinessReader:
                          createBackupReadinessReader(backupManagement),
                      }),
                }
              : backupManagement === undefined
                ? undefined
                : {
                    machineShutdownBackupReadinessReader:
                      createBackupReadinessReader(backupManagement),
                  },
          )
        : undefined;
    const administrativeRuntime =
      config.administrativeEventHistoryHttpEnabled ||
      config.administrativeWakeAlarmHttpEnabled ||
      config.administrativeShutdownHttpEnabled ||
      config.administrativeServiceManagementHttpEnabled === true ||
      config.administrativeServiceAvailabilityHttpEnabled === true ||
      config.administrativeOverviewHttpEnabled === true ||
      config.administrativeDashboardEnabled === true ||
      config.administrativeBackupHttpEnabled === true ||
      config.administrativeEventHistoryOperationsHttpEnabled === true ||
      config.administrativeSecurityStatusHttpEnabled === true
        ? createAdministrativeRuntime(config, serviceManagement, {
            ...(eventHistory === undefined ? {} : { eventHistory }),
            ...(powerManagement === undefined ? {} : { powerManagement }),
            getServerHealth,
            applicationVersion: "1.0.0-rc.7",
            ...(backupManagement === undefined ? {} : { backupManagement }),
          })
        : undefined;
    const machinePowerSchedulerLoop = config.machinePowerSchedulerEnabled
      ? new MachinePowerSchedulerLoop(
          powerManagement!.runMachinePowerSchedulerTick,
          new NodeMachinePowerSchedulerTimer(),
        )
      : undefined;
    const backupSchedulerLoop =
      config.backupSchedulerEnabled === true
        ? new BackupSchedulerLoop(() =>
            backupManagement!.runBackupSchedulerTick(),
          )
        : undefined;
    const app = createApp({
      logger,
      getServerHealth,
      ...(administrativeRuntime?.eventHistory === undefined
        ? {}
        : { administrativeEventHistory: administrativeRuntime.eventHistory }),
      ...(administrativeRuntime?.wakeAlarm === undefined
        ? {}
        : { administrativeWakeAlarm: administrativeRuntime.wakeAlarm }),
      ...(administrativeRuntime?.shutdown === undefined
        ? {}
        : { administrativeShutdown: administrativeRuntime.shutdown }),
      ...(administrativeRuntime?.services === undefined
        ? {}
        : { administrativeServices: administrativeRuntime.services }),
      ...(administrativeRuntime?.availability === undefined
        ? {}
        : {
            administrativeServiceAvailability:
              administrativeRuntime.availability,
          }),
      ...(administrativeRuntime?.schedule === undefined
        ? {}
        : {
            administrativeServiceSchedule: administrativeRuntime.schedule,
          }),
      ...(administrativeRuntime?.overview === undefined
        ? {}
        : { administrativeOverview: administrativeRuntime.overview }),
      ...(administrativeRuntime?.dashboard === undefined
        ? {}
        : { administrativeDashboard: administrativeRuntime.dashboard }),
      ...(administrativeRuntime?.backups === undefined
        ? {}
        : { administrativeBackups: administrativeRuntime.backups }),
      ...(administrativeRuntime?.eventHistoryOperations === undefined
        ? {}
        : {
            administrativeEventHistoryOperations:
              administrativeRuntime.eventHistoryOperations,
          }),
      ...(administrativeRuntime?.securityStatus === undefined
        ? {}
        : {
            administrativeSecurityStatus: administrativeRuntime.securityStatus,
          }),
      ...(config.administrativePublicOrigin === undefined
        ? {}
        : { administrativePublicOrigin: config.administrativePublicOrigin }),
      ...(administrativeRuntime?.routeCatalogStatus === undefined
        ? {}
        : {
            administrativeRouteCatalogStatus:
              administrativeRuntime.routeCatalogStatus,
          }),
    });
    const server = app.listen(config.port, config.host);
    const setFailureExitCode = (): void => {
      process.exitCode = 1;
    };
    const coordinatedShutdown = createGracefulShutdown({
      server,
      stopBackgroundWork: async () => {
        const stops = [
          Promise.resolve().then(() =>
            serviceManagement.serviceAvailabilityReconciliationSchedulerLoop.stop(),
          ),
          ...(machinePowerSchedulerLoop === undefined
            ? []
            : [Promise.resolve().then(() => machinePowerSchedulerLoop.stop())]),
          ...(backupSchedulerLoop === undefined
            ? []
            : [Promise.resolve().then(() => backupSchedulerLoop.stop())]),
        ];
        const results = await Promise.allSettled(stops);
        const failure = results.find(
          (result): result is PromiseRejectedResult =>
            result.status === "rejected",
        );
        if (failure !== undefined) throw failure.reason;
      },
      logger,
      setFailureExitCode,
    });
    let shutdownRequested = false;
    const requestShutdown: RequestShutdown = (reason) => {
      shutdownRequested = true;
      return coordinatedShutdown(reason);
    };
    const schedulerRuntime =
      new ServiceAvailabilityReconciliationSchedulerRuntime(
        serviceManagement.serviceAvailabilityReconciliationSchedulerLoop,
        requestShutdown,
        logger,
        setFailureExitCode,
      );
    const machinePowerSchedulerRuntime =
      machinePowerSchedulerLoop === undefined
        ? undefined
        : new MachinePowerSchedulerRuntime(
            machinePowerSchedulerLoop,
            requestShutdown,
            logger,
            setFailureExitCode,
          );

    registerShutdownSignals(process, requestShutdown);

    server.once("listening", () => {
      if (shutdownRequested) {
        return;
      }

      logHttpServerStarted(logger, {
        host: config.host,
        port: config.port,
      });
      void schedulerRuntime.start();
      if (machinePowerSchedulerRuntime !== undefined)
        void machinePowerSchedulerRuntime.start();
      if (backupSchedulerLoop !== undefined) void backupSchedulerLoop.start();
    });

    server.once("error", (error) => {
      logUnexpectedStartupFailure(logger, error);
      setFailureExitCode();
      void requestShutdown(Object.freeze({ kind: "http_server_error" }));
    });
  } catch (error) {
    logUnexpectedStartupFailure(logger, error);
    process.exitCode = 1;
  }
}

start();

function createBackupReadinessReader(backupManagement: {
  readonly readiness: {
    read(): Promise<{
      readonly state: "ready" | "active" | "interrupted" | "unavailable";
    }>;
  };
}): {
  read(
    occurrence: unknown,
    evaluatedAt: string,
  ): Promise<MachineReadinessState>;
} {
  return {
    read: async (occurrence: unknown, evaluatedAt: string) => {
      void occurrence;
      void evaluatedAt;
      const state = await backupManagement.readiness.read();
      if (state.state === "ready") return { area: "backups", state: "ready" };
      return {
        area: "backups",
        state: "blocked",
        reason:
          state.state === "active"
            ? "backup_in_progress"
            : "backup_state_unknown",
      };
    },
  };
}
