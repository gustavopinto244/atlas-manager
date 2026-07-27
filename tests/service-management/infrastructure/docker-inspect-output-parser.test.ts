import { describe, expect, it } from "vitest";

import {
  parseDockerInspectOutput,
  DockerInspectOutputParserError,
} from "../../../src/service-management/infrastructure/docker-inspect-output-parser.js";

describe("parseDockerInspectOutput", () => {
  it("parses a running container with healthy status", () => {
    const output = JSON.stringify([
      {
        State: {
          Status: "running",
          Health: {
            Status: "healthy",
          },
        },
        Config: {
          Image: "nginx:latest",
        },
      },
    ]);

    const result = parseDockerInspectOutput(output);

    expect(result).toEqual({
      runtimeState: "running",
      healthState: "healthy",
      image: "nginx:latest",
      startedAt: null,
    });
  });

  it("parses a stopped container", () => {
    const output = JSON.stringify([
      {
        State: {
          Status: "exited",
        },
        Config: {
          Image: "postgres:15",
        },
      },
    ]);

    const result = parseDockerInspectOutput(output);

    expect(result).toEqual({
      runtimeState: "stopped",
      healthState: "not_configured",
      image: "postgres:15",
      startedAt: null,
    });
  });

  it("parses a container with starting health status", () => {
    const output = JSON.stringify([
      {
        State: {
          Status: "running",
          Health: {
            Status: "starting",
          },
        },
        Config: {
          Image: "redis:7",
        },
      },
    ]);

    const result = parseDockerInspectOutput(output);

    expect(result.healthState).toBe("starting");
  });

  it("parses a container with unhealthy status", () => {
    const output = JSON.stringify([
      {
        State: {
          Status: "running",
          Health: {
            Status: "unhealthy",
          },
        },
        Config: {
          Image: "mysql:8",
        },
      },
    ]);

    const result = parseDockerInspectOutput(output);

    expect(result.healthState).toBe("unhealthy");
  });

  it("maps dead state to failed runtime state", () => {
    const output = JSON.stringify([
      {
        State: {
          Status: "dead",
        },
        Config: {
          Image: "app:latest",
        },
      },
    ]);

    const result = parseDockerInspectOutput(output);

    expect(result.runtimeState).toBe("failed");
  });

  it("maps unknown states to unknown runtime state", () => {
    const output = JSON.stringify([
      {
        State: {
          Status: "paused",
        },
        Config: {
          Image: "app:latest",
        },
      },
    ]);

    const result = parseDockerInspectOutput(output);

    expect(result.runtimeState).toBe("unknown");
  });

  it("throws error for invalid JSON", () => {
    expect(() => parseDockerInspectOutput("invalid json")).toThrowError(
      DockerInspectOutputParserError,
    );
  });

  it("throws error for empty array", () => {
    expect(() => parseDockerInspectOutput("[]")).toThrowError(
      DockerInspectOutputParserError,
    );
  });

  it("throws error for multiple containers", () => {
    const output = JSON.stringify([
      {
        State: { Status: "running" },
        Config: { Image: "app:latest" },
      },
      {
        State: { Status: "running" },
        Config: { Image: "app:latest" },
      },
    ]);

    expect(() => parseDockerInspectOutput(output)).toThrowError(
      DockerInspectOutputParserError,
    );
  });

  it("throws error for missing state", () => {
    const output = JSON.stringify([
      {
        Config: { Image: "app:latest" },
      },
    ]);

    expect(() => parseDockerInspectOutput(output)).toThrowError(
      DockerInspectOutputParserError,
    );
  });

  it("throws error for missing image", () => {
    const output = JSON.stringify([
      {
        State: { Status: "running" },
      },
    ]);

    expect(() => parseDockerInspectOutput(output)).toThrowError(
      DockerInspectOutputParserError,
    );
  });

  it("parses startedAt timestamp when present", () => {
    const output = JSON.stringify([
      {
        State: {
          Status: "running",
          StartedAt: "2026-01-01T10:00:00.000Z",
        },
        Config: {
          Image: "app:latest",
        },
      },
    ]);

    const result = parseDockerInspectOutput(output);

    expect(result.startedAt).toBe("2026-01-01T10:00:00.000Z");
  });

  it("returns null for Docker zero-value timestamp", () => {
    const output = JSON.stringify([
      {
        State: {
          Status: "running",
          StartedAt: "0001-01-01T00:00:00Z",
        },
        Config: {
          Image: "app:latest",
        },
      },
    ]);

    const result = parseDockerInspectOutput(output);

    expect(result.startedAt).toBeNull();
  });
});
