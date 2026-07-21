export type ShutdownSignal = "SIGINT" | "SIGTERM";

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
  server: ClosableServer;
  logger: LifecycleLogger;
  setFailureExitCode: () => void;
}

export type RequestShutdown = (signal: ShutdownSignal) => Promise<void>;

export function createGracefulShutdown({
  server,
  logger,
  setFailureExitCode,
}: GracefulShutdownDependencies): RequestShutdown {
  let shutdownPromise: Promise<void> | undefined;

  return (signal) => {
    if (shutdownPromise !== undefined) {
      return shutdownPromise;
    }

    let resolveShutdown: () => void;
    shutdownPromise = new Promise((resolve) => {
      resolveShutdown = resolve;
    });

    logger.info(
      {
        event: "application_shutdown_started",
        signal,
      },
      "Application shutdown started",
    );

    let isComplete = false;

    const completeShutdown = (error?: unknown): void => {
      if (isComplete) {
        return;
      }

      isComplete = true;

      if (error !== undefined) {
        logger.error(
          {
            event: "application_shutdown_failed",
            signal,
            errorType: error instanceof Error ? error.name : "UnknownError",
          },
          "Application shutdown failed",
        );
        setFailureExitCode();
        resolveShutdown();
        return;
      }

      logger.info(
        {
          event: "application_shutdown_completed",
          signal,
        },
        "Application shutdown completed",
      );
      resolveShutdown();
    };

    try {
      server.close(completeShutdown);
    } catch (error) {
      completeShutdown(error);
    }

    return shutdownPromise;
  };
}

export function registerShutdownSignals(
  signalSource: SignalSource,
  requestShutdown: RequestShutdown,
): void {
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    signalSource.on(signal, () => {
      void requestShutdown(signal);
    });
  }
}
