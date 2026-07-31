import { CancelWakeAlarm } from "../application/cancel-wake-alarm.js";
import { GetMachinePowerPlan } from "../application/get-machine-power-plan.js";
import { GetNextWakeAlarm } from "../application/get-next-wake-alarm.js";
import { GetRtcInformation } from "../application/get-rtc-information.js";
import { RequestMachineShutdown } from "../application/request-machine-shutdown.js";
import { ScheduleWakeAlarm } from "../application/schedule-wake-alarm.js";
import type { MachineShutdownController } from "../application/ports/machine-shutdown-controller.js";
import type { PowerManagementClock } from "../application/ports/power-management-clock.js";
import type { RtcInformationReader } from "../application/ports/rtc-information-reader.js";
import type { WakeAlarmController } from "../application/ports/wake-alarm-controller.js";
import type { WakeAlarmReader } from "../application/ports/wake-alarm-reader.js";
import {
  MockMachineShutdownController,
  type MockMachineShutdownControllerConfiguration,
} from "../infrastructure/mock-machine-shutdown-controller.js";
import {
  MockRtcInformationReader,
  type MockRtcInformationReaderConfiguration,
} from "../infrastructure/mock-rtc-information-reader.js";
import {
  MockWakeAlarmController,
  type MockWakeAlarmControllerConfiguration,
} from "../infrastructure/mock-wake-alarm-controller.js";
import { MockWakeAlarmReader } from "../infrastructure/mock-wake-alarm-reader.js";
import {
  MockWakeAlarmState,
  type MockWakeAlarmStateConfiguration,
} from "../infrastructure/mock-wake-alarm-state.js";
import { createMachineOperatingPolicy } from "../domain/machine-operating-policy.js";

export interface PowerManagementCapabilities {
  readonly getRtcInformation: GetRtcInformation;
  readonly getNextWakeAlarm: GetNextWakeAlarm;
  readonly scheduleWakeAlarm: ScheduleWakeAlarm;
  readonly cancelWakeAlarm: CancelWakeAlarm;
  readonly getMachinePowerPlan: GetMachinePowerPlan;
  readonly requestMachineShutdown: RequestMachineShutdown;
}

export interface PowerManagementCompositionOverrides {
  readonly clock?: PowerManagementClock;
  readonly rtcInformationReader?: RtcInformationReader;
  readonly wakeAlarmReader?: WakeAlarmReader;
  readonly wakeAlarmController?: WakeAlarmController;
  readonly machineShutdownController?: MachineShutdownController;
  readonly mockRtcInformation?: MockRtcInformationReaderConfiguration;
  readonly mockWakeAlarmState?: MockWakeAlarmStateConfiguration;
  readonly mockWakeAlarmReader?: { readonly failure?: Error };
  readonly mockWakeAlarmController?: MockWakeAlarmControllerConfiguration;
  readonly mockMachineShutdownController?: MockMachineShutdownControllerConfiguration;
  readonly machineOperatingPolicy?: unknown;
}

const DEFAULT_MOCK_RTC_INFORMATION = Object.freeze({
  rtcTime: "2026-01-01T00:00:00.000Z",
});

const DEFAULT_MACHINE_OPERATING_POLICY = Object.freeze({
  mode: "always_on" as const,
});

export function createPowerManagement(
  overrides: PowerManagementCompositionOverrides = {},
): PowerManagementCapabilities {
  const clock = overrides.clock ?? createSystemClock();
  const wakeAlarmState = new MockWakeAlarmState(overrides.mockWakeAlarmState);
  const wakeAlarmReader =
    overrides.wakeAlarmReader ??
    new MockWakeAlarmReader(wakeAlarmState, overrides.mockWakeAlarmReader);
  const wakeAlarmController =
    overrides.wakeAlarmController ??
    new MockWakeAlarmController(
      wakeAlarmState,
      overrides.mockWakeAlarmController,
    );
  const rtcInformationReader =
    overrides.rtcInformationReader ??
    new MockRtcInformationReader(
      overrides.mockRtcInformation ?? DEFAULT_MOCK_RTC_INFORMATION,
      wakeAlarmState,
    );
  const machineShutdownController =
    overrides.machineShutdownController ??
    new MockMachineShutdownController(overrides.mockMachineShutdownController);
  const machineOperatingPolicy = createMachineOperatingPolicy(
    overrides.machineOperatingPolicy ?? DEFAULT_MACHINE_OPERATING_POLICY,
  );

  const capabilities = {
    getRtcInformation: new GetRtcInformation(clock, rtcInformationReader),
    getNextWakeAlarm: new GetNextWakeAlarm(clock, wakeAlarmReader),
    scheduleWakeAlarm: new ScheduleWakeAlarm(clock, wakeAlarmController),
    cancelWakeAlarm: new CancelWakeAlarm(clock, wakeAlarmController),
    getMachinePowerPlan: new GetMachinePowerPlan(clock, machineOperatingPolicy),
    requestMachineShutdown: new RequestMachineShutdown(
      clock,
      machineShutdownController,
    ),
  };

  return Object.freeze(capabilities);
}

function createSystemClock(): PowerManagementClock {
  return Object.freeze({
    now: () => new Date(),
  });
}
