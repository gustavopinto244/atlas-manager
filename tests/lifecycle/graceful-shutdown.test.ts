import { describe, expect, it, vi } from "vitest";

import {
  createGracefulShutdown,
  registerShutdownSignals,
  type ShutdownSignal,
} from "../../src/lifecycle/graceful-shutdown.js";

function createTestLogger() {
  return {
    info: vi.fn(),
    error: vi.fn(),
  };
}

describe("graceful shutdown", () => {
  it("closes the server and records a successful shutdown", async () => {
    const logger = createTestLogger();
    const setFailureExitCode = vi.fn();
    const server = {
      close: vi.fn((callback: (error?: Error) => void) => {
        callback();
      }),
    };
    const requestShutdown = createGracefulShutdown({
      server,
      logger,
      setFailureExitCode,
    });

    await requestShutdown("SIGTERM");

    expect(server.close).toHaveBeenCalledOnce();
    expect(logger.info).toHaveBeenNthCalledWith(
      1,
      {
        event: "application_shutdown_started",
        signal: "SIGTERM",
      },
      "Application shutdown started",
    );
    expect(logger.info).toHaveBeenNthCalledWith(
      2,
      {
        event: "application_shutdown_completed",
        signal: "SIGTERM",
      },
      "Application shutdown completed",
    );
    expect(logger.error).not.toHaveBeenCalled();
    expect(setFailureExitCode).not.toHaveBeenCalled();
  });

  it("records a safe failure and requests a non-zero exit code", async () => {
    const logger = createTestLogger();
    const setFailureExitCode = vi.fn();
    const server = {
      close: vi.fn((callback: (error?: Error) => void) => {
        callback(new Error("secret at /private/internal/path"));
      }),
    };
    const requestShutdown = createGracefulShutdown({
      server,
      logger,
      setFailureExitCode,
    });

    await requestShutdown("SIGINT");

    expect(logger.error).toHaveBeenCalledWith(
      {
        event: "application_shutdown_failed",
        signal: "SIGINT",
        errorType: "Error",
      },
      "Application shutdown failed",
    );
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("secret");
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("/private");
    expect(setFailureExitCode).toHaveBeenCalledOnce();
  });

  it("does not start concurrent shutdown operations", async () => {
    const logger = createTestLogger();
    let closeCallback: ((error?: Error) => void) | undefined;
    const server = {
      close: vi.fn((callback: (error?: Error) => void) => {
        closeCallback = callback;
      }),
    };
    const requestShutdown = createGracefulShutdown({
      server,
      logger,
      setFailureExitCode: vi.fn(),
    });

    const firstShutdown = requestShutdown("SIGTERM");
    const repeatedShutdown = requestShutdown("SIGINT");

    expect(repeatedShutdown).toBe(firstShutdown);
    expect(server.close).toHaveBeenCalledOnce();
    expect(logger.info).toHaveBeenCalledOnce();

    closeCallback?.();
    await Promise.all([firstShutdown, repeatedShutdown]);

    expect(logger.info).toHaveBeenCalledTimes(2);
    expect(logger.info).toHaveBeenLastCalledWith(
      {
        event: "application_shutdown_completed",
        signal: "SIGTERM",
      },
      "Application shutdown completed",
    );
  });

  it("registers SIGINT and SIGTERM on an injected signal source", () => {
    const listeners = new Map<ShutdownSignal, () => void>();
    const signalSource = {
      on: vi.fn((signal: ShutdownSignal, listener: () => void) => {
        listeners.set(signal, listener);
      }),
    };
    const requestShutdown = vi.fn(() => Promise.resolve());

    registerShutdownSignals(signalSource, requestShutdown);

    expect(signalSource.on).toHaveBeenCalledTimes(2);
    listeners.get("SIGINT")?.();
    listeners.get("SIGTERM")?.();
    expect(requestShutdown).toHaveBeenNthCalledWith(1, "SIGINT");
    expect(requestShutdown).toHaveBeenNthCalledWith(2, "SIGTERM");
  });
});
