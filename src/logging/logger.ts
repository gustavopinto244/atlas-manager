import pino, { type DestinationStream, type Logger as PinoLogger } from "pino";

import type { LogLevel } from "../config/environment.js";

interface HttpServerStartedContext {
  host: string;
  port: number;
}

export interface SchedulerRuntimeLogger {
  info(context: Record<string, unknown>, message: string): void;
  error(context: Record<string, unknown>, message: string): void;
}

export function createLogger(
  level: LogLevel,
  destination?: DestinationStream,
): PinoLogger {
  const options = { level };

  return destination === undefined ? pino(options) : pino(options, destination);
}

export function logHttpServerStarted(
  logger: PinoLogger,
  context: HttpServerStartedContext,
): void {
  logger.info(
    {
      event: "http_server_started",
      host: context.host,
      port: context.port,
    },
    "HTTP server started",
  );
}

export function logUnexpectedStartupFailure(
  logger: PinoLogger,
  error: unknown,
): void {
  logger.error(
    {
      event: "application_startup_failed",
      errorType: error instanceof Error ? error.name : "UnknownError",
    },
    "Application startup failed",
  );
}

export function logServiceAvailabilityReconciliationSchedulerStarted(
  logger: SchedulerRuntimeLogger,
): void {
  logger.info(
    {
      event: "service_availability_reconciliation_scheduler_started",
    },
    "Service availability reconciliation scheduler started",
  );
}

export function logServiceAvailabilityReconciliationSchedulerStopped(
  logger: SchedulerRuntimeLogger,
): void {
  logger.info(
    {
      event: "service_availability_reconciliation_scheduler_stopped",
    },
    "Service availability reconciliation scheduler stopped",
  );
}

export function logServiceAvailabilityReconciliationSchedulerTerminated(
  logger: SchedulerRuntimeLogger,
  context:
    | Readonly<{ outcome: "incomplete" | "conflict" }>
    | Readonly<{ outcome: "failed"; errorType: string }>,
): void {
  logger.error(
    {
      event: "service_availability_reconciliation_scheduler_terminated",
      ...context,
    },
    "Service availability reconciliation scheduler terminated",
  );
}

export function logServiceAvailabilityReconciliationSchedulerObserverFailed(
  logger: SchedulerRuntimeLogger,
  error: unknown,
): void {
  logger.error(
    {
      event: "service_availability_reconciliation_scheduler_observer_failed",
      errorType: error instanceof Error ? error.name : "UnknownError",
    },
    "Service availability reconciliation scheduler observer failed",
  );
}

export function logMachinePowerSchedulerStarted(
  logger: SchedulerRuntimeLogger,
): void {
  logger.info(
    { event: "machine_power_scheduler_started" },
    "Machine-power scheduler started",
  );
}

export function logMachinePowerSchedulerStopped(
  logger: SchedulerRuntimeLogger,
): void {
  logger.info(
    { event: "machine_power_scheduler_stopped" },
    "Machine-power scheduler stopped",
  );
}

export function logMachinePowerSchedulerTerminated(
  logger: SchedulerRuntimeLogger,
  context: Readonly<{
    outcome: "blocked" | "incomplete" | "conflict" | "failed";
    errorType?: string;
  }>,
): void {
  logger.error(
    {
      event: "machine_power_scheduler_terminated",
      ...context,
    },
    "Machine-power scheduler terminated",
  );
}

export function logMachinePowerSchedulerObserverFailed(
  logger: SchedulerRuntimeLogger,
  error: unknown,
): void {
  logger.error(
    {
      event: "machine_power_scheduler_observer_failed",
      errorType: error instanceof Error ? error.name : "UnknownError",
    },
    "Machine-power scheduler observer failed",
  );
}

export function logMachinePowerEffectsActivationDisabled(
  logger: PinoLogger,
): void {
  logger.info(
    { event: "machine_power_effects_activation_disabled" },
    "Machine power-effects activation disabled",
  );
}

export function logMachinePowerEffectsActivationAdmitted(
  logger: PinoLogger,
  context: Readonly<{
    administrativeWakeEnabled: boolean;
    administrativeShutdownEnabled: boolean;
    schedulerEnabled: boolean;
  }>,
): void {
  logger.info(
    {
      event: "machine_power_effects_activation_admitted",
      activationKind: "linux_helper",
      ...context,
    },
    "Machine power-effects activation admitted",
  );
}

export function logMachinePowerEffectsActivationBlocked(
  logger: PinoLogger,
  error: unknown,
): void {
  logger.error(
    {
      event: "machine_power_effects_activation_blocked",
      errorType: error instanceof Error ? error.name : "UnknownError",
    },
    "Machine power-effects activation blocked",
  );
}

export function logMachinePowerRuntimeIdentityAdmitted(
  logger: PinoLogger,
): void {
  logger.info(
    {
      event: "machine_power_runtime_identity_admitted",
      identityKind: "dedicated_service_account",
    },
    "Machine power runtime identity admitted",
  );
}

export function logMachinePowerRuntimeIdentityBlocked(
  logger: PinoLogger,
  error: unknown,
): void {
  logger.error(
    {
      event: "machine_power_runtime_identity_blocked",
      errorType: error instanceof Error ? error.name : "UnknownError",
    },
    "Machine power runtime identity blocked",
  );
}

export function logUnhandledError(
  logger: PinoLogger,
  error: unknown,
): void {
  const errorType = error instanceof Error ? error.name : "UnknownError";
  const errorMessage =
    error instanceof Error ? error.message : String(error);
  logger.error(
    {
      event: "unhandled_error_detected",
      errorType,
      errorMessage,
    },
    "Unhandled error detected, initiating shutdown",
  );
}
