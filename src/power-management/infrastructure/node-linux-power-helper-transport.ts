import { spawn, type ChildProcess } from "node:child_process";
import {
  createLinuxPowerHelperRequest,
  parseLinuxPowerHelperResponse,
  serializeLinuxPowerHelperRequest,
  type LinuxPowerHelperRequest,
  type LinuxPowerHelperResponse,
} from "../domain/linux-power-helper-protocol.js";
import type { LinuxPowerHelperTransport } from "../application/ports/linux-power-helper-transport.js";
import {
  LINUX_POWER_HELPER_PATH,
  LinuxPowerHelperInstallationError,
  NodeLinuxPowerHelperInstallationInspector,
  type LinuxPowerHelperInstallationInspector,
} from "./linux-power-helper-installation-inspector.js";
import { LinuxPowerHelperTransportError } from "./linux-power-helper-errors.js";

const HELPER_TIMEOUT_MS = 5_000;
const MAX_STDOUT_BYTES = 16_384;
const MAX_STDERR_BYTES = 4_096;

export interface NodeLinuxPowerHelperTransportDependencies {
  readonly inspector?: LinuxPowerHelperInstallationInspector;
  readonly expectedHelperGroupId?: number;
  readonly platform?: NodeJS.Platform;
  readonly spawn?: typeof spawn;
}

export class NodeLinuxPowerHelperTransport implements LinuxPowerHelperTransport {
  readonly #inspector: LinuxPowerHelperInstallationInspector;
  readonly #expectedHelperGroupId: number | undefined;
  readonly #platform: NodeJS.Platform;
  readonly #spawn: typeof spawn;
  #tail: Promise<void> = Promise.resolve();

  public constructor(
    dependencies: NodeLinuxPowerHelperTransportDependencies = {},
  ) {
    this.#inspector =
      dependencies.inspector ?? new NodeLinuxPowerHelperInstallationInspector();
    this.#expectedHelperGroupId = dependencies.expectedHelperGroupId;
    this.#platform = dependencies.platform ?? process.platform;
    this.#spawn = dependencies.spawn ?? spawn;
    Object.freeze(this);
  }

  public execute(
    request: LinuxPowerHelperRequest,
  ): Promise<LinuxPowerHelperResponse> {
    const validatedRequest = createLinuxPowerHelperRequest(request);
    const serializedRequest =
      serializeLinuxPowerHelperRequest(validatedRequest);
    const execution = this.#tail.then(
      () => this.#executeOne(validatedRequest, serializedRequest),
      () => this.#executeOne(validatedRequest, serializedRequest),
    );
    this.#tail = execution.then(
      () => undefined,
      () => undefined,
    );
    return execution;
  }

  #executeOne(
    request: LinuxPowerHelperRequest,
    serializedRequest: string,
  ): Promise<LinuxPowerHelperResponse> {
    if (this.#platform !== "linux") {
      return Promise.reject(
        new LinuxPowerHelperTransportError("unsupported_platform"),
      );
    }

    try {
      this.#inspector.inspect(this.#expectedHelperGroupId);
    } catch (error) {
      if (error instanceof LinuxPowerHelperInstallationError) {
        return Promise.reject(new LinuxPowerHelperTransportError(error.code));
      }
      return Promise.reject(
        new LinuxPowerHelperTransportError("helper_inspection_failed"),
      );
    }

    return new Promise<LinuxPowerHelperResponse>((resolve, reject) => {
      let child: ChildProcess;
      try {
        child = this.#spawn(LINUX_POWER_HELPER_PATH, [], {
          cwd: "/",
          env: { LANG: "C", LC_ALL: "C" },
          shell: false,
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch {
        reject(new LinuxPowerHelperTransportError("helper_start_failed"));
        return;
      }

      const stdout = child.stdout;
      const stderr = child.stderr;
      const stdin = child.stdin;
      if (!stdout || !stderr || !stdin) {
        safelyKill(child);
        reject(new LinuxPowerHelperTransportError("helper_start_failed"));
        return;
      }

      let stdoutChunks: Buffer[] = [];
      let stderrChunks: Buffer[] = [];
      let stdoutSize = 0;
      let stderrSize = 0;
      let settled = false;
      let timer: NodeJS.Timeout | undefined;

      const cleanup = (): void => {
        if (timer) clearTimeout(timer);
        timer = undefined;
        stdout.removeListener("data", onStdoutData);
        stderr.removeListener("data", onStderrData);
        stdin.removeListener("error", onStdinError);
        child.removeListener("error", onProcessError);
        child.removeListener("close", onClose);
      };

      const fail = (
        code: ConstructorParameters<typeof LinuxPowerHelperTransportError>[0],
      ): void => {
        if (settled) return;
        settled = true;
        cleanup();
        stdoutChunks = [];
        stderrChunks = [];
        safelyKill(child);
        reject(new LinuxPowerHelperTransportError(code));
      };

      const onStdoutData = (chunk: Buffer | string): void => {
        if (settled) return;
        const buffer = toBuffer(chunk);
        stdoutSize += buffer.byteLength;
        if (stdoutSize > MAX_STDOUT_BYTES) {
          fail("helper_stdout_too_large");
          return;
        }
        stdoutChunks.push(buffer);
      };

      const onStderrData = (chunk: Buffer | string): void => {
        if (settled) return;
        const buffer = toBuffer(chunk);
        stderrSize += buffer.byteLength;
        if (stderrSize > MAX_STDERR_BYTES) {
          fail("helper_stderr_too_large");
          return;
        }
        stderrChunks.push(buffer);
      };

      const onStdinError = (): void => fail("helper_io_failed");
      const onProcessError = (): void => fail("helper_start_failed");
      const onClose = (
        code: number | null,
        signal: NodeJS.Signals | null,
      ): void => {
        if (settled) return;
        settled = true;
        cleanup();
        const output = Buffer.concat(stdoutChunks);
        stdoutChunks = [];
        stderrChunks = [];
        if (code !== 0) {
          reject(
            new LinuxPowerHelperTransportError(
              code === null && signal !== null
                ? "helper_terminated"
                : "helper_exit_failed",
            ),
          );
          return;
        }
        if (signal !== null) {
          reject(new LinuxPowerHelperTransportError("helper_terminated"));
          return;
        }
        try {
          resolve(parseLinuxPowerHelperResponse(output, request.operation));
        } catch {
          reject(new LinuxPowerHelperTransportError("helper_protocol_invalid"));
        }
      };

      stdout.on("data", onStdoutData);
      stderr.on("data", onStderrData);
      stdin.once("error", onStdinError);
      child.once("error", onProcessError);
      child.once("close", onClose);
      timer = setTimeout(() => fail("helper_timeout"), HELPER_TIMEOUT_MS);

      try {
        stdin.end(serializedRequest);
      } catch {
        fail("helper_io_failed");
      }
    });
  }
}

function toBuffer(chunk: Buffer | string): Buffer {
  return Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
}

function safelyKill(child: ChildProcess): void {
  try {
    if (!child.killed) child.kill("SIGTERM");
  } catch {
    // The public error remains the primary transport failure.
  }
}
