import type { ServiceResourceReader } from "../application/ports/service-resource-reader.js";
import type { RegisteredService } from "../domain/registered-service.js";
import type { ServiceResourceObservation } from "../domain/service-resource-observation.js";
import {
  createAvailableServiceResourceObservation,
  createUnavailableServiceResourceObservation,
} from "../domain/service-resource-observation.js";
import type { Clock } from "../application/ports/clock.js";
import type { DockerContainerStatsExecutor } from "./docker-container-stats-executor.js";
import { parseDockerStatsOutput } from "./docker-stats-output-parser.js";
import { DockerStatsOutputParserError } from "./docker-stats-output-parser.js";
import type { DockerContainerInspectExecutor } from "./docker-container-inspect-executor.js";
import { parseDockerInspectOutput } from "./docker-inspect-output-parser.js";

// Reuses the existing bounded, no-shell stats and inspect executors; this
// reader adds no new process execution or security boundary.
export class DockerServiceResourceReader implements ServiceResourceReader {
  public constructor(
    private readonly statsExecutor: DockerContainerStatsExecutor,
    private readonly inspectExecutor: DockerContainerInspectExecutor,
    private readonly clock: Clock,
  ) {
    Object.freeze(this);
  }

  public async read(
    service: RegisteredService,
  ): Promise<ServiceResourceObservation> {
    const observedAt = this.clock.now().toISOString();
    if (service.managementAdapter !== "docker")
      return createUnavailableServiceResourceObservation(
        observedAt,
        "unsupported",
      );

    const usage = await this.readUsage(service.externalResourceId);
    if (usage.outcome === "unavailable")
      return createUnavailableServiceResourceObservation(
        observedAt,
        usage.reason,
      );

    const uptimeSeconds = await this.readUptimeSeconds(
      service.externalResourceId,
    );

    return createAvailableServiceResourceObservation({
      observedAt,
      cpu: { outcome: "available", usagePercent: usage.cpuPercent },
      memory: {
        outcome: "available",
        usageBytes: usage.memoryUsageBytes,
        limitBytes: usage.memoryLimitBytes > 0 ? usage.memoryLimitBytes : null,
        usagePercent:
          usage.memoryLimitBytes > 0
            ? (usage.memoryUsageBytes / usage.memoryLimitBytes) * 100
            : null,
      },
      uptimeSeconds,
    });
  }

  private async readUsage(target: string): Promise<
    | Readonly<{
        outcome: "available";
        cpuPercent: number;
        memoryUsageBytes: number;
        memoryLimitBytes: number;
      }>
    | Readonly<{
        outcome: "unavailable";
        reason:
          "unavailable" | "timeout" | "permission_denied" | "invalid_response";
      }>
  > {
    let output: string;
    try {
      output = await this.statsExecutor.execute(target);
    } catch (error) {
      return { outcome: "unavailable", reason: mapExecutorError(error) };
    }
    try {
      const parsed = parseDockerStatsOutput(output);
      if (parsed.kind !== "available")
        return { outcome: "unavailable", reason: "unavailable" };
      return {
        outcome: "available",
        cpuPercent: parsed.cpuPercent,
        memoryUsageBytes: parsed.memoryUsageBytes,
        memoryLimitBytes: parsed.memoryLimitBytes,
      };
    } catch (error) {
      if (error instanceof DockerStatsOutputParserError)
        return { outcome: "unavailable", reason: "invalid_response" };
      return { outcome: "unavailable", reason: "unavailable" };
    }
  }

  private async readUptimeSeconds(target: string): Promise<number | null> {
    try {
      const output = await this.inspectExecutor.execute(target);
      const parsed = parseDockerInspectOutput(output);
      if (parsed.startedAt === null) return null;
      const startedAtMs = Date.parse(parsed.startedAt);
      if (Number.isNaN(startedAtMs)) return null;
      const seconds = Math.floor(
        (this.clock.now().getTime() - startedAtMs) / 1000,
      );
      return seconds >= 0 ? seconds : null;
    } catch {
      return null;
    }
  }
}

function mapExecutorError(
  error: unknown,
): "unavailable" | "timeout" | "permission_denied" {
  if (!(error instanceof Error) || !("code" in error)) return "unavailable";
  const code = (error as Error & { code?: unknown }).code;
  if (code === "stats_timeout") return "timeout";
  if (code === "docker_permission_denied") return "permission_denied";
  return "unavailable";
}
