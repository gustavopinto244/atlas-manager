import { execFile } from "node:child_process";

/**
 * The bounded-execution template every diagnostic adapter uses, lifted verbatim
 * from `src/service-management/infrastructure/pm2-process-list-executor.ts` and
 * required by ADR-032 §1.
 *
 * The options are not defaulted anywhere and are not optional: `shell: false`
 * removes the shell from the picture entirely, the timeout removes an
 * indefinite hang, and `maxBuffer` removes an unbounded read. A caller that
 * forgets one cannot compile.
 */
export interface DiagnosticExecOptions {
  readonly encoding: "utf8";
  readonly maxBuffer: number;
  readonly shell: false;
  readonly timeout: number;
  readonly windowsHide: true;
}

export type DiagnosticExecResult = Readonly<{
  stdout: string;
  stderr: string;
}>;

export type DiagnosticExecFile = (
  executable: string,
  arguments_: readonly string[],
  options: DiagnosticExecOptions,
) => Promise<DiagnosticExecResult>;

/**
 * A command that exited non-zero. Diagnostics frequently *need* that output —
 * `nginx -t` reports a configuration error on a non-zero exit — so the failure
 * carries it rather than discarding it, while still distinguishing the
 * "the command could not run at all" cases below.
 */
export class DiagnosticExecExitError extends Error {
  public override readonly name = "DiagnosticExecExitError";
  public constructor(
    public readonly exitCode: number | null,
    public readonly stdout: string,
    public readonly stderr: string,
  ) {
    super("Diagnostic command exited non-zero");
  }
}

export const executeDiagnosticFile: DiagnosticExecFile = (
  executable,
  arguments_,
  options,
) =>
  new Promise((resolve, reject) => {
    execFile(executable, [...arguments_], options, (error, stdout, stderr) => {
      if (error !== null) {
        const code = (error as { code?: unknown }).code;
        if (typeof code === "number" || code === undefined)
          reject(new DiagnosticExecExitError(code ?? null, stdout, stderr));
        else
          reject(
            error instanceof Error
              ? error
              : new Error("Diagnostic command execution failed"),
          );
        return;
      }
      resolve(Object.freeze({ stdout, stderr }));
    });
  });

export type DiagnosticExecFailureKind =
  | "timeout"
  | "output_limit"
  | "permission_denied"
  | "missing_executable"
  | "exit"
  | "unknown";

/**
 * Classify a rejection into the vocabulary the checks report.
 *
 * `permission_denied` is singled out because ADR-032 §9 makes it a first-class
 * diagnostic outcome rather than an error: the answer is "you did not grant me
 * the privilege to look", and nothing anywhere retries with elevation.
 */
export function classifyDiagnosticExecFailure(
  error: unknown,
): DiagnosticExecFailureKind {
  if (error instanceof DiagnosticExecExitError) return "exit";
  if (!isObject(error)) return "unknown";
  if (error["killed"] === true && error["signal"] !== undefined)
    return "timeout";
  const code = error["code"];
  if (code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") return "output_limit";
  if (code === "ETIMEDOUT") return "timeout";
  if (code === "EACCES" || code === "EPERM") return "permission_denied";
  if (code === "ENOENT" || code === "ENOTDIR") return "missing_executable";
  return "unknown";
}

/**
 * Some tools refuse in their *output* rather than with an errno — systemd and
 * nginx both do. The match is deliberately narrow and case-insensitive.
 */
export function outputIndicatesPermissionDenied(value: string): boolean {
  return /access denied|permission denied|operation not permitted|must be run as root|are you root/iu.test(
    value,
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
