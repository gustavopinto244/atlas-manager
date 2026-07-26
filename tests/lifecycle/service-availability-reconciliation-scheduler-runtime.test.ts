import { describe, expect, it, vi } from "vitest";

import type {
  ServiceAvailabilityReconciliationSchedulerLoop,
  ServiceAvailabilityReconciliationSchedulerLoopCompletion,
} from "../../src/service-management/application/service-availability-reconciliation-scheduler-loop.js";
import { ServiceAvailabilityReconciliationSchedulerRuntime } from "../../src/lifecycle/service-availability-reconciliation-scheduler-runtime.js";
import type { RequestShutdown } from "../../src/lifecycle/graceful-shutdown.js";

describe("ServiceAvailabilityReconciliationSchedulerRuntime", () => {
  it("performs no work during construction and starts the loop once", () => {
    const controlled = createControlledRuntime();

    expect(Object.isFrozen(controlled.runtime)).toBe(true);
    expect(controlled.loopStart).not.toHaveBeenCalled();
    expect(controlled.loopStop).not.toHaveBeenCalled();
    expect(controlled.requestShutdown).not.toHaveBeenCalled();
    expect(controlled.setFailureExitCode).not.toHaveBeenCalled();
    expect(controlled.logger.info).not.toHaveBeenCalled();
    expect(controlled.logger.error).not.toHaveBeenCalled();

    const first = controlled.runtime.start();
    const repeated = controlled.runtime.start();

    expect(first).toBe(controlled.deferred.promise);
    expect(repeated).toBe(first);
    expect(controlled.loopStart).toHaveBeenCalledOnce();
    expect(controlled.logger.info).toHaveBeenCalledExactlyOnceWith(
      {
        event: "service_availability_reconciliation_scheduler_started",
      },
      "Service availability reconciliation scheduler started",
    );
  });

  it("logs a stopped completion without requesting shutdown or failure", async () => {
    const controlled = createControlledRuntime();
    const completion = Object.freeze({ kind: "stopped" as const });

    const returned = controlled.runtime.start();
    controlled.deferred.resolve(completion);
    await returned;
    await flushPromises();

    expect(await returned).toBe(completion);
    expect(controlled.logger.info).toHaveBeenLastCalledWith(
      {
        event: "service_availability_reconciliation_scheduler_stopped",
      },
      "Service availability reconciliation scheduler stopped",
    );
    expect(controlled.requestShutdown).not.toHaveBeenCalled();
    expect(controlled.setFailureExitCode).not.toHaveBeenCalled();
  });

  it.each([
    ["incomplete", "scheduler_incomplete"],
    ["conflict", "scheduler_conflict"],
  ] as const)(
    "safely observes %s and requests application shutdown",
    async (outcome, reasonKind) => {
      const controlled = createControlledRuntime();
      const completion = createTerminalCompletion(outcome);

      void controlled.runtime.start();
      controlled.deferred.resolve(completion);
      await flushPromises();

      expect(controlled.logger.error).toHaveBeenCalledExactlyOnceWith(
        {
          event: "service_availability_reconciliation_scheduler_terminated",
          outcome,
        },
        "Service availability reconciliation scheduler terminated",
      );
      expect(JSON.stringify(controlled.logger.error.mock.calls)).not.toContain(
        "sensitive-service",
      );
      expect(controlled.setFailureExitCode).toHaveBeenCalledOnce();
      expect(controlled.requestShutdown).toHaveBeenCalledExactlyOnceWith({
        kind: reasonKind,
      });
      expect(
        Object.isFrozen(controlled.requestShutdown.mock.calls[0]?.[0]),
      ).toBe(true);
      expect(controlled.loopStart).toHaveBeenCalledOnce();
    },
  );

  it("logs only the safe error type for a failed completion", async () => {
    const controlled = createControlledRuntime();
    const error = new TypeError("secret at /private/scheduler");
    const completion = Object.freeze({ kind: "failed" as const, error });

    void controlled.runtime.start();
    controlled.deferred.resolve(completion);
    await flushPromises();

    expect(controlled.logger.error).toHaveBeenCalledExactlyOnceWith(
      {
        event: "service_availability_reconciliation_scheduler_terminated",
        outcome: "failed",
        errorType: "TypeError",
      },
      "Service availability reconciliation scheduler terminated",
    );
    expect(JSON.stringify(controlled.logger.error.mock.calls)).not.toContain(
      "secret",
    );
    expect(JSON.stringify(controlled.logger.error.mock.calls)).not.toContain(
      "/private",
    );
    expect(controlled.setFailureExitCode).toHaveBeenCalledOnce();
    expect(controlled.requestShutdown).toHaveBeenCalledExactlyOnceWith({
      kind: "scheduler_failed",
    });
  });

  it("safely handles an unexpected shutdown-observer rejection without retry", async () => {
    const shutdownError = new RangeError("sensitive shutdown failure");
    const controlled = createControlledRuntime({
      requestShutdown: vi.fn(() => Promise.reject(shutdownError)),
    });

    void controlled.runtime.start();
    controlled.deferred.resolve(createTerminalCompletion("conflict"));
    await flushPromises();

    expect(controlled.requestShutdown).toHaveBeenCalledOnce();
    expect(controlled.setFailureExitCode).toHaveBeenCalledOnce();
    expect(controlled.logger.error).toHaveBeenLastCalledWith(
      {
        event: "service_availability_reconciliation_scheduler_observer_failed",
        errorType: "RangeError",
      },
      "Service availability reconciliation scheduler observer failed",
    );
    expect(JSON.stringify(controlled.logger.error.mock.calls)).not.toContain(
      "sensitive",
    );
  });
});

function createControlledRuntime(
  overrides: {
    readonly requestShutdown?: ReturnType<typeof vi.fn<RequestShutdown>>;
  } = {},
) {
  const deferred =
    createDeferred<ServiceAvailabilityReconciliationSchedulerLoopCompletion>();
  const loopStart = vi.fn(() => deferred.promise);
  const loopStop = vi.fn(() => deferred.promise);
  const schedulerLoop = {
    start: loopStart,
    stop: loopStop,
  } as unknown as ServiceAvailabilityReconciliationSchedulerLoop;
  const requestShutdown =
    overrides.requestShutdown ??
    vi.fn<RequestShutdown>(() => Promise.resolve());
  const logger = {
    info: vi.fn(),
    error: vi.fn(),
  };
  const setFailureExitCode = vi.fn();
  const runtime = new ServiceAvailabilityReconciliationSchedulerRuntime(
    schedulerLoop,
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

function createTerminalCompletion(
  kind: "incomplete" | "conflict",
): ServiceAvailabilityReconciliationSchedulerLoopCompletion {
  return Object.freeze({
    kind,
    cycleResult: Object.freeze({
      kind,
      cursor: null,
      report: Object.freeze([
        Object.freeze({
          kind: "failed",
          serviceId: "sensitive-service",
          error: new Error("sensitive report error"),
        }),
      ]),
    }),
  }) as ServiceAvailabilityReconciliationSchedulerLoopCompletion;
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
