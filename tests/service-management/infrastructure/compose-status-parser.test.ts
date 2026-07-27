import { describe, expect, it } from "vitest";

import {
  parseComposeProjectStatus,
  ComposeStatusParserError,
} from "../../../src/service-management/infrastructure/compose-status-parser.js";

describe("parseComposeProjectStatus", () => {
  it("parses all running services", () => {
    const output = JSON.stringify([
      {
        Name: "api",
        State: "running",
        ExitCode: 0,
      },
      {
        Name: "db",
        State: "running",
        ExitCode: 0,
      },
    ]);

    const result = parseComposeProjectStatus(output);

    expect(result.runtimeState).toBe("running");
    expect(result.services).toHaveLength(2);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.services)).toBe(true);
  });

  it("parses all stopped services", () => {
    const output = JSON.stringify([
      {
        Name: "api",
        State: "exited",
        ExitCode: 0,
      },
    ]);

    const result = parseComposeProjectStatus(output);

    expect(result.runtimeState).toBe("stopped");
    expect(result.services[0]?.runtimeState).toBe("stopped");
  });

  it("parses mixed states as unknown", () => {
    const output = JSON.stringify([
      {
        Name: "api",
        State: "running",
        ExitCode: 0,
      },
      {
        Name: "db",
        State: "exited",
        ExitCode: 0,
      },
    ]);

    const result = parseComposeProjectStatus(output);

    expect(result.runtimeState).toBe("unknown");
  });

  it("maps dead service to failed aggregate", () => {
    const output = JSON.stringify([
      {
        Name: "api",
        State: "running",
        ExitCode: 0,
      },
      {
        Name: "db",
        State: "dead",
        ExitCode: 137,
      },
    ]);

    const result = parseComposeProjectStatus(output);

    expect(result.runtimeState).toBe("failed");
  });

  it("maps non-zero exit code to failed", () => {
    const output = JSON.stringify([
      {
        Name: "api",
        State: "exited",
        ExitCode: 1,
      },
    ]);

    const result = parseComposeProjectStatus(output);

    expect(result.services[0]?.runtimeState).toBe("failed");
    expect(result.services[0]?.exitCode).toBe(1);
  });

  it("parses health states", () => {
    const output = JSON.stringify([
      {
        Name: "api",
        State: "running",
        Health: "healthy",
        ExitCode: 0,
      },
    ]);

    const result = parseComposeProjectStatus(output);

    expect(result.services[0]?.healthState).toBe("healthy");
  });

  it("maps unhealthy health state", () => {
    const output = JSON.stringify([
      {
        Name: "api",
        State: "running",
        Health: "unhealthy",
        ExitCode: 0,
      },
    ]);

    const result = parseComposeProjectStatus(output);

    expect(result.services[0]?.healthState).toBe("unhealthy");
  });

  it("maps starting health state", () => {
    const output = JSON.stringify([
      {
        Name: "api",
        State: "running",
        Health: "starting",
        ExitCode: 0,
      },
    ]);

    const result = parseComposeProjectStatus(output);

    expect(result.services[0]?.healthState).toBe("starting");
  });

  it("rejects empty output", () => {
    expect(() => parseComposeProjectStatus("")).toThrowError(
      ComposeStatusParserError,
    );
  });

  it("rejects empty array", () => {
    expect(() => parseComposeProjectStatus("[]")).toThrowError(
      ComposeStatusParserError,
    );
  });

  it("rejects invalid JSON", () => {
    expect(() => parseComposeProjectStatus("invalid json")).toThrowError(
      ComposeStatusParserError,
    );
  });

  it("rejects non-array JSON", () => {
    expect(() => parseComposeProjectStatus('{"not": "array"}')).toThrowError(
      ComposeStatusParserError,
    );
  });

  it("rejects duplicate service names", () => {
    const output = JSON.stringify([
      { Name: "api", State: "running", ExitCode: 0 },
      { Name: "api", State: "exited", ExitCode: 0 },
    ]);

    expect(() => parseComposeProjectStatus(output)).toThrowError(
      ComposeStatusParserError,
    );
  });

  it("rejects missing Name field", () => {
    const output = JSON.stringify([{ State: "running", ExitCode: 0 }]);

    expect(() => parseComposeProjectStatus(output)).toThrowError(
      ComposeStatusParserError,
    );
  });

  it("rejects missing State field", () => {
    const output = JSON.stringify([{ Name: "api", ExitCode: 0 }]);

    expect(() => parseComposeProjectStatus(output)).toThrowError(
      ComposeStatusParserError,
    );
  });

  it("maps paused service to unknown", () => {
    const output = JSON.stringify([
      { Name: "api", State: "paused", ExitCode: 0 },
    ]);

    const result = parseComposeProjectStatus(output);

    expect(result.services[0]?.runtimeState).toBe("unknown");
  });
});
