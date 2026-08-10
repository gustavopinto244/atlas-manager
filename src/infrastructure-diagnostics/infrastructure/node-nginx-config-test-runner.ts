import {
  classifyDiagnosticExecFailure,
  DiagnosticExecExitError,
  executeDiagnosticFile,
  outputIndicatesPermissionDenied,
  type DiagnosticExecFile,
} from "./bounded-diagnostic-exec.js";
import type {
  NginxConfigTestOutcome,
  NginxConfigTestRunner,
} from "../ports/nginx-config-test-runner.js";

const NGINX_EXECUTABLE = "nginx";

/**
 * `-t` is the only flag this system may ever hand nginx: it parses and tests
 * the configuration and exits. It is not `-s reload`, and there is no code path
 * anywhere that can turn it into one.
 */
const NGINX_CONFIG_TEST_ARGUMENTS = Object.freeze(["-t"] as const);

const NGINX_TIMEOUT_MS = 5_000;
const NGINX_MAX_OUTPUT_BYTES = 65_536;

/** nginx reports both success and failure on stderr. */
const SUCCESS_PATTERNS: readonly RegExp[] = Object.freeze([
  /syntax is ok/iu,
  /test is successful/iu,
]);

/**
 * Only the single `nginx: [emerg] …` line is extracted, bounded. The full
 * stderr blob can carry file paths and directive content, and ADR-032 §7 keeps
 * it out of the response.
 */
const EMERGENCY_LINE = /^nginx:\s*\[emerg\].*$/imu;
const DETAIL_MAX_LENGTH = 500;

export class NodeNginxConfigTestRunner implements NginxConfigTestRunner {
  public constructor(
    private readonly runFile: DiagnosticExecFile = executeDiagnosticFile,
  ) {}

  public async run(): Promise<NginxConfigTestOutcome> {
    try {
      const result = await this.runFile(
        NGINX_EXECUTABLE,
        NGINX_CONFIG_TEST_ARGUMENTS,
        {
          encoding: "utf8",
          maxBuffer: NGINX_MAX_OUTPUT_BYTES,
          shell: false,
          timeout: NGINX_TIMEOUT_MS,
          windowsHide: true,
        },
      );
      return succeeded(`${result.stdout}\n${result.stderr}`)
        ? Object.freeze({ outcome: "valid" as const })
        : refused("nginx_output_invalid", false);
    } catch (error) {
      return classify(error);
    }
  }
}

function succeeded(output: string): boolean {
  return SUCCESS_PATTERNS.some((pattern) => pattern.test(output));
}

function classify(error: unknown): NginxConfigTestOutcome {
  const kind = classifyDiagnosticExecFailure(error);
  if (kind === "permission_denied")
    return refused("nginx_permission_denied", true);
  if (kind === "timeout") return refused("nginx_timeout", false);
  if (kind === "output_limit") return refused("nginx_output_invalid", false);
  if (kind === "missing_executable") return refused("nginx_unavailable", false);
  if (!(error instanceof DiagnosticExecExitError))
    return refused("nginx_unavailable", false);
  const output = `${error.stdout}\n${error.stderr}`;
  if (outputIndicatesPermissionDenied(output))
    return refused("nginx_permission_denied", true);
  const emergency = EMERGENCY_LINE.exec(output)?.[0]?.trim();
  if (emergency !== undefined && emergency.length > 0)
    return Object.freeze({
      outcome: "invalid" as const,
      detail: emergency.slice(0, DETAIL_MAX_LENGTH),
    });
  // A non-zero exit with no recognizable emergency line is not evidence that
  // the configuration is broken — it may be a build of nginx that could not
  // even open its configuration. Undetermined, not "down".
  return refused("nginx_output_invalid", false);
}

function refused(
  code:
    | "nginx_permission_denied"
    | "nginx_unavailable"
    | "nginx_timeout"
    | "nginx_output_invalid",
  requiresPrivilege: boolean,
): NginxConfigTestOutcome {
  return Object.freeze({
    outcome: "undetermined" as const,
    code,
    requiresPrivilege,
  });
}
