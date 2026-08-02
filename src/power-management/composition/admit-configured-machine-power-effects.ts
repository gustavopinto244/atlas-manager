import type { EnvironmentConfig } from "../../config/environment.js";
import {
  LinuxPowerHelperInstallationPreflightError,
  NodeLinuxPowerHelperInstallationPreflight,
  type LinuxPowerHelperInstallationPreflight,
} from "../infrastructure/linux-power-helper-installation-preflight.js";
import {
  LinuxPowerRuntimeIdentityError,
  NodeLinuxPowerRuntimeIdentityInspector,
  type LinuxPowerRuntimeIdentity,
  type LinuxPowerRuntimeIdentityInspector,
} from "../infrastructure/linux-power-runtime-identity-inspector.js";

export type MachinePowerEffectsAdmission =
  | Readonly<{ kind: "disabled" }>
  | Readonly<{
      kind: "linux_helper";
      runtimeIdentity: LinuxPowerRuntimeIdentity;
    }>;

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
  | "helper_inspection_failed"
  | "runtime_identity_unsupported"
  | "runtime_identity_files_unsafe"
  | "runtime_identity_files_oversized"
  | "runtime_identity_malformed"
  | "runtime_user_missing"
  | "runtime_user_duplicate"
  | "runtime_user_root"
  | "runtime_user_mismatch"
  | "runtime_user_home_invalid"
  | "runtime_user_shell_invalid"
  | "runtime_primary_group_missing"
  | "runtime_primary_group_duplicate"
  | "runtime_primary_group_invalid"
  | "runtime_helper_group_missing"
  | "runtime_helper_group_duplicate"
  | "runtime_helper_group_invalid"
  | "runtime_helper_group_membership_missing"
  | "runtime_root_group_membership_rejected"
  | "runtime_identity_inspection_failed";

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
  readonly runtimeIdentityInspector?: LinuxPowerRuntimeIdentityInspector;
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

  const runtimeIdentityInspector =
    dependencies.runtimeIdentityInspector ??
    new NodeLinuxPowerRuntimeIdentityInspector();
  let runtimeIdentity: LinuxPowerRuntimeIdentity;
  try {
    runtimeIdentity = runtimeIdentityInspector.inspect();
  } catch (error) {
    if (error instanceof LinuxPowerRuntimeIdentityError)
      throw new MachinePowerEffectsAdmissionError(error.code);
    throw new MachinePowerEffectsAdmissionError(
      "runtime_identity_inspection_failed",
    );
  }
  if (!isRuntimeIdentity(runtimeIdentity))
    throw new MachinePowerEffectsAdmissionError(
      "runtime_identity_inspection_failed",
    );

  const preflight =
    dependencies.preflight ?? new NodeLinuxPowerHelperInstallationPreflight();
  try {
    preflight.inspect(
      activation.expectedHelperSha256,
      runtimeIdentity.helperGroupId,
    );
  } catch (error) {
    if (error instanceof LinuxPowerHelperInstallationPreflightError)
      throw new MachinePowerEffectsAdmissionError(error.code);
    throw new MachinePowerEffectsAdmissionError("helper_inspection_failed");
  }
  return Object.freeze({
    kind: "linux_helper" as const,
    runtimeIdentity: Object.freeze({ ...runtimeIdentity }),
  });
}

export function isRuntimeIdentityAdmissionError(
  error: unknown,
): error is MachinePowerEffectsAdmissionError {
  return (
    error instanceof MachinePowerEffectsAdmissionError &&
    error.code.startsWith("runtime_")
  );
}

function isRuntimeIdentity(value: LinuxPowerRuntimeIdentity): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    Number.isSafeInteger(value.userId) &&
    value.userId > 0 &&
    Number.isSafeInteger(value.primaryGroupId) &&
    value.primaryGroupId > 0 &&
    Number.isSafeInteger(value.helperGroupId) &&
    value.helperGroupId > 0 &&
    value.primaryGroupId !== value.helperGroupId
  );
}
