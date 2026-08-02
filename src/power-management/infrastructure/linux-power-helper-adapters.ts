import type { MachineShutdownController } from "../application/ports/machine-shutdown-controller.js";
import type { RtcInformationReader } from "../application/ports/rtc-information-reader.js";
import type { WakeAlarmController } from "../application/ports/wake-alarm-controller.js";
import type { WakeAlarmReader } from "../application/ports/wake-alarm-reader.js";
import type { LinuxPowerHelperTransport } from "../application/ports/linux-power-helper-transport.js";
import {
  createCancelWakeAlarmRequest,
  createLinuxPowerHelperResponse,
  createReadRtcInformationRequest,
  createReadWakeAlarmRequest,
  createRequestShutdownRequest,
  createScheduleWakeAlarmRequest,
  type LinuxPowerHelperRequest,
  type LinuxPowerHelperResponse,
} from "../domain/linux-power-helper-protocol.js";
import {
  createMachineShutdownResult,
  type MachineShutdownResult,
} from "../domain/machine-shutdown-result.js";
import {
  createRtcInformation,
  type RtcInformation,
} from "../domain/rtc-information.js";
import {
  createWakeAlarmMutationResult,
  type WakeAlarmMutationResult,
} from "../domain/wake-alarm-mutation-result.js";
import {
  createWakeAlarmObservation,
  type WakeAlarmObservation,
} from "../domain/wake-alarm-observation.js";
import {
  LinuxPowerHelperAdapterError,
  LinuxPowerHelperTransportError,
} from "./linux-power-helper-errors.js";
import {
  NodeLinuxPowerHelperInstallationInspector,
  type LinuxPowerHelperInstallationInspector,
} from "./linux-power-helper-installation-inspector.js";
import {
  NodeLinuxPowerHelperTransport,
  type NodeLinuxPowerHelperTransportDependencies,
} from "./node-linux-power-helper-transport.js";

export class LinuxPowerHelperRtcInformationReader implements RtcInformationReader {
  readonly #transport: LinuxPowerHelperTransport;

  public constructor(transport: LinuxPowerHelperTransport) {
    this.#transport = transport;
    Object.freeze(this);
  }

  public async read(observedAt: string): Promise<RtcInformation> {
    const request = createReadRtcInformationRequest(observedAt);
    const response = await executeRequest(this.#transport, request);
    if (
      response.outcome !== "success" ||
      response.operation !== "read_rtc_information"
    ) {
      throw operationError(response);
    }
    try {
      return createRtcInformation({
        observedAt,
        rtcTime: response.result.rtcTime,
        wakeAlarm: response.result.wakeAlarm,
      });
    } catch {
      throw new LinuxPowerHelperAdapterError("helper_output_invalid");
    }
  }
}

export class LinuxPowerHelperWakeAlarmReader implements WakeAlarmReader {
  readonly #transport: LinuxPowerHelperTransport;

  public constructor(transport: LinuxPowerHelperTransport) {
    this.#transport = transport;
    Object.freeze(this);
  }

  public async read(observedAt: string): Promise<WakeAlarmObservation> {
    const request = createReadWakeAlarmRequest(observedAt);
    const response = await executeRequest(this.#transport, request);
    if (
      response.outcome !== "success" ||
      response.operation !== "read_wake_alarm"
    ) {
      throw operationError(response);
    }
    try {
      return createWakeAlarmObservation({
        observedAt,
        wakeAlarm: response.result,
      });
    } catch {
      throw new LinuxPowerHelperAdapterError("helper_output_invalid");
    }
  }
}

export class LinuxPowerHelperWakeAlarmController implements WakeAlarmController {
  readonly #transport: LinuxPowerHelperTransport;

  public constructor(transport: LinuxPowerHelperTransport) {
    this.#transport = transport;
    Object.freeze(this);
  }

  public async schedule(
    requestedAt: string,
    scheduledFor: string,
  ): Promise<WakeAlarmMutationResult> {
    const request = createScheduleWakeAlarmRequest(requestedAt, scheduledFor);
    const response = await executeRequest(this.#transport, request);
    if (
      response.outcome !== "success" ||
      response.operation !== "schedule_wake_alarm"
    ) {
      throw operationError(response);
    }
    try {
      return createWakeAlarmMutationResult({
        operation: "schedule",
        requestedAt,
        ...response.result,
      });
    } catch {
      throw new LinuxPowerHelperAdapterError("helper_output_invalid");
    }
  }

  public async cancel(requestedAt: string): Promise<WakeAlarmMutationResult> {
    const request = createCancelWakeAlarmRequest(requestedAt);
    const response = await executeRequest(this.#transport, request);
    if (
      response.outcome !== "success" ||
      response.operation !== "cancel_wake_alarm"
    ) {
      throw operationError(response);
    }
    try {
      return createWakeAlarmMutationResult({
        operation: "cancel",
        requestedAt,
        ...response.result,
      });
    } catch {
      throw new LinuxPowerHelperAdapterError("helper_output_invalid");
    }
  }
}

export class LinuxPowerHelperMachineShutdownController implements MachineShutdownController {
  readonly #transport: LinuxPowerHelperTransport;

  public constructor(transport: LinuxPowerHelperTransport) {
    this.#transport = transport;
    Object.freeze(this);
  }

  public async requestShutdown(
    requestedAt: string,
  ): Promise<MachineShutdownResult> {
    const request = createRequestShutdownRequest(requestedAt);
    const response = await executeRequest(this.#transport, request);
    if (
      response.outcome !== "success" ||
      response.operation !== "request_shutdown"
    ) {
      throw operationError(response);
    }
    try {
      return createMachineShutdownResult({
        operation: "shutdown",
        requestedAt,
        outcome: "accepted",
      });
    } catch {
      throw new LinuxPowerHelperAdapterError("helper_output_invalid");
    }
  }
}

export interface LinuxPowerHelperAdapterBundle {
  readonly rtcInformationReader: LinuxPowerHelperRtcInformationReader;
  readonly wakeAlarmReader: LinuxPowerHelperWakeAlarmReader;
  readonly wakeAlarmController: LinuxPowerHelperWakeAlarmController;
  readonly machineShutdownController: LinuxPowerHelperMachineShutdownController;
}

export interface LinuxPowerHelperAdapterFactoryDependencies {
  readonly transport?: LinuxPowerHelperTransport;
  readonly installationInspector?: LinuxPowerHelperInstallationInspector;
  readonly expectedHelperGroupId?: number;
  readonly transportDependencies?: NodeLinuxPowerHelperTransportDependencies;
}

export function createLinuxPowerHelperAdapters(
  dependencies: LinuxPowerHelperAdapterFactoryDependencies = {},
): LinuxPowerHelperAdapterBundle {
  const installationInspector =
    dependencies.installationInspector ??
    new NodeLinuxPowerHelperInstallationInspector();
  const transport =
    dependencies.transport ??
    new NodeLinuxPowerHelperTransport({
      inspector: installationInspector,
      ...dependencies.transportDependencies,
      ...(dependencies.expectedHelperGroupId === undefined
        ? {}
        : { expectedHelperGroupId: dependencies.expectedHelperGroupId }),
    });
  return Object.freeze({
    rtcInformationReader: new LinuxPowerHelperRtcInformationReader(transport),
    wakeAlarmReader: new LinuxPowerHelperWakeAlarmReader(transport),
    wakeAlarmController: new LinuxPowerHelperWakeAlarmController(transport),
    machineShutdownController: new LinuxPowerHelperMachineShutdownController(
      transport,
    ),
  });
}

async function executeRequest(
  transport: LinuxPowerHelperTransport,
  request: LinuxPowerHelperRequest,
): Promise<LinuxPowerHelperResponse> {
  let response: LinuxPowerHelperResponse;
  try {
    response = await transport.execute(request);
  } catch (error) {
    throw translateTransportError(error);
  }
  try {
    return createLinuxPowerHelperResponse(response, request);
  } catch {
    throw new LinuxPowerHelperAdapterError("helper_output_invalid");
  }
}

function operationError(
  response: LinuxPowerHelperResponse,
): LinuxPowerHelperAdapterError {
  if (response.outcome === "success") {
    return new LinuxPowerHelperAdapterError("helper_output_invalid");
  }
  return new LinuxPowerHelperAdapterError(
    response.outcome === "rejected"
      ? "helper_operation_rejected"
      : "helper_operation_failed",
  );
}

function translateTransportError(error: unknown): LinuxPowerHelperAdapterError {
  if (!(error instanceof LinuxPowerHelperTransportError)) {
    return new LinuxPowerHelperAdapterError("helper_unavailable");
  }
  const code = error.code;
  if (code === "unsupported_platform")
    return new LinuxPowerHelperAdapterError(code);
  if (code === "helper_timeout") {
    return new LinuxPowerHelperAdapterError("helper_timeout");
  }
  if (
    code === "helper_stdout_too_large" ||
    code === "helper_stderr_too_large" ||
    code === "helper_protocol_invalid"
  ) {
    return new LinuxPowerHelperAdapterError("helper_output_invalid");
  }
  if (
    code === "helper_not_found" ||
    code === "helper_not_regular_file" ||
    code === "helper_symbolic_link_rejected" ||
    code === "helper_owner_invalid" ||
    code === "helper_setuid_required" ||
    code === "helper_group_invalid" ||
    code === "helper_process_group_missing" ||
    code === "helper_mode_invalid" ||
    code === "helper_permissions_unsafe" ||
    code === "helper_not_executable" ||
    code === "helper_parent_invalid" ||
    code === "helper_parent_owner_invalid" ||
    code === "helper_inspection_failed"
  ) {
    return new LinuxPowerHelperAdapterError("helper_installation_invalid");
  }
  return new LinuxPowerHelperAdapterError("helper_unavailable");
}
