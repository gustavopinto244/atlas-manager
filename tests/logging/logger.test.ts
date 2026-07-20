import { Writable } from "node:stream";

import { describe, expect, it } from "vitest";

import {
  createLogger,
  logHttpServerStarted,
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
});
