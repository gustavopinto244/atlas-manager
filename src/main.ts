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
import type { PowerManagementCapabilities } from "./power-management/composition/create-power-management.js";
import {
  createLogger,
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
import { FileServiceAvailabilityReconciliationOccurrenceClaimStore } from "./service-management/infrastructure/file-service-availability-reconciliation-occurrence-claim-store.js";
import { FileServiceAvailabilityReconciliationSchedulerCursorStore } from "./service-management/infrastructure/file-service-availability-reconciliation-scheduler-cursor-store.js";

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
    const serviceManagementOverrides:
      ServiceManagementCompositionOverrides | undefined =
      schedulerCursorStore === undefined &&
      occurrenceClaimStore === undefined &&
      availabilityOverrideStore === undefined
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
          };
    const serviceManagement = createServiceManagement(
      process.env,
      serviceManagementOverrides,
    );
    const administrativePowerEnabled =
      config.administrativeWakeAlarmHttpEnabled ||
      config.administrativeShutdownHttpEnabled;
    const eventHistoryRequired =
      config.administrativeEventHistoryHttpEnabled ||
      administrativePowerEnabled ||
      config.machinePowerSchedulerEnabled;
    if (
      eventHistoryRequired &&
      config.administrativeEventHistoryFilePath === undefined
    ) {
      throw new Error("Event-history persistence is required");
    }
    const eventHistory =
      config.administrativeEventHistoryFilePath === undefined
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
          )
        : undefined;
    const administrativeRuntime =
      config.administrativeEventHistoryHttpEnabled ||
      config.administrativeWakeAlarmHttpEnabled ||
      config.administrativeShutdownHttpEnabled
        ? createAdministrativeRuntime(config, serviceManagement, {
            ...(eventHistory === undefined ? {} : { eventHistory }),
            ...(powerManagement === undefined ? {} : { powerManagement }),
          })
        : undefined;
    const machinePowerSchedulerLoop = config.machinePowerSchedulerEnabled
      ? new MachinePowerSchedulerLoop(
          powerManagement!.runMachinePowerSchedulerTick,
          new NodeMachinePowerSchedulerTimer(),
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
