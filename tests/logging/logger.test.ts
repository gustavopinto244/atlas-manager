import { Writable } from "node:stream";

import { describe, expect, it } from "vitest";

import {
  createLogger,
  logHttpServerStarted,
  logServiceAvailabilityReconciliationSchedulerStarted,
  logServiceAvailabilityReconciliationSchedulerStopped,
  logServiceAvailabilityReconciliationSchedulerTerminated,
} from "../../src/logging/logger.js";

describe("application logger", () => {
  it("uses the configured log level", () => {
    const destination = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });

    expect(createLogger("debug", destination).level).toBe("debug");
  });

  it("writes a structured HTTP server startup event", () => {
    const output: string[] = [];
    const destination = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        output.push(chunk.toString());
        callback();
      },
    });
    const logger = createLogger("info", destination);

    logHttpServerStarted(logger, {
      host: "127.0.0.1",
      port: 3000,
    });

    expect(output).toHaveLength(1);
    expect(JSON.parse(output[0] ?? "")).toMatchObject({
      level: 30,
      event: "http_server_started",
      host: "127.0.0.1",
      port: 3000,
      msg: "HTTP server started",
    });
  });

  it("writes safe structured scheduler lifecycle events", () => {
    const output: string[] = [];
    const destination = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        output.push(chunk.toString());
        callback();
      },
    });
    const logger = createLogger("info", destination);

    logServiceAvailabilityReconciliationSchedulerStarted(logger);
    logServiceAvailabilityReconciliationSchedulerStopped(logger);
    logServiceAvailabilityReconciliationSchedulerTerminated(logger, {
      outcome: "failed",
      errorType: "TypeError",
    });

    const entries = output.map((entry): unknown => JSON.parse(entry));

    expect(entries).toEqual([
      expect.objectContaining({
        level: 30,
        event: "service_availability_reconciliation_scheduler_started",
        msg: "Service availability reconciliation scheduler started",
      }),
      expect.objectContaining({
        level: 30,
        event: "service_availability_reconciliation_scheduler_stopped",
        msg: "Service availability reconciliation scheduler stopped",
      }),
      expect.objectContaining({
        level: 50,
        event: "service_availability_reconciliation_scheduler_terminated",
        outcome: "failed",
        errorType: "TypeError",
        msg: "Service availability reconciliation scheduler terminated",
      }),
    ]);
    expect(output.join("")).not.toContain("message");
    expect(output.join("")).not.toContain("stack");
    expect(output.join("")).not.toContain("cursor");
    expect(output.join("")).not.toContain("report");
  });
});
