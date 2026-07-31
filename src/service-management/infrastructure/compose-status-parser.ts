import type { ComposeProjectService } from "../domain/compose-project.js";
import {
  calculateComposeAggregateHealthState,
  calculateComposeAggregateRuntimeState,
} from "../domain/compose-project.js";
import type { ServiceRuntimeState } from "../domain/registered-service-status.js";
import { mapDockerStateToRuntimeState } from "../domain/docker-container-runtime-state.js";

export class ComposeStatusParserError extends Error {
  public constructor(
    public readonly code:
      | "invalid_json"
      | "invalid_format"
      | "empty_result"
      | "missing_fields"
      | "invalid_state"
      | "invalid_exit_code",
    message?: string,
  ) {
    super(message ?? `Compose status parser failed: ${code}`);
    this.name = "ComposeStatusParserError";
    Object.freeze(this);
  }
}

export interface ParsedComposeProjectStatus {
  readonly services: readonly ComposeProjectService[];
  readonly runtimeState: ServiceRuntimeState;
  readonly healthState: ReturnType<typeof calculateComposeAggregateHealthState>;
}

export function parseComposeProjectStatus(
  output: string,
): ParsedComposeProjectStatus {
  if (!output || output.trim() === "") {
    throw new ComposeStatusParserError("empty_result");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new ComposeStatusParserError("invalid_json");
  }

  if (!Array.isArray(parsed)) {
    throw new ComposeStatusParserError("invalid_format");
  }

  if (parsed.length === 0) {
    throw new ComposeStatusParserError("empty_result");
  }

  const services: ComposeProjectService[] = [];
  const serviceNames = new Set<string>();

  for (const entry of parsed) {
    if (!isRecord(entry)) {
      throw new ComposeStatusParserError("invalid_format");
    }

    const name = getStringField(entry, "Name", "missing_fields");
    const state = getStringField(entry, "State", "missing_fields");

    if (serviceNames.has(name)) {
      throw new ComposeStatusParserError("invalid_format");
    }
    serviceNames.add(name);

    const runtimeState = mapDockerStateToRuntimeState(state);

    let exitCode: number | null = null;
    const exitCodeRaw = entry.ExitCode;
    if (typeof exitCodeRaw === "number") {
      if (Number.isFinite(exitCodeRaw) && Number.isInteger(exitCodeRaw)) {
        exitCode = exitCodeRaw;
      }
    }

    if (exitCode !== null && exitCode !== 0 && runtimeState === "stopped") {
      services.push({
        serviceName: name,
        runtimeState: "failed",
        healthState: "none",
        exitCode,
      });
    } else {
      let healthState: "healthy" | "unhealthy" | "starting" | "none" = "none";
      const healthRaw = entry.Health;
      if (typeof healthRaw === "string") {
        if (healthRaw === "healthy") healthState = "healthy";
        else if (healthRaw === "unhealthy") healthState = "unhealthy";
        else if (healthRaw === "starting") healthState = "starting";
      }

      services.push({
        serviceName: name,
        runtimeState,
        healthState,
        exitCode,
      });
    }
  }

  const runtimeStates = services.map((s) => s.runtimeState);
  const aggregateState = calculateComposeAggregateRuntimeState(runtimeStates);
  const healthState = calculateComposeAggregateHealthState(services);

  return Object.freeze({
    services: Object.freeze(services),
    runtimeState: aggregateState,
    healthState,
  });
}

function getStringField(
  entry: Record<string, unknown>,
  field: string,
  errorCode: "missing_fields",
): string {
  const value = entry[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new ComposeStatusParserError(errorCode);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
