import {
  formatEnvironmentValidationError,
  parseEnvironment,
  type EnvironmentConfig,
} from "./config/environment.js";
import { createApp } from "./http/create-app.js";
import {
  FixedAdministrativeRequestAdmission,
  type AdministrativeRequestClock,
} from "./http/administrative-request-admission.js";
import type { AdministrativeEventHistoryRouteDependencies } from "./http/administrative-event-history-route.js";
import type { CloudflareAccessAssertionReader } from "./access-control/application/ports/cloudflare-access-assertion-reader.js";
import type { AdministrativeEventHistoryPage } from "./event-history/domain/administrative-event-history-page.js";
import { createCloudflareAccessAdministrativeAuthentication } from "./access-control/composition/create-cloudflare-access-administrative-authentication.js";
import { createAdministrativeAccessControl } from "./access-control/composition/create-administrative-access-control.js";
import { createProtectedAdministration } from "./access-control/composition/create-protected-administration.js";
import { InMemoryAdministrativeRoleAssignmentReader } from "./access-control/infrastructure/in-memory-administrative-role-assignment-reader.js";
import { createEventHistory } from "./event-history/composition/create-event-history.js";
import { createPowerManagement } from "./power-management/composition/create-power-management.js";
import {
  createGracefulShutdown,
  registerShutdownSignals,
  type RequestShutdown,
} from "./lifecycle/graceful-shutdown.js";
import { ServiceAvailabilityReconciliationSchedulerRuntime } from "./lifecycle/service-availability-reconciliation-scheduler-runtime.js";
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
    const administrativeEventHistory =
      config.administrativeEventHistoryHttpEnabled
        ? createAdministrativeEventHistoryRouteDependencies(config)
        : undefined;
    const app = createApp({
      logger,
      getServerHealth,
      ...(administrativeEventHistory === undefined
        ? {}
        : { administrativeEventHistory }),
    });
    const server = app.listen(config.port, config.host);
    const setFailureExitCode = (): void => {
      process.exitCode = 1;
    };
    const coordinatedShutdown = createGracefulShutdown({
      server,
      stopBackgroundWork: () =>
        serviceManagement.serviceAvailabilityReconciliationSchedulerLoop
          .stop()
          .then(() => undefined),
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

function createAdministrativeEventHistoryRouteDependencies(
  config: EnvironmentConfig,
): AdministrativeEventHistoryRouteDependencies {
  const filePath = config.administrativeEventHistoryFilePath;
  const roleAssignments = config.administrativeRoleAssignments;
  const cloudflareAccess = config.cloudflareAccess;
  if (filePath === undefined || roleAssignments === undefined) {
    throw new Error("Administrative event-history configuration is incomplete");
  }
  if (cloudflareAccess === undefined) {
    throw new Error("Cloudflare Access configuration is incomplete");
  }

  const clock: AdministrativeRequestClock = Object.freeze({
    now: () => new Date(),
  });
  const eventHistory = createEventHistory({ filePath });
  const roleAssignmentReader = new InMemoryAdministrativeRoleAssignmentReader({
    assignments: roleAssignments.map((assignment) => ({
      principalId: assignment.principal.principalId,
      roles: assignment.roles,
    })),
  });
  const cloudflareAuthentication =
    createCloudflareAccessAdministrativeAuthentication({
      configuration: cloudflareAccess,
      clock,
    });
  const powerManagement = createPowerManagement({
    clock,
    administrativeEventHistoryCapabilities: eventHistory,
  });
  const admission = new FixedAdministrativeRequestAdmission(clock);

  return Object.freeze({
    admission,
    createProtectedEventHistoryQuery: (
      reader: CloudflareAccessAssertionReader,
    ) => {
      const accessControl = createAdministrativeAccessControl({
        authenticator:
          cloudflareAuthentication.createAuthenticationProviderForRequest(
            reader,
          ),
        roleAssignmentReader,
      });
      const protectedAdministration = createProtectedAdministration({
        accessControl,
        powerManagement,
        eventHistory,
        clock,
      });
      return Object.freeze({
        execute: async (query: unknown) =>
          (await protectedAdministration.getAdministrativeEventHistory.execute(
            query,
          )) as AdministrativeEventHistoryPage,
      });
    },
  });
}

start();
