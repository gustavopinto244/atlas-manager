import { GetRtcInformation } from "../application/get-rtc-information.js";
import { RequestMachineShutdown } from "../application/request-machine-shutdown.js";
import type { MachineShutdownController } from "../application/ports/machine-shutdown-controller.js";
import type { PowerManagementClock } from "../application/ports/power-management-clock.js";
import type { RtcInformationReader } from "../application/ports/rtc-information-reader.js";
import {
  MockMachineShutdownController,
  type MockMachineShutdownControllerConfiguration,
} from "../infrastructure/mock-machine-shutdown-controller.js";
import {
  MockRtcInformationReader,
  type MockRtcInformationReaderConfiguration,
} from "../infrastructure/mock-rtc-information-reader.js";

export interface PowerManagementCapabilities {
  readonly getRtcInformation: GetRtcInformation;
  readonly requestMachineShutdown: RequestMachineShutdown;
}

export interface PowerManagementCompositionOverrides {
  readonly clock?: PowerManagementClock;
  readonly rtcInformationReader?: RtcInformationReader;
  readonly machineShutdownController?: MachineShutdownController;
  readonly mockRtcInformation?: MockRtcInformationReaderConfiguration;
  readonly mockMachineShutdownController?: MockMachineShutdownControllerConfiguration;
}

const DEFAULT_MOCK_RTC_INFORMATION = Object.freeze({
  rtcTime: "2026-01-01T00:00:00.000Z",
  wakeAlarm: Object.freeze({ state: "unsupported" as const }),
});

export function createPowerManagement(
  overrides: PowerManagementCompositionOverrides = {},
): PowerManagementCapabilities {
  const clock = overrides.clock ?? createSystemClock();
  const rtcInformationReader =
    overrides.rtcInformationReader ??
    new MockRtcInformationReader(
      overrides.mockRtcInformation ?? DEFAULT_MOCK_RTC_INFORMATION,
    );
  const machineShutdownController =
    overrides.machineShutdownController ??
    new MockMachineShutdownController(overrides.mockMachineShutdownController);

  const capabilities = {
    getRtcInformation: new GetRtcInformation(clock, rtcInformationReader),
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
