import {
  classifyDiagnosticExecFailure,
  DiagnosticExecExitError,
  executeDiagnosticFile,
  outputIndicatesPermissionDenied,
  type DiagnosticExecFile,
} from "./bounded-diagnostic-exec.js";
import type {
  DiagnosticUnitName,
  SystemdUnitStateOutcome,
  SystemdUnitStateReader,
} from "../ports/systemd-unit-state-reader.js";

const SYSTEMCTL_EXECUTABLE = "systemctl";

/**
 * `show` is the only verb this system may ever hand systemctl. It reads and
 * reports; it cannot start, stop, restart, enable, disable or mask anything.
 * The property list is a constant, and the unit name is a closed union member —
 * nothing here is interpolated from a request, a config value or a file.
 */
const SYSTEMCTL_SHOW_VERB = "show";
const SYSTEMCTL_PROPERTY_ARGUMENT =
  "--property=ActiveState,SubState,UnitFileState";
const SYSTEMCTL_VALUE_ARGUMENT = "--value";

const SYSTEMCTL_TIMEOUT_MS = 3_000;
const SYSTEMCTL_MAX_OUTPUT_BYTES = 65_536;

export class NodeSystemctlUnitStateReader implements SystemdUnitStateReader {
  public constructor(
    private readonly runFile: DiagnosticExecFile = executeDiagnosticFile,
  ) {}

  public async read(
    unitName: DiagnosticUnitName,
  ): Promise<SystemdUnitStateOutcome> {
    let stdout: string;
    try {
      const result = await this.runFile(
        SYSTEMCTL_EXECUTABLE,
        [
          SYSTEMCTL_SHOW_VERB,
          unitName,
          SYSTEMCTL_PROPERTY_ARGUMENT,
          SYSTEMCTL_VALUE_ARGUMENT,
        ],
        {
          encoding: "utf8",
          maxBuffer: SYSTEMCTL_MAX_OUTPUT_BYTES,
          shell: false,
          timeout: SYSTEMCTL_TIMEOUT_MS,
          windowsHide: true,
        },
      );
      stdout = result.stdout;
    } catch (error) {
      return undetermined(error);
    }
    return parseUnitState(stdout);
  }
}

function undetermined(error: unknown): SystemdUnitStateOutcome {
  const kind = classifyDiagnosticExecFailure(error);
  if (kind === "permission_denied")
    return refused("systemd_permission_denied", true);
  if (kind === "timeout") return refused("systemd_timeout", false);
  if (kind === "output_limit") return refused("systemd_output_invalid", false);
  if (kind === "missing_executable")
    return refused("systemd_unavailable", false);
  if (
    error instanceof DiagnosticExecExitError &&
    outputIndicatesPermissionDenied(error.stderr)
  )
    return refused("systemd_permission_denied", true);
  // A non-zero exit from `systemctl show` means the unit could not be
  // described — an unknown unit, or a systemd that is not running. Neither is
  // evidence that the unit is down, so it is reported as undetermined rather
  // than as an outage.
  return refused("systemd_unavailable", false);
}

function refused(
  code:
    | "systemd_permission_denied"
    | "systemd_unavailable"
    | "systemd_timeout"
    | "systemd_output_invalid",
  requiresPrivilege: boolean,
): SystemdUnitStateOutcome {
  return Object.freeze({
    outcome: "undetermined" as const,
    code,
    requiresPrivilege,
  });
}

function parseUnitState(stdout: string): SystemdUnitStateOutcome {
  const lines = stdout.split("\n").map((line) => line.trim());
  const [activeState, subState, unitFileState] = lines;
  if (
    activeState === undefined ||
    activeState.length === 0 ||
    subState === undefined ||
    unitFileState === undefined
  )
    return refused("systemd_output_invalid", false);
  return Object.freeze({
    outcome: "observed" as const,
    activeState,
    subState,
    unitFileState,
  });
}
