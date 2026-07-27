import type { RegisteredService } from "../domain/registered-service.js";
import {
  createServiceLogBatch,
  type ServiceLogBatch,
} from "../domain/service-log-batch.js";
import type { ServiceLogReader } from "../application/ports/service-log-reader.js";
import type {
  DockerContainerLogExecutor,
  DockerComposeProjectLogExecutor,
} from "./docker-compose-executors.js";

const MAX_LINE_LENGTH = 4096;
const MAX_TOTAL_LINES = 500;
const MIN_TAIL_LINES = 1;
const MAX_TAIL_LINES = 500;

/* eslint-disable no-control-regex */
const CONTROL_CHAR_REGEX = /[\x00-\x08\x0b\x0c\x0e-\x1f]/g;

const ANSI_REGEX =
  /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-PRZcf-nqry=><]/g;
/* eslint-enable no-control-regex */

export function validateTailLines(tailLines: number): void {
  if (
    !Number.isInteger(tailLines) ||
    tailLines < MIN_TAIL_LINES ||
    tailLines > MAX_TAIL_LINES
  ) {
    throw new Error(
      `tailLines must be between ${MIN_TAIL_LINES} and ${MAX_TAIL_LINES}`,
    );
  }
}

export function normalizeLogOutput(
  serviceId: string,
  stdout: string,
  stderr: string,
): ServiceLogBatch {
  const collectedAt = new Date().toISOString();
  const stdoutLines = normalizeLines(stdout);
  const stderrLines = normalizeLines(stderr);
  const truncated =
    stdoutLines.length > MAX_TOTAL_LINES ||
    stderrLines.length > MAX_TOTAL_LINES;

  return createServiceLogBatch({
    serviceId,
    collectedAt,
    stdoutLines: stdoutLines.slice(0, MAX_TOTAL_LINES),
    stderrLines: stderrLines.slice(0, MAX_TOTAL_LINES),
    truncated,
  });
}

function normalizeLines(input: string): readonly string[] {
  if (!input) return Object.freeze([]);

  const cleaned = input.replace(ANSI_REGEX, "");

  const lines = cleaned
    .split(/\r?\n/)
    .map((line) => {
      const sanitized = line
        .replace(CONTROL_CHAR_REGEX, "")
        .slice(0, MAX_LINE_LENGTH);
      return sanitized;
    })
    .filter((line) => line.length > 0);

  return Object.freeze(lines);
}

export class DockerContainerLogReader implements ServiceLogReader {
  public constructor(private readonly logExecutor: DockerContainerLogExecutor) {
    Object.freeze(this);
  }

  public async readLogs(
    service: RegisteredService,
    tailLines: number,
  ): Promise<ServiceLogBatch> {
    validateTailLines(tailLines);

    const output = await this.logExecutor.execute(
      service.externalResourceId,
      tailLines,
    );

    return normalizeLogOutput(service.id, output.stdout, output.stderr);
  }
}

export class ComposeProjectLogReader implements ServiceLogReader {
  public constructor(
    private readonly logExecutor: DockerComposeProjectLogExecutor,
  ) {
    Object.freeze(this);
  }

  public async readLogs(
    service: RegisteredService,
    tailLines: number,
  ): Promise<ServiceLogBatch> {
    validateTailLines(tailLines);

    const config = service.managementConfiguration;
    if (!config) {
      throw new Error("Compose project configuration is required");
    }

    const output = await this.logExecutor.execute(
      service.externalResourceId,
      config.projectDirectory,
      config.composeFile,
      tailLines,
    );

    return normalizeLogOutput(service.id, output.stdout, output.stderr);
  }
}

export class DispatchingServiceLogReader implements ServiceLogReader {
  private readonly readers: Readonly<Record<string, ServiceLogReader>>;

  public constructor(
    dockerLogReader: ServiceLogReader,
    composeLogReader: ServiceLogReader,
  ) {
    this.readers = Object.freeze({
      docker: dockerLogReader,
      "docker-compose": composeLogReader,
    });
    Object.freeze(this);
  }

  public async readLogs(
    service: RegisteredService,
    tailLines: number,
  ): Promise<ServiceLogBatch> {
    const reader = this.readers[service.managementAdapter];
    if (!reader) {
      throw new Error(
        `Log reader not available for adapter: ${service.managementAdapter}`,
      );
    }
    return reader.readLogs(service, tailLines);
  }
}
