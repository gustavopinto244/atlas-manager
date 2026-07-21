import {
  formatEnvironmentValidationError,
  parseEnvironment,
  type EnvironmentConfig,
} from "./config/environment.js";
import { createApp } from "./http/create-app.js";
import {
  createGracefulShutdown,
  registerShutdownSignals,
} from "./lifecycle/graceful-shutdown.js";
import {
  createLogger,
  logHttpServerStarted,
  logUnexpectedStartupFailure,
} from "./logging/logger.js";

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
    const app = createApp(logger);
    const server = app.listen(config.port, config.host);
    const requestShutdown = createGracefulShutdown({
      server,
      logger,
      setFailureExitCode: () => {
        process.exitCode = 1;
      },
    });

    registerShutdownSignals(process, requestShutdown);

    server.once("listening", () => {
      logHttpServerStarted(logger, {
        host: config.host,
        port: config.port,
      });
    });

    server.once("error", (error) => {
      logUnexpectedStartupFailure(logger, error);
      process.exitCode = 1;
    });
  } catch (error) {
    logUnexpectedStartupFailure(logger, error);
    process.exitCode = 1;
  }
}

start();
