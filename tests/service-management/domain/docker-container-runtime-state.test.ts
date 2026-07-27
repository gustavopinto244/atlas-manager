import { describe, expect, it } from "vitest";

import { mapDockerStateToRuntimeState } from "../../../src/service-management/domain/docker-container-runtime-state.js";

describe("mapDockerStateToRuntimeState", () => {
  it("maps running to running", () => {
    expect(mapDockerStateToRuntimeState("running")).toBe("running");
  });

  it("maps exited to stopped", () => {
    expect(mapDockerStateToRuntimeState("exited")).toBe("stopped");
  });

  it("maps created to stopped", () => {
    expect(mapDockerStateToRuntimeState("created")).toBe("stopped");
  });

  it("maps dead to failed", () => {
    expect(mapDockerStateToRuntimeState("dead")).toBe("failed");
  });

  it("maps paused to unknown", () => {
    expect(mapDockerStateToRuntimeState("paused")).toBe("unknown");
  });

  it("maps restarting to unknown", () => {
    expect(mapDockerStateToRuntimeState("restarting")).toBe("unknown");
  });

  it("maps removing to unknown", () => {
    expect(mapDockerStateToRuntimeState("removing")).toBe("unknown");
  });

  it("maps unknown states to unknown", () => {
    expect(mapDockerStateToRuntimeState("some-future-state")).toBe("unknown");
  });

  it("is case-insensitive", () => {
    expect(mapDockerStateToRuntimeState("RUNNING")).toBe("running");
    expect(mapDockerStateToRuntimeState("Running")).toBe("running");
    expect(mapDockerStateToRuntimeState("EXITED")).toBe("stopped");
  });
});
