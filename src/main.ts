import {
  formatEnvironmentValidationError,
  parseEnvironment,
  type EnvironmentConfig,
} from "./config/environment.js";
import { createApp } from "./http/create-app.js";
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
import { createServiceManagement } from "./service-management/composition/create-service-management.js";

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
    const serviceManagement = createServiceManagement(process.env);
    const app = createApp({ logger, getServerHealth });
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

start();
