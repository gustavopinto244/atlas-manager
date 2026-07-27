import type { RegisteredService } from "../domain/registered-service.js";
import {
  createServiceLogBatch,
  type ServiceLogBatch,
} from "../domain/service-log-batch.js";
import { validateTailLines } from "../domain/service-log-tail-lines.js";
import type { ServiceLogReader } from "../application/ports/service-log-reader.js";
import type {
  DockerContainerLogExecutor,
  DockerComposeProjectLogExecutor,
} from "./docker-compose-executors.js";

const MAX_LINE_LENGTH = 4096;
const MAX_TOTAL_LINES = 500;

/* eslint-disable no-control-regex */
const CONTROL_CHAR_REGEX = /[\x00-\x08\x0b\x0c\x0e-\x1f]/g;
const ANSI_REGEX =
  /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-PRZcf-nqry=><]/g;
/* eslint-enable no-control-regex */

export class ServiceLogReaderUnavailableError extends Error {
  public constructor() {
    super("Service log reader unavailable");
    this.name = "ServiceLogReaderUnavailableError";
    Object.freeze(this);
  }
}

interface NormalizedLines {
  readonly lines: readonly string[];
  readonly truncated: boolean;
}

function normalizeLines(input: string): NormalizedLines {
  if (!input) {
    return {
      lines: Object.freeze([]),
      truncated: false,
    };
  }

  const cleaned = input.replace(ANSI_REGEX, "");
  const rawLines = cleaned.split(/\r\n|\n|\r/);

  let truncated = rawLines.length > MAX_TOTAL_LINES;

  const lines = rawLines
    .slice(0, MAX_TOTAL_LINES)
    .map((line) => {
      const sanitized = line.replace(CONTROL_CHAR_REGEX, "");

      if (sanitized.length > MAX_LINE_LENGTH) {
        truncated = true;
      }

      return sanitized.slice(0, MAX_LINE_LENGTH);
    })
    .filter((line) => line.length > 0);

  return {
    lines: Object.freeze(lines),
    truncated,
  };
}

export function normalizeLogOutput(
  serviceId: string,
  collectedAt: Date,
  stdout: string,
  stderr: string,
): ServiceLogBatch {
  const normalizedStdout = normalizeLines(stdout);
  const normalizedStderr = normalizeLines(stderr);

  return createServiceLogBatch({
    serviceId,
    collectedAt: collectedAt.toISOString(),
    stdoutLines: normalizedStdout.lines,
    stderrLines: normalizedStderr.lines,
    truncated: normalizedStdout.truncated || normalizedStderr.truncated,
  });
}

export class DockerContainerLogReader implements ServiceLogReader {
  public constructor(private readonly logExecutor: DockerContainerLogExecutor) {
    Object.freeze(this);
  }

  public async readLogs(
    service: RegisteredService,
    tailLines: number,
    collectedAt: Date,
  ): Promise<ServiceLogBatch> {
    validateTailLines(tailLines);

    const output = await this.logExecutor.execute(
      service.externalResourceId,
      tailLines,
    );

    return normalizeLogOutput(
      service.id,
      collectedAt,
      output.stdout,
      output.stderr,
    );
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
    collectedAt: Date,
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

    return normalizeLogOutput(
      service.id,
      collectedAt,
      output.stdout,
      output.stderr,
    );
  }
}

export class DispatchingServiceLogReader implements ServiceLogReader {
  private readonly readers: Readonly<{
    docker: ServiceLogReader;
    "docker-compose": ServiceLogReader;
  }>;

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
    collectedAt: Date,
  ): Promise<ServiceLogBatch> {
    const reader =
      this.readers[service.managementAdapter as keyof typeof this.readers];

    if (!reader) {
      throw new ServiceLogReaderUnavailableError();
    }

    return reader.readLogs(service, tailLines, collectedAt);
  }
}
