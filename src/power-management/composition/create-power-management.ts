import { CancelWakeAlarm } from "../application/cancel-wake-alarm.js";
import { GetMachinePowerPlan } from "../application/get-machine-power-plan.js";
import { GetNextWakeAlarm } from "../application/get-next-wake-alarm.js";
import { GetRtcInformation } from "../application/get-rtc-information.js";
import { RequestMachineShutdown } from "../application/request-machine-shutdown.js";
import { ScheduleWakeAlarm } from "../application/schedule-wake-alarm.js";
import { PlanNextMachineShutdownOccurrence } from "../application/plan-next-machine-shutdown-occurrence.js";
import { ExecuteMachineShutdownOccurrence } from "../application/execute-machine-shutdown-occurrence.js";
import type { MachineShutdownOccurrenceClaimStore } from "../application/ports/machine-shutdown-occurrence-claim-store.js";
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
import { InMemoryMachineShutdownOccurrenceClaimStore } from "../infrastructure/in-memory-machine-shutdown-occurrence-claim-store.js";
import { RunMachinePowerSchedulerTick } from "../application/run-machine-power-scheduler-tick.js";
import type { MachinePowerSchedulerCursorStore } from "../application/ports/machine-power-scheduler-cursor-store.js";
import { InMemoryMachinePowerSchedulerCursorStore } from "../infrastructure/in-memory-machine-power-scheduler-cursor-store.js";
import { FileMachinePowerSchedulerCursorStore } from "../infrastructure/file-machine-power-scheduler-cursor-store.js";
import { FileMachineShutdownOccurrenceClaimStore } from "../infrastructure/file-machine-shutdown-occurrence-claim-store.js";
import { EvaluateMachineShutdownReadiness } from "../application/evaluate-machine-shutdown-readiness.js";
import type {
  MachineShutdownActiveTaskReadinessReader,
  MachineShutdownBackupReadinessReader,
  MachineShutdownConfirmationReader,
  MachineShutdownEventRecordingReadinessReader,
  MachineShutdownFilesystemReadinessReader,
  MachineShutdownServiceReadinessReader,
} from "../application/ports/machine-shutdown-readiness-readers.js";
import {
  MockMachineShutdownConfirmationReader,
  MockMachineShutdownReadinessReader,
  MockMachineShutdownServiceReadinessReader,
} from "../infrastructure/mock-machine-shutdown-readiness-readers.js";
import {
  ServiceManagementMachineShutdownReadinessReader,
  type PublicServiceManagementReadinessCapabilities,
} from "../infrastructure/service-management-machine-shutdown-readiness-reader.js";

export interface PowerManagementCapabilities {
  readonly getRtcInformation: GetRtcInformation;
  readonly getNextWakeAlarm: GetNextWakeAlarm;
  readonly scheduleWakeAlarm: ScheduleWakeAlarm;
  readonly cancelWakeAlarm: CancelWakeAlarm;
  readonly getMachinePowerPlan: GetMachinePowerPlan;
  readonly planNextMachineShutdownOccurrence: PlanNextMachineShutdownOccurrence;
  readonly executeMachineShutdownOccurrence: ExecuteMachineShutdownOccurrence;
  readonly runMachinePowerSchedulerTick: RunMachinePowerSchedulerTick;
  readonly evaluateMachineShutdownReadiness: EvaluateMachineShutdownReadiness;
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
  readonly machineShutdownOccurrenceClaimStore?: MachineShutdownOccurrenceClaimStore;
  readonly persistence?: unknown;
  readonly machineShutdownConfirmationReader?: MachineShutdownConfirmationReader;
  readonly machineShutdownServiceReadinessReader?: MachineShutdownServiceReadinessReader;
  readonly machineShutdownActiveTaskReadinessReader?: MachineShutdownActiveTaskReadinessReader;
  readonly machineShutdownBackupReadinessReader?: MachineShutdownBackupReadinessReader;
  readonly machineShutdownFilesystemReadinessReader?: MachineShutdownFilesystemReadinessReader;
  readonly machineShutdownEventRecordingReadinessReader?: MachineShutdownEventRecordingReadinessReader;
  readonly serviceManagementReadinessCapabilities?: PublicServiceManagementReadinessCapabilities;
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
  const persistence = validatePersistence(overrides.persistence);
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
  const getMachinePowerPlan = new GetMachinePowerPlan(
    clock,
    machineOperatingPolicy,
  );
  const claimStore =
    overrides.machineShutdownOccurrenceClaimStore ??
    createClaimStore(persistence);
  const cursorStore = createCursorStore(persistence);
  const readiness = new EvaluateMachineShutdownReadiness(clock, {
    confirmation:
      overrides.machineShutdownConfirmationReader ??
      new MockMachineShutdownConfirmationReader(),
    services:
      overrides.machineShutdownServiceReadinessReader ??
      (overrides.serviceManagementReadinessCapabilities
        ? new ServiceManagementMachineShutdownReadinessReader(
            overrides.serviceManagementReadinessCapabilities,
          )
        : new MockMachineShutdownServiceReadinessReader()),
    activeTasks:
      overrides.machineShutdownActiveTaskReadinessReader ??
      new MockMachineShutdownReadinessReader({
        area: "active_tasks",
        state: "ready",
      }),
    backups:
      overrides.machineShutdownBackupReadinessReader ??
      new MockMachineShutdownReadinessReader({
        area: "backups",
        state: "ready",
      }),
    filesystem:
      overrides.machineShutdownFilesystemReadinessReader ??
      new MockMachineShutdownReadinessReader({
        area: "filesystem",
        state: "ready",
      }),
    eventRecording:
      overrides.machineShutdownEventRecordingReadinessReader ??
      new MockMachineShutdownReadinessReader({
        area: "event_recording",
        state: "ready",
      }),
  });
  const executeMachineShutdownOccurrence = new ExecuteMachineShutdownOccurrence(
    clock,
    claimStore,
    wakeAlarmController,
    machineShutdownController,
    readiness,
  );
  const runMachinePowerSchedulerTick = new RunMachinePowerSchedulerTick(
    clock,
    machineOperatingPolicy,
    cursorStore,
    claimStore,
    executeMachineShutdownOccurrence,
  );

  const capabilities = {
    getRtcInformation: new GetRtcInformation(clock, rtcInformationReader),
    getNextWakeAlarm: new GetNextWakeAlarm(clock, wakeAlarmReader),
    scheduleWakeAlarm: new ScheduleWakeAlarm(clock, wakeAlarmController),
    cancelWakeAlarm: new CancelWakeAlarm(clock, wakeAlarmController),
    getMachinePowerPlan,
    planNextMachineShutdownOccurrence: new PlanNextMachineShutdownOccurrence(
      getMachinePowerPlan,
    ),
    executeMachineShutdownOccurrence,
    runMachinePowerSchedulerTick,
    evaluateMachineShutdownReadiness: readiness,
    requestMachineShutdown: new RequestMachineShutdown(
      clock,
      machineShutdownController,
    ),
  };

  return Object.freeze(capabilities);
}

function createClaimStore(
  persistence: PersistenceConfiguration | null,
): MachineShutdownOccurrenceClaimStore {
  if (persistence)
    return new FileMachineShutdownOccurrenceClaimStore(
      persistence.occurrenceClaimFilePath,
    );
  return new InMemoryMachineShutdownOccurrenceClaimStore();
}

function createCursorStore(
  persistence: PersistenceConfiguration | null,
): MachinePowerSchedulerCursorStore {
  if (persistence)
    return new FileMachinePowerSchedulerCursorStore(
      persistence.schedulerCursorFilePath,
    );
  return new InMemoryMachinePowerSchedulerCursorStore();
}

interface PersistenceConfiguration {
  readonly occurrenceClaimFilePath: string;
  readonly schedulerCursorFilePath: string;
}
class PowerManagementPersistenceConfigurationError extends Error {
  public override readonly name =
    "PowerManagementPersistenceConfigurationError";
  public constructor(public readonly code: "invalid_persistence") {
    super(`Invalid power-management persistence configuration: ${code}`);
    Object.freeze(this);
  }
}
function validatePersistence(input: unknown): PersistenceConfiguration | null {
  if (input === undefined) return null;
  if (typeof input !== "object" || input === null || Array.isArray(input))
    throw new PowerManagementPersistenceConfigurationError(
      "invalid_persistence",
    );
  const record = input as Record<string, unknown>;
  if (
    Reflect.ownKeys(record).length !== 2 ||
    typeof record["occurrenceClaimFilePath"] !== "string" ||
    typeof record["schedulerCursorFilePath"] !== "string"
  )
    throw new PowerManagementPersistenceConfigurationError(
      "invalid_persistence",
    );
  const claim = record["occurrenceClaimFilePath"];
  const cursor = record["schedulerCursorFilePath"];
  if (!isSafePath(claim) || !isSafePath(cursor) || claim === cursor)
    throw new PowerManagementPersistenceConfigurationError(
      "invalid_persistence",
    );
  return Object.freeze({
    occurrenceClaimFilePath: claim,
    schedulerCursorFilePath: cursor,
  });
}
function isSafePath(value: string): boolean {
  return (
    value.length > 0 &&
    value.trim() === value &&
    [...value].every((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code >= 0x20 && code !== 0x7f;
    })
  );
}

function createSystemClock(): PowerManagementClock {
  return Object.freeze({
    now: () => new Date(),
  });
}
