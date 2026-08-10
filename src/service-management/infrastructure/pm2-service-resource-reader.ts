import type { ServiceResourceReader } from "../application/ports/service-resource-reader.js";
import type { RegisteredService } from "../domain/registered-service.js";
import type {
  ServiceCpuObservation,
  ServiceMemoryObservation,
  ServiceResourceObservation,
} from "../domain/service-resource-observation.js";
import {
  createAvailableServiceResourceObservation,
  createUnavailableServiceResourceObservation,
} from "../domain/service-resource-observation.js";
import type { Pm2ProcessListExecutor } from "./pm2-process-list-executor.js";
import type { Clock } from "../application/ports/clock.js";

// Reuses the same bounded pm2 jlist executor and process-list output the
// status reader already trusts; PM2 already reports per-process CPU and
// memory in that output ("monit"), so no additional process execution or
// new security boundary is introduced.
export class Pm2ServiceResourceReader implements ServiceResourceReader {
  public constructor(
    private readonly executor: Pm2ProcessListExecutor,
    private readonly clock: Clock,
  ) {
    Object.freeze(this);
  }

  public async read(
    service: RegisteredService,
  ): Promise<ServiceResourceObservation> {
    const observedAt = this.clock.now().toISOString();
    if (service.managementAdapter !== "pm2")
      return createUnavailableServiceResourceObservation(
        observedAt,
        "unsupported",
      );

    let output: string;
    try {
      output = await this.executor.execute();
    } catch {
      return createUnavailableServiceResourceObservation(
        observedAt,
        "unavailable",
      );
    }

    let processes: unknown;
    try {
      processes = JSON.parse(output);
    } catch {
      return createUnavailableServiceResourceObservation(
        observedAt,
        "invalid_response",
      );
    }
    if (!Array.isArray(processes))
      return createUnavailableServiceResourceObservation(
        observedAt,
        "invalid_response",
      );

    const matches = processes.filter(
      (entry) =>
        isRecord(entry) &&
        typeof entry["name"] === "string" &&
        entry["name"] === service.externalResourceId,
    );
    if (matches.length !== 1)
      return createUnavailableServiceResourceObservation(
        observedAt,
        "unavailable",
      );

    const process = matches[0] as Record<string, unknown>;
    const monit = process["monit"];
    const pm2Env = process["pm2_env"];

    const cpu: ServiceCpuObservation =
      isRecord(monit) &&
      typeof monit["cpu"] === "number" &&
      Number.isFinite(monit["cpu"]) &&
      monit["cpu"] >= 0
        ? { outcome: "available", usagePercent: monit["cpu"] }
        : { outcome: "unavailable", reason: "invalid_response" };

    const memory: ServiceMemoryObservation =
      isRecord(monit) &&
      typeof monit["memory"] === "number" &&
      Number.isFinite(monit["memory"]) &&
      monit["memory"] >= 0
        ? {
            outcome: "available",
            usageBytes: monit["memory"],
            limitBytes: null,
            usagePercent: null,
          }
        : { outcome: "unavailable", reason: "invalid_response" };

    const uptimeSeconds = computeUptimeSeconds(
      isRecord(pm2Env) ? pm2Env["pm_uptime"] : undefined,
      this.clock.now(),
    );

    return createAvailableServiceResourceObservation({
      observedAt,
      cpu,
      memory,
      uptimeSeconds,
    });
  }
}

function computeUptimeSeconds(pmUptime: unknown, now: Date): number | null {
  if (typeof pmUptime !== "number" || !Number.isFinite(pmUptime)) return null;
  const seconds = Math.floor((now.getTime() - pmUptime) / 1000);
  return seconds >= 0 ? seconds : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
