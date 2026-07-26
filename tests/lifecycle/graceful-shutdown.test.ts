import { describe, expect, it, vi } from "vitest";

import {
  createGracefulShutdown,
  registerShutdownSignals,
  type RequestShutdown,
  type ShutdownSignal,
} from "../../src/lifecycle/graceful-shutdown.js";

function createTestLogger() {
  return {
    info: vi.fn(),
    error: vi.fn(),
  };
}

describe("graceful shutdown", () => {
  it("starts server close and background stop promptly and waits for both", async () => {
    const logger = createTestLogger();
    const setFailureExitCode = vi.fn();
    let closeServer: (() => void) | undefined;
    let stopBackground: (() => void) | undefined;
    const server = {
      close: vi.fn((callback: (error?: Error) => void) => {
        closeServer = callback;
      }),
    };
    const stopBackgroundWork = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          stopBackground = resolve;
        }),
    );
    const requestShutdown = createGracefulShutdown({
      server,
      stopBackgroundWork,
      logger,
      setFailureExitCode,
    });

    const completion = requestShutdown(
      Object.freeze({ kind: "signal", signal: "SIGTERM" }),
    );

    expect(server.close).toHaveBeenCalledOnce();
    expect(stopBackgroundWork).toHaveBeenCalledOnce();
    expect(logger.info).toHaveBeenCalledOnce();

    closeServer?.();
    let completed = false;
    void completion.then(() => {
      completed = true;
    });
    await Promise.resolve();
    expect(completed).toBe(false);

    stopBackground?.();
    await completion;

    expect(logger.info).toHaveBeenLastCalledWith(
      {
        event: "application_shutdown_completed",
        reasonKind: "signal",
        signal: "SIGTERM",
      },
      "Application shutdown completed",
    );
    expect(logger.error).not.toHaveBeenCalled();
    expect(setFailureExitCode).not.toHaveBeenCalled();
  });

  it("safely handles a server-close failure after observing background stop", async () => {
    const logger = createTestLogger();
    const setFailureExitCode = vi.fn();
    let stopBackground: (() => void) | undefined;
    const serverError = new TypeError("secret at /private/server");
    const server = {
      close: vi.fn((callback: (error?: Error) => void) => {
        callback(serverError);
      }),
    };
    const stopBackgroundWork = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          stopBackground = resolve;
        }),
    );
    const requestShutdown = createGracefulShutdown({
      server,
      stopBackgroundWork,
      logger,
      setFailureExitCode,
    });

    const completion = requestShutdown(
      Object.freeze({ kind: "http_server_error" }),
    );
    let completed = false;
    void completion.then(() => {
      completed = true;
    });
    await Promise.resolve();
    expect(completed).toBe(false);

    stopBackground?.();
    await completion;

    expect(logger.error).toHaveBeenCalledWith(
      {
        event: "application_shutdown_failed",
        reasonKind: "http_server_error",
        serverCloseFailed: true,
        backgroundStopFailed: false,
        serverErrorType: "TypeError",
      },
      "Application shutdown failed",
    );
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("secret");
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("/private");
    expect(setFailureExitCode).toHaveBeenCalledOnce();
  });

  it("safely handles synchronous server and background-stop failures together", async () => {
    const logger = createTestLogger();
    const setFailureExitCode = vi.fn();
    const server = {
      close: vi.fn(() => {
        throw new RangeError("private server error");
      }),
    };
    const stopBackgroundWork = vi.fn(() => {
      throw new SyntaxError("private background error");
    });
    const requestShutdown = createGracefulShutdown({
      server,
      stopBackgroundWork,
      logger,
      setFailureExitCode,
    });

    await requestShutdown(Object.freeze({ kind: "scheduler_failed" }));

    expect(logger.error).toHaveBeenCalledWith(
      {
        event: "application_shutdown_failed",
        reasonKind: "scheduler_failed",
        serverCloseFailed: true,
        backgroundStopFailed: true,
        serverErrorType: "RangeError",
        backgroundErrorType: "SyntaxError",
      },
      "Application shutdown failed",
    );
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("private");
    expect(setFailureExitCode).toHaveBeenCalledOnce();
  });

  it("keeps the first reason and one promise across repeated requests", async () => {
    const logger = createTestLogger();
    let closeCallback: ((error?: Error) => void) | undefined;
    const server = {
      close: vi.fn((callback: (error?: Error) => void) => {
        closeCallback = callback;
      }),
    };
    const stopBackgroundWork = vi.fn(() => Promise.resolve());
    const requestShutdown = createGracefulShutdown({
      server,
      stopBackgroundWork,
      logger,
      setFailureExitCode: vi.fn(),
    });

    const first = requestShutdown(
      Object.freeze({ kind: "signal", signal: "SIGINT" }),
    );
    const repeated = requestShutdown(
      Object.freeze({ kind: "scheduler_conflict" }),
    );

    expect(repeated).toBe(first);
    expect(server.close).toHaveBeenCalledOnce();
    expect(stopBackgroundWork).toHaveBeenCalledOnce();
    expect(logger.info).toHaveBeenCalledOnce();

    closeCallback?.();
    await first;

    expect(logger.info).toHaveBeenLastCalledWith(
      {
        event: "application_shutdown_completed",
        reasonKind: "signal",
        signal: "SIGINT",
      },
      "Application shutdown completed",
    );
  });

  it("registers frozen SIGINT and SIGTERM shutdown reasons", () => {
    const listeners = new Map<ShutdownSignal, () => void>();
    const signalSource = {
      on: vi.fn((signal: ShutdownSignal, listener: () => void) => {
        listeners.set(signal, listener);
      }),
    };
    const requestShutdown = vi.fn<RequestShutdown>(() => Promise.resolve());

    registerShutdownSignals(signalSource, requestShutdown);

    expect(signalSource.on).toHaveBeenCalledTimes(2);
    listeners.get("SIGINT")?.();
    listeners.get("SIGTERM")?.();
    expect(requestShutdown).toHaveBeenNthCalledWith(1, {
      kind: "signal",
      signal: "SIGINT",
    });
    expect(requestShutdown).toHaveBeenNthCalledWith(2, {
      kind: "signal",
      signal: "SIGTERM",
    });
    expect(Object.isFrozen(requestShutdown.mock.calls[0]?.[0])).toBe(true);
    expect(Object.isFrozen(requestShutdown.mock.calls[1]?.[0])).toBe(true);
  });
});
