import { describe, expect, it } from "vitest";

import {
  DOCKER_CONTAINER_HEALTH_STATES,
  isDockerContainerHealthState,
} from "../../../src/service-management/domain/docker-container-health-state.js";

describe("DockerContainerHealthState", () => {
  it("defines the expected health states", () => {
    expect(DOCKER_CONTAINER_HEALTH_STATES).toEqual([
      "not_configured",
      "starting",
      "healthy",
      "unhealthy",
      "unknown",
    ]);
  });

  it("validates known health states", () => {
    expect(isDockerContainerHealthState("not_configured")).toBe(true);
    expect(isDockerContainerHealthState("starting")).toBe(true);
    expect(isDockerContainerHealthState("healthy")).toBe(true);
    expect(isDockerContainerHealthState("unhealthy")).toBe(true);
    expect(isDockerContainerHealthState("unknown")).toBe(true);
  });

  it("rejects unknown health states", () => {
    expect(isDockerContainerHealthState("none")).toBe(false);
    expect(isDockerContainerHealthState("HEALTHY")).toBe(false);
    expect(isDockerContainerHealthState("")).toBe(false);
    expect(isDockerContainerHealthState("some-future-state")).toBe(false);
  });
});
