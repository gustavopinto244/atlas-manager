import type { DockerContainerDetails } from "../domain/docker-container-details.js";
import { createDockerContainerDetails } from "../domain/docker-container-details.js";
import type { DockerContainerResourceUsage } from "../domain/docker-container-resource-usage.js";
import { createUnavailableDockerContainerResourceUsage } from "../domain/docker-container-resource-usage.js";
import type { RegisteredService } from "../domain/registered-service.js";
import type { DockerContainerInspectExecutor } from "./docker-container-inspect-executor.js";
import type { DockerContainerStatsExecutor } from "./docker-container-stats-executor.js";
import { parseDockerInspectOutput } from "./docker-inspect-output-parser.js";
import { parseDockerStatsOutput } from "./docker-stats-output-parser.js";

export class DockerContainerDetailsReaderError extends Error {
  public constructor(
    public readonly code:
      | "unsupported_adapter"
      | "inspection_timeout"
      | "inspection_failed"
      | "inspection_output_invalid"
      | "stats_timeout"
      | "stats_failed"
      | "stats_output_invalid"
      | "target_not_found"
      | "invalid_uptime",
    message?: string,
  ) {
    super(message ?? `Docker container details reader failed: ${code}`);
    this.name = "DockerContainerDetailsReaderError";
    Object.freeze(this);
  }
}

export interface DockerContainerDetailsReaderDependencies {
  readonly clock: {
    now(): Date;
  };
}

export class DockerContainerDetailsReader {
  public constructor(
    private readonly inspectExecutor: DockerContainerInspectExecutor,
    private readonly statsExecutor: DockerContainerStatsExecutor,
    private readonly dependencies: DockerContainerDetailsReaderDependencies,
  ) {
    Object.freeze(this);
  }

  public async readDetails(
    service: RegisteredService,
  ): Promise<DockerContainerDetails> {
    if (service.managementAdapter !== "docker") {
      throw new DockerContainerDetailsReaderError("unsupported_adapter");
    }

    const observedAt = this.dependencies.clock.now();

    try {
      const inspectOutput = await this.inspectExecutor.execute(
        service.externalResourceId,
      );
      const parsedInspect = parseDockerInspectOutput(inspectOutput);

      let resourceUsage: DockerContainerResourceUsage;

      if (parsedInspect.runtimeState === "running") {
        try {
          const statsOutput = await this.statsExecutor.execute(
            service.externalResourceId,
          );
          resourceUsage = parseDockerStatsOutput(statsOutput);
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);

          if (errorMessage.includes("stats_timeout")) {
            throw new DockerContainerDetailsReaderError("stats_timeout");
          }

          if (
            errorMessage.includes("invalid_json") ||
            errorMessage.includes("invalid_cpu") ||
            errorMessage.includes("invalid_memory") ||
            errorMessage.includes("invalid_network") ||
            errorMessage.includes("invalid_block") ||
            errorMessage.includes("invalid_pids") ||
            errorMessage.includes("missing_field")
          ) {
            throw new DockerContainerDetailsReaderError("stats_output_invalid");
          }

          throw new DockerContainerDetailsReaderError("stats_failed");
        }
      } else {
        resourceUsage = createUnavailableDockerContainerResourceUsage(
          "container_not_running",
        );
      }

      let uptimeSeconds: number | null = null;
      if (
        parsedInspect.runtimeState === "running" &&
        parsedInspect.startedAt !== null
      ) {
        const startedAtDate = new Date(parsedInspect.startedAt);
        const observedAtTime = observedAt.getTime();
        const startedAtTime = startedAtDate.getTime();

        if (startedAtTime > observedAtTime) {
          throw new DockerContainerDetailsReaderError("invalid_uptime");
        }

        uptimeSeconds = Math.floor((observedAtTime - startedAtTime) / 1000);
      }

      return createDockerContainerDetails({
        serviceId: service.id,
        runtimeState: parsedInspect.runtimeState,
        healthState: parsedInspect.healthState,
        observedAt: observedAt.toISOString(),
        startedAt: parsedInspect.startedAt,
        uptimeSeconds,
        image: parsedInspect.image,
        resourceUsage,
      });
    } catch (error) {
      if (error instanceof DockerContainerDetailsReaderError) {
        throw error;
      }

      const errorMessage =
        error instanceof Error ? error.message : String(error);

      if (errorMessage.includes("inspection_timeout")) {
        throw new DockerContainerDetailsReaderError("inspection_timeout");
      }

      if (errorMessage.includes("target_not_found")) {
        throw new DockerContainerDetailsReaderError("target_not_found");
      }

      if (
        errorMessage.includes("invalid_json") ||
        errorMessage.includes("invalid_array") ||
        errorMessage.includes("empty_array") ||
        errorMessage.includes("multiple_entries") ||
        errorMessage.includes("missing_state") ||
        errorMessage.includes("invalid_timestamp") ||
        errorMessage.includes("invalid_image")
      ) {
        throw new DockerContainerDetailsReaderError(
          "inspection_output_invalid",
        );
      }

      throw new DockerContainerDetailsReaderError("inspection_failed");
    }
  }
}
