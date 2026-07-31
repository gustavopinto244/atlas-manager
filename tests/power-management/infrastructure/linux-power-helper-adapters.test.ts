import { describe, expect, it } from "vitest";
import { LinuxPowerHelperAdapterError } from "../../../src/power-management/infrastructure/linux-power-helper-errors.js";
import {
  createLinuxPowerHelperAdapters,
  LinuxPowerHelperMachineShutdownController,
  LinuxPowerHelperRtcInformationReader,
  LinuxPowerHelperWakeAlarmController,
  LinuxPowerHelperWakeAlarmReader,
} from "../../../src/power-management/infrastructure/linux-power-helper-adapters.js";
import { InMemoryLinuxPowerHelperTransport } from "../../../src/power-management/infrastructure/in-memory-linux-power-helper-transport.js";

const requestedAt = "2026-08-01T12:00:00.000Z";
const firstAlarm = "2026-08-02T09:00:00.000Z";
const secondAlarm = "2026-08-03T09:00:00.000Z";

describe("Linux power-helper adapters", () => {
  it("maps RTC, independent wake reads, mutations, and shutdown acceptance", async () => {
    const transport = new InMemoryLinuxPowerHelperTransport({
      rtcTime: "2026-08-01T12:00:00.000Z",
    });
    const adapters = createLinuxPowerHelperAdapters({ transport });

    await expect(
      adapters.rtcInformationReader.read(requestedAt),
    ).resolves.toMatchObject({
      observedAt: requestedAt,
      rtcTime: requestedAt,
      wakeAlarm: { state: "not_scheduled" },
    });
    await expect(
      adapters.wakeAlarmReader.read(requestedAt),
    ).resolves.toMatchObject({
      observedAt: requestedAt,
      wakeAlarm: { state: "not_scheduled" },
    });
    await expect(
      adapters.wakeAlarmController.schedule(requestedAt, firstAlarm),
    ).resolves.toMatchObject({ outcome: "scheduled" });
    await expect(
      adapters.wakeAlarmReader.read(requestedAt),
    ).resolves.toMatchObject({
      wakeAlarm: { state: "scheduled", scheduledFor: firstAlarm },
    });
    await expect(
      adapters.wakeAlarmController.schedule(requestedAt, secondAlarm),
    ).resolves.toMatchObject({ outcome: "replaced" });
    await expect(
      adapters.wakeAlarmController.cancel(requestedAt),
    ).resolves.toMatchObject({
      outcome: "cancelled",
    });
    await expect(
      adapters.machineShutdownController.requestShutdown(requestedAt),
    ).resolves.toMatchObject({
      operation: "shutdown",
      requestedAt,
      outcome: "simulated",
    });

    expect(
      transport.invocations.map((invocation) => invocation.operation),
    ).toEqual([
      "read_rtc_information",
      "read_wake_alarm",
      "schedule_wake_alarm",
      "read_wake_alarm",
      "schedule_wake_alarm",
      "cancel_wake_alarm",
      "request_shutdown",
    ]);
    expect(transport.invocations[2]).toMatchObject({
      requestedAt,
      scheduledFor: firstAlarm,
    });
  });

  it("performs cancellation without a preliminary read", async () => {
    const transport = new InMemoryLinuxPowerHelperTransport({
      initialWakeAlarm: { state: "scheduled", scheduledFor: firstAlarm },
    });
    const controller = new LinuxPowerHelperWakeAlarmController(transport);
    await controller.cancel(requestedAt);
    expect(transport.invocations).toHaveLength(1);
    expect(transport.invocations[0]?.operation).toBe("cancel_wake_alarm");
  });

  it("translates helper rejection and transport failures safely", async () => {
    const rejected = new InMemoryLinuxPowerHelperTransport({
      responseByOperation: {
        request_shutdown: {
          version: 1,
          operation: "request_shutdown",
          outcome: "rejected",
          code: "operation_rejected",
        },
      },
    });
    await expect(
      new LinuxPowerHelperMachineShutdownController(rejected).requestShutdown(
        requestedAt,
      ),
    ).rejects.toEqual(
      new LinuxPowerHelperAdapterError("helper_operation_rejected"),
    );

    const failed = new InMemoryLinuxPowerHelperTransport({
      failure: new Error("raw transport details"),
    });
    await expect(
      new LinuxPowerHelperWakeAlarmReader(failed).read(requestedAt),
    ).rejects.toEqual(new LinuxPowerHelperAdapterError("helper_unavailable"));
  });

  it("rejects malformed fake responses instead of exposing them as domain results", async () => {
    const transport = new InMemoryLinuxPowerHelperTransport({
      responseByOperation: {
        read_wake_alarm: {
          version: 1,
          operation: "read_wake_alarm",
          outcome: "success",
          result: { state: "not_scheduled", unexpected: true },
        },
      },
    });
    await expect(
      new LinuxPowerHelperWakeAlarmReader(transport).read(requestedAt),
    ).rejects.toEqual(
      new LinuxPowerHelperAdapterError("helper_output_invalid"),
    );
  });

  it("returns a frozen bundle with stable instances", () => {
    const transport = new InMemoryLinuxPowerHelperTransport();
    const bundle = createLinuxPowerHelperAdapters({ transport });
    expect(Object.isFrozen(bundle)).toBe(true);
    expect(bundle.rtcInformationReader).toBeInstanceOf(
      LinuxPowerHelperRtcInformationReader,
    );
    expect(bundle.wakeAlarmReader).toBeInstanceOf(
      LinuxPowerHelperWakeAlarmReader,
    );
    expect(bundle.wakeAlarmController).toBeInstanceOf(
      LinuxPowerHelperWakeAlarmController,
    );
    expect(bundle.machineShutdownController).toBeInstanceOf(
      LinuxPowerHelperMachineShutdownController,
    );
    expect(bundle.rtcInformationReader).toBe(bundle.rtcInformationReader);
  });
});
