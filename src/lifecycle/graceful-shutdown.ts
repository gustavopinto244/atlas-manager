export type ShutdownSignal = "SIGINT" | "SIGTERM";

export type ApplicationShutdownReason =
  | Readonly<{
      kind: "signal";
      signal: ShutdownSignal;
    }>
  | Readonly<{
      kind:
        | "http_server_error"
        | "scheduler_incomplete"
        | "scheduler_conflict"
        | "scheduler_failed";
    }>;

export interface ClosableServer {
  close(callback: (error?: Error) => void): unknown;
}

export interface LifecycleLogger {
  info(context: Record<string, unknown>, message: string): void;
  error(context: Record<string, unknown>, message: string): void;
}

export interface SignalSource {
  on(signal: ShutdownSignal, listener: () => void): unknown;
}

interface GracefulShutdownDependencies {
  readonly server: ClosableServer;
  readonly stopBackgroundWork: () => Promise<void>;
  readonly logger: LifecycleLogger;
  readonly setFailureExitCode: () => void;
}

export type RequestShutdown = (
  reason: ApplicationShutdownReason,
) => Promise<void>;

export function createGracefulShutdown({
  server,
  stopBackgroundWork,
  logger,
  setFailureExitCode,
}: GracefulShutdownDependencies): RequestShutdown {
  let shutdownPromise: Promise<void> | undefined;

  return (reason) => {
    if (shutdownPromise !== undefined) {
      return shutdownPromise;
    }

    const reasonContext = createReasonContext(reason);

    logger.info(
      {
        event: "application_shutdown_started",
        ...reasonContext,
      },
      "Application shutdown started",
    );

    shutdownPromise = coordinateShutdown(
      server,
      stopBackgroundWork,
      logger,
      setFailureExitCode,
      reasonContext,
    );

    return shutdownPromise;
  };
}

export function registerShutdownSignals(
  signalSource: SignalSource,
  requestShutdown: RequestShutdown,
): void {
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    signalSource.on(signal, () => {
      void requestShutdown(Object.freeze({ kind: "signal", signal }));
    });
  }
}

async function coordinateShutdown(
  server: ClosableServer,
  stopBackgroundWork: () => Promise<void>,
  logger: LifecycleLogger,
  setFailureExitCode: () => void,
  reasonContext: Readonly<Record<string, unknown>>,
): Promise<void> {
  const backgroundStop = stopBackgroundWorkSafely(stopBackgroundWork);
  const serverClose = closeServer(server);
  const [backgroundResult, serverResult] = await Promise.all([
    backgroundStop,
    serverClose,
  ]);
  const backgroundStopFailed = backgroundResult.failed;
  const serverCloseFailed = serverResult.failed;

  if (backgroundStopFailed || serverCloseFailed) {
    logger.error(
      {
        event: "application_shutdown_failed",
        ...reasonContext,
        serverCloseFailed,
        backgroundStopFailed,
        ...(serverResult.failed
          ? { serverErrorType: getErrorType(serverResult.error) }
          : {}),
        ...(backgroundResult.failed
          ? { backgroundErrorType: getErrorType(backgroundResult.error) }
          : {}),
      },
      "Application shutdown failed",
    );
    setFailureExitCode();
    return;
  }

  logger.info(
    {
      event: "application_shutdown_completed",
      ...reasonContext,
    },
    "Application shutdown completed",
  );
}

type ShutdownOperationResult =
  Readonly<{ failed: false }> | Readonly<{ failed: true; error: unknown }>;

function stopBackgroundWorkSafely(
  stopBackgroundWork: () => Promise<void>,
): Promise<ShutdownOperationResult> {
  try {
    return stopBackgroundWork().then(
      () => ({ failed: false }),
      (error: unknown) => ({ failed: true, error }),
    );
  } catch (error: unknown) {
    return Promise.resolve({ failed: true, error });
  }
}

function closeServer(server: ClosableServer): Promise<ShutdownOperationResult> {
  return new Promise((resolve) => {
    try {
      server.close((error) => {
        if (error === undefined) {
          resolve({ failed: false });
        } else {
          resolve({ failed: true, error });
        }
      });
    } catch (error: unknown) {
      resolve({ failed: true, error });
    }
  });
}

function createReasonContext(
  reason: ApplicationShutdownReason,
): Readonly<Record<string, unknown>> {
  return reason.kind === "signal"
    ? { reasonKind: reason.kind, signal: reason.signal }
    : { reasonKind: reason.kind };
}

function getErrorType(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}
