import type { Clock } from "../application/ports/clock.js";
import type {
  ServiceReadinessReader,
  ServiceReadinessResult,
} from "../application/ports/service-readiness-reader.js";
import type { ServiceStatusReader } from "../application/ports/service-status-reader.js";
import type { RegisteredService } from "../domain/registered-service.js";
import type { DockerContainerInspectExecutor } from "./docker-container-inspect-executor.js";
import type { DockerComposeProjectStatusExecutor } from "./docker-compose-executors.js";
import { parseComposeProjectStatus } from "./compose-status-parser.js";
import { parseDockerInspectOutput } from "./docker-inspect-output-parser.js";

export class RuntimeReadinessReader implements ServiceReadinessReader {
  public constructor(
    private readonly statusReader: ServiceStatusReader,
    private readonly clock: Clock,
  ) {
    Object.freeze(this);
  }

  public async check(
    service: RegisteredService,
  ): Promise<ServiceReadinessResult> {
    const state = await this.statusReader.read(service);
    return Object.freeze({
      serviceId: service.id,
      observedAt: this.clock.now().toISOString(),
      state: state === "running" ? "ready" : "not_ready",
    });
  }
}

export class DockerHealthReadinessReader implements ServiceReadinessReader {
  public constructor(
    private readonly inspectExecutor: DockerContainerInspectExecutor,
    private readonly clock: Clock,
  ) {
    Object.freeze(this);
  }

  public async check(
    service: RegisteredService,
  ): Promise<ServiceReadinessResult> {
    if (service.managementAdapter !== "docker") {
      throw new Error("Unsupported health readiness adapter");
    }
    const parsed = parseDockerInspectOutput(
      await this.inspectExecutor.execute(service.externalResourceId),
    );
    return Object.freeze({
      serviceId: service.id,
      observedAt: this.clock.now().toISOString(),
      state: parsed.healthState === "healthy" ? "ready" : "not_ready",
    });
  }
}

export class ComposeHealthReadinessReader implements ServiceReadinessReader {
  public constructor(
    private readonly statusExecutor: DockerComposeProjectStatusExecutor,
    private readonly clock: Clock,
  ) {
    Object.freeze(this);
  }

  public async check(
    service: RegisteredService,
  ): Promise<ServiceReadinessResult> {
    if (
      service.managementAdapter !== "docker-compose" ||
      !service.managementConfiguration
    ) {
      throw new Error("Unsupported health readiness adapter");
    }
    const parsed = parseComposeProjectStatus(
      await this.statusExecutor.execute(
        service.externalResourceId,
        service.managementConfiguration.projectDirectory,
        service.managementConfiguration.composeFile,
      ),
    );
    return Object.freeze({
      serviceId: service.id,
      observedAt: this.clock.now().toISOString(),
      state: parsed.healthState === "healthy" ? "ready" : "not_ready",
    });
  }
}

export function createDispatchingReadinessReader(params: {
  runtimeReader: ServiceReadinessReader;
  dockerHealthReader: ServiceReadinessReader;
  composeHealthReader: ServiceReadinessReader;
}): ServiceReadinessReader {
  const mockReadinessReader: ServiceReadinessReader = Object.freeze({
    check(service: RegisteredService): Promise<ServiceReadinessResult> {
      return params.runtimeReader.check(service);
    },
  });

  const runtimeReaders = Object.freeze({
    mock: mockReadinessReader,
    pm2: params.runtimeReader,
    docker: params.runtimeReader,
    "docker-compose": params.runtimeReader,
  });

  return Object.freeze({
    async check(service: RegisteredService): Promise<ServiceReadinessResult> {
      const reader =
        service.readinessPolicy.mode === "health"
          ? service.managementAdapter === "docker"
            ? params.dockerHealthReader
            : service.managementAdapter === "docker-compose"
              ? params.composeHealthReader
              : undefined
          : runtimeReaders[service.managementAdapter];
      if (!reader) {
        throw new Error(
          `No readiness reader for adapter: ${service.managementAdapter}`,
        );
      }
      return reader.check(service);
    },
  });
}

export class NodeServiceReadinessTimer {
  public async sleep(milliseconds: number): Promise<void> {
    if (!Number.isSafeInteger(milliseconds) || milliseconds < 1) {
      throw new Error(`Invalid sleep duration: ${milliseconds}`);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
  }
}
