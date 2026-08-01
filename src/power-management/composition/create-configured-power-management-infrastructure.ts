import type { MachineShutdownController } from "../application/ports/machine-shutdown-controller.js";
import type { RtcInformationReader } from "../application/ports/rtc-information-reader.js";
import type { WakeAlarmController } from "../application/ports/wake-alarm-controller.js";
import type { WakeAlarmReader } from "../application/ports/wake-alarm-reader.js";
import type { PowerManagementBackend } from "../../config/environment.js";
import {
  createLinuxPowerHelperAdapters,
  type LinuxPowerHelperAdapterBundle,
  type LinuxPowerHelperAdapterFactoryDependencies,
} from "./create-linux-power-helper-adapters.js";

export interface ConfiguredPowerManagementAdapters {
  readonly rtcInformationReader?: RtcInformationReader;
  readonly wakeAlarmReader?: WakeAlarmReader;
  readonly wakeAlarmController?: WakeAlarmController;
  readonly machineShutdownController?: MachineShutdownController;
}

export interface ConfiguredPowerManagementInfrastructure {
  readonly backend: PowerManagementBackend;
  readonly adapters: Readonly<ConfiguredPowerManagementAdapters>;
}

export interface ConfiguredPowerManagementInfrastructureDependencies {
  readonly createLinuxPowerHelperAdapters?: (
    dependencies?: LinuxPowerHelperAdapterFactoryDependencies,
  ) => LinuxPowerHelperAdapterBundle;
}

export class PowerManagementInfrastructureError extends Error {
  public override readonly name = "PowerManagementInfrastructureError";

  public constructor(public readonly code: "invalid_linux_helper_adapters") {
    super(`Invalid power-management infrastructure: ${code}`);
    Object.freeze(this);
  }
}

export function createConfiguredPowerManagementInfrastructure(
  backend: PowerManagementBackend,
  dependencies: ConfiguredPowerManagementInfrastructureDependencies = {},
): ConfiguredPowerManagementInfrastructure {
  if (backend === "mock") {
    return Object.freeze({
      backend,
      adapters: Object.freeze({}),
    });
  }

  const createAdapters =
    dependencies.createLinuxPowerHelperAdapters ??
    createLinuxPowerHelperAdapters;
  const bundle = createAdapters();
  if (!isCompleteLinuxAdapterBundle(bundle)) {
    throw new PowerManagementInfrastructureError(
      "invalid_linux_helper_adapters",
    );
  }

  return Object.freeze({
    backend,
    adapters: Object.freeze({
      rtcInformationReader: bundle.rtcInformationReader,
      wakeAlarmReader: bundle.wakeAlarmReader,
      wakeAlarmController: bundle.wakeAlarmController,
      machineShutdownController: bundle.machineShutdownController,
    }),
  });
}

function isCompleteLinuxAdapterBundle(
  value: unknown,
): value is LinuxPowerHelperAdapterBundle {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== 4 ||
    ![
      "rtcInformationReader",
      "wakeAlarmReader",
      "wakeAlarmController",
      "machineShutdownController",
    ].every((key) => keys.includes(key))
  )
    return false;
  const record = value as Record<string, unknown>;
  return (
    hasMethod(record.rtcInformationReader, "read") &&
    hasMethod(record.wakeAlarmReader, "read") &&
    hasMethod(record.wakeAlarmController, "schedule") &&
    hasMethod(record.wakeAlarmController, "cancel") &&
    hasMethod(record.machineShutdownController, "requestShutdown")
  );
}

function hasMethod(value: unknown, method: string): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>)[method] === "function"
  );
}
