import type { EnvironmentConfig } from "../../config/environment.js";
import {
  LinuxPowerHelperInstallationPreflightError,
  NodeLinuxPowerHelperInstallationPreflight,
  type LinuxPowerHelperInstallationPreflight,
} from "../infrastructure/linux-power-helper-installation-preflight.js";

export type MachinePowerEffectsAdmission =
  Readonly<{ kind: "disabled" }> | Readonly<{ kind: "linux_helper" }>;

export type MachinePowerEffectsAdmissionErrorCode =
  | "backend_activation_conflict"
  | "activation_requires_surface"
  | "activation_disabled_for_effects"
  | "unsupported_platform"
  | "helper_missing"
  | "helper_not_regular"
  | "helper_symbolic_link"
  | "helper_owner_invalid"
  | "helper_group_invalid"
  | "helper_mode_invalid"
  | "helper_setuid_missing"
  | "helper_link_count_invalid"
  | "helper_parent_unsafe"
  | "process_group_membership_missing"
  | "helper_size_invalid"
  | "helper_hash_mismatch"
  | "helper_inspection_failed";

export class MachinePowerEffectsAdmissionError extends Error {
  public override readonly name = "MachinePowerEffectsAdmissionError";

  public constructor(
    public readonly code: MachinePowerEffectsAdmissionErrorCode,
  ) {
    super(`Machine power-effects activation blocked: ${code}`);
    Object.freeze(this);
  }
}

export interface MachinePowerEffectsAdmissionDependencies {
  readonly preflight?: LinuxPowerHelperInstallationPreflight;
}

export function admitConfiguredMachinePowerEffects(
  config: EnvironmentConfig,
  dependencies: MachinePowerEffectsAdmissionDependencies = {},
): MachinePowerEffectsAdmission {
  const effectSurfaceEnabled =
    config.administrativeWakeAlarmHttpEnabled ||
    config.administrativeShutdownHttpEnabled ||
    config.machinePowerSchedulerEnabled;
  const activation = config.machinePowerEffectsActivation;

  if (
    config.powerManagementBackend === "mock" &&
    activation.kind !== "disabled"
  )
    throw new MachinePowerEffectsAdmissionError("backend_activation_conflict");
  if (activation.kind === "disabled") {
    if (
      config.powerManagementBackend === "linux_helper" &&
      effectSurfaceEnabled
    )
      throw new MachinePowerEffectsAdmissionError(
        "activation_disabled_for_effects",
      );
    return Object.freeze({ kind: "disabled" });
  }
  if (!effectSurfaceEnabled)
    throw new MachinePowerEffectsAdmissionError("activation_requires_surface");
  if (config.powerManagementBackend !== "linux_helper")
    throw new MachinePowerEffectsAdmissionError("backend_activation_conflict");

  const preflight =
    dependencies.preflight ?? new NodeLinuxPowerHelperInstallationPreflight();
  try {
    preflight.inspect(activation.expectedHelperSha256);
  } catch (error) {
    if (error instanceof LinuxPowerHelperInstallationPreflightError)
      throw new MachinePowerEffectsAdmissionError(error.code);
    throw new MachinePowerEffectsAdmissionError("helper_inspection_failed");
  }
  return Object.freeze({ kind: "linux_helper" });
}
