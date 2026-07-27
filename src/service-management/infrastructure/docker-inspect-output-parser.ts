import type { DockerContainerHealthState } from "../domain/docker-container-health-state.js";
import type { DockerContainerRuntimeState } from "../domain/docker-container-runtime-state.js";
import { mapDockerStateToRuntimeState } from "../domain/docker-container-runtime-state.js";

export interface DockerInspectOutput {
  readonly runtimeState: DockerContainerRuntimeState;
  readonly healthState: DockerContainerHealthState;
  readonly image: string;
  readonly startedAt: string | null;
}

export class DockerInspectOutputParserError extends Error {
  public constructor(
    public readonly code:
      | "invalid_json"
      | "invalid_array_shape"
      | "empty_array"
      | "multiple_entries"
      | "missing_state"
      | "invalid_timestamp"
      | "invalid_image",
    message?: string,
  ) {
    super(message ?? `Docker inspect output parser failed: ${code}`);
    this.name = "DockerInspectOutputParserError";
    Object.freeze(this);
  }
}

export function parseDockerInspectOutput(output: string): DockerInspectOutput {
  if (!output || output.trim() === "") {
    throw new DockerInspectOutputParserError("invalid_json");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new DockerInspectOutputParserError("invalid_json");
  }

  if (!Array.isArray(parsed)) {
    throw new DockerInspectOutputParserError("invalid_array_shape");
  }

  if (parsed.length === 0) {
    throw new DockerInspectOutputParserError("empty_array");
  }

  if (parsed.length > 1) {
    throw new DockerInspectOutputParserError("multiple_entries");
  }

  const container: unknown = parsed[0];

  if (!isRecord(container)) {
    throw new DockerInspectOutputParserError("invalid_array_shape");
  }

  if (!isRecord(container.State)) {
    throw new DockerInspectOutputParserError("missing_state");
  }

  if (typeof container.State.Status !== "string") {
    throw new DockerInspectOutputParserError("missing_state");
  }

  const runtimeState = mapDockerStateToRuntimeState(container.State.Status);

  let healthState: DockerContainerHealthState = "not_configured";
  if (isRecord(container.State.Health)) {
    if (typeof container.State.Health.Status === "string") {
      const healthStatus = container.State.Health.Status;
      if (
        healthStatus === "none" ||
        healthStatus === "" ||
        healthStatus === null
      ) {
        healthState = "not_configured";
      } else if (healthStatus === "starting") {
        healthState = "starting";
      } else if (healthStatus === "healthy") {
        healthState = "healthy";
      } else if (healthStatus === "unhealthy") {
        healthState = "unhealthy";
      } else {
        healthState = "unknown";
      }
    }
  }

  const config = container.Config as Record<string, unknown> | undefined;
  if (!config || typeof config.Image !== "string") {
    throw new DockerInspectOutputParserError("invalid_image");
  }
  const image = config.Image;
  if (image.trim() === "") {
    throw new DockerInspectOutputParserError("invalid_image");
  }

  let startedAt: string | null = null;
  if (
    typeof container.State.StartedAt === "string" &&
    container.State.StartedAt !== ""
  ) {
    const startedAtValue = container.State.StartedAt;
    if (
      startedAtValue === "0001-01-01T00:00:00Z" ||
      startedAtValue === "0001-01-01T00:00:00.000000000Z"
    ) {
      startedAt = null;
    } else {
      const parsedDate = new Date(startedAtValue);
      if (Number.isNaN(parsedDate.getTime())) {
        throw new DockerInspectOutputParserError("invalid_timestamp");
      }
      startedAt = parsedDate.toISOString();
    }
  }

  return Object.freeze({
    runtimeState,
    healthState,
    image,
    startedAt,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
