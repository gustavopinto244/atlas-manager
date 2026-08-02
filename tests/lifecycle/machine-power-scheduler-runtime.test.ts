import { describe, expect, it, vi } from "vitest";

import { MachinePowerSchedulerRuntime } from "../../src/lifecycle/machine-power-scheduler-runtime.js";
import type { RequestShutdown } from "../../src/lifecycle/graceful-shutdown.js";
import type {
  MachinePowerSchedulerLoop,
  MachinePowerSchedulerLoopCompletion,
} from "../../src/power-management/application/machine-power-scheduler-loop.js";

describe("MachinePowerSchedulerRuntime", () => {
  it("starts only once and logs a normal stopped completion", async () => {
    const controlled = createControlledRuntime();
    const first = controlled.runtime.start();
    const second = controlled.runtime.start();

    expect(second).toBe(first);
    expect(controlled.loopStart).toHaveBeenCalledOnce();
    controlled.deferred.resolve({ kind: "stopped" });
    await first;
    await flushPromises();

    expect(controlled.logger.info).toHaveBeenCalledWith(
      { event: "machine_power_scheduler_stopped" },
      "Machine-power scheduler stopped",
    );
    expect(controlled.requestShutdown).not.toHaveBeenCalled();
    expect(controlled.setFailureExitCode).not.toHaveBeenCalled();
  });

  it.each([
    ["blocked", "machine_power_scheduler_blocked"],
    ["incomplete", "machine_power_scheduler_incomplete"],
    ["conflict", "machine_power_scheduler_conflict"],
    ["failed", "machine_power_scheduler_failed"],
  ] as const)(
    "maps %s to its distinct shutdown reason",
    async (kind, reason) => {
      const controlled = createControlledRuntime();
      void controlled.runtime.start();
      controlled.deferred.resolve(
        kind === "failed"
          ? { kind, error: new Error("secret") }
          : ({ kind } as MachinePowerSchedulerLoopCompletion),
      );
      await flushPromises();

      expect(controlled.logger.error).toHaveBeenCalledWith(
        {
          event: "machine_power_scheduler_terminated",
          outcome: kind,
          ...(kind === "failed" ? { errorType: "Error" } : {}),
        },
        "Machine-power scheduler terminated",
      );
      expect(controlled.setFailureExitCode).toHaveBeenCalledOnce();
      expect(controlled.requestShutdown).toHaveBeenCalledExactlyOnceWith({
        kind: reason,
      });
    },
  );

  it("logs only bounded error types when shutdown observation fails", async () => {
    const controlled = createControlledRuntime({
      requestShutdown: vi.fn<RequestShutdown>(() =>
        Promise.reject(new TypeError("secret path")),
      ),
    });
    void controlled.runtime.start();
    controlled.deferred.resolve({ kind: "failed", error: new Error("secret") });
    await flushPromises();

    expect(controlled.logger.error).toHaveBeenLastCalledWith(
      {
        event: "machine_power_scheduler_observer_failed",
        errorType: "TypeError",
      },
      "Machine-power scheduler observer failed",
    );
    expect(JSON.stringify(controlled.logger.error.mock.calls)).not.toContain(
      "secret",
    );
  });
});

function createControlledRuntime(
  overrides: {
    readonly requestShutdown?: ReturnType<typeof vi.fn<RequestShutdown>>;
  } = {},
) {
  const deferred = createDeferred<MachinePowerSchedulerLoopCompletion>();
  const loopStart = vi.fn(() => deferred.promise);
  const loopStop = vi.fn(() => deferred.promise);
  const loop = {
    start: loopStart,
    stop: loopStop,
  } as unknown as MachinePowerSchedulerLoop;
  const requestShutdown =
    overrides.requestShutdown ??
    vi.fn<RequestShutdown>(() => Promise.resolve());
  const logger = { info: vi.fn(), error: vi.fn() };
  const setFailureExitCode = vi.fn();
  const runtime = new MachinePowerSchedulerRuntime(
    loop,
    requestShutdown,
    logger,
    setFailureExitCode,
  );
  return {
    runtime,
    deferred,
    loopStart,
    loopStop,
    requestShutdown,
    logger,
    setFailureExitCode,
  };
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
