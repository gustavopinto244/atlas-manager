import { describe, expect, it } from "vitest";
import {
  createCancelWakeAlarmRequest,
  createLinuxPowerHelperRequest,
  createLinuxPowerHelperResponse,
  createReadRtcInformationRequest,
  createReadWakeAlarmRequest,
  createRequestShutdownRequest,
  createScheduleWakeAlarmRequest,
  LinuxPowerHelperProtocolError,
  parseLinuxPowerHelperResponse,
  serializeLinuxPowerHelperRequest,
} from "../../../src/power-management/domain/linux-power-helper-protocol.js";

const requestedAt = "2026-08-01T12:00:00.000Z";
const scheduledFor = "2026-08-02T09:00:00.000Z";

describe("Linux power-helper protocol", () => {
  it("creates every supported immutable request", () => {
    const requests = [
      createReadRtcInformationRequest(requestedAt),
      createReadWakeAlarmRequest(requestedAt),
      createScheduleWakeAlarmRequest(requestedAt, scheduledFor),
      createCancelWakeAlarmRequest(requestedAt),
      createRequestShutdownRequest(requestedAt),
    ];

    expect(requests.map((request) => request.operation)).toEqual([
      "read_rtc_information",
      "read_wake_alarm",
      "schedule_wake_alarm",
      "cancel_wake_alarm",
      "request_shutdown",
    ]);
    for (const request of requests) expect(Object.isFrozen(request)).toBe(true);
  });

  it("rejects unknown fields, operations, versions, and scheduling ranges", () => {
    expect(() =>
      createLinuxPowerHelperRequest({
        version: 1,
        operation: "read_wake_alarm",
        requestedAt,
        extra: true,
      }),
    ).toThrowError(LinuxPowerHelperProtocolError);
    expect(() =>
      createLinuxPowerHelperRequest({
        version: 1,
        operation: "READ_WAKE_ALARM",
        requestedAt,
      }),
    ).toThrowError(LinuxPowerHelperProtocolError);
    expect(() =>
      createLinuxPowerHelperRequest({
        version: 2,
        operation: "read_wake_alarm",
        requestedAt,
      }),
    ).toThrowError("unsupported_version");
    expect(() =>
      createScheduleWakeAlarmRequest(requestedAt, requestedAt),
    ).toThrowError("invalid_schedule_range");
    expect(() =>
      createScheduleWakeAlarmRequest(" 2026-08-01T12:00:00.000Z", scheduledFor),
    ).toThrowError("invalid_requested_at");
  });

  it("serializes with stable ordering, one newline, and UTF-8 bounds", () => {
    const request = createScheduleWakeAlarmRequest(requestedAt, scheduledFor);
    const first = serializeLinuxPowerHelperRequest(request);
    const second = serializeLinuxPowerHelperRequest(request);
    expect(first).toBe(second);
    expect(first).toBe(
      `{"version":1,"operation":"schedule_wake_alarm","requestedAt":"${requestedAt}","scheduledFor":"${scheduledFor}"}\n`,
    );
    expect(first.endsWith("\n")).toBe(true);
    expect(first.split("\n")).toHaveLength(2);
  });

  it("validates each successful response through project-owned result shapes", () => {
    const rtc = createLinuxPowerHelperResponse(
      {
        version: 1,
        operation: "read_rtc_information",
        outcome: "success",
        result: {
          rtcTime: "2026-08-01T12:00:00.000Z",
          wakeAlarm: { state: "scheduled", scheduledFor },
        },
      },
      createReadRtcInformationRequest(requestedAt),
    );
    expect(rtc.outcome).toBe("success");
    expect(Object.isFrozen(rtc)).toBe(true);
    if (rtc.outcome === "success") {
      expect(Object.isFrozen(rtc.result)).toBe(true);
    }

    const mutation = createLinuxPowerHelperResponse(
      {
        version: 1,
        operation: "schedule_wake_alarm",
        outcome: "success",
        result: {
          before: { state: "not_scheduled" },
          after: { state: "scheduled", scheduledFor },
          outcome: "scheduled",
        },
      },
      createScheduleWakeAlarmRequest(requestedAt, scheduledFor),
    );
    expect(mutation.outcome).toBe("success");
  });

  it("validates rejected and failed responses without accepting raw details", () => {
    expect(
      createLinuxPowerHelperResponse({
        version: 1,
        operation: "request_shutdown",
        outcome: "rejected",
        code: "operation_rejected",
      }),
    ).toMatchObject({ outcome: "rejected", code: "operation_rejected" });
    expect(() =>
      createLinuxPowerHelperResponse({
        version: 1,
        operation: "request_shutdown",
        outcome: "failed",
        code: "raw_errno",
      }),
    ).toThrowError("invalid_code");
    expect(() =>
      createLinuxPowerHelperResponse(
        {
          version: 1,
          operation: "request_shutdown",
          outcome: "success",
          result: { accepted: true },
        },
        "read_wake_alarm",
      ),
    ).toThrowError("operation_mismatch");
  });

  it("rejects malformed, multiple, and trailing response data", () => {
    expect(() =>
      parseLinuxPowerHelperResponse(Buffer.alloc(0), "read_wake_alarm"),
    ).toThrowError("empty_response");
    expect(() =>
      parseLinuxPowerHelperResponse(Buffer.from("{}\n{}\n"), "read_wake_alarm"),
    ).toThrowError("multiple_response_lines");
    expect(() =>
      parseLinuxPowerHelperResponse(
        Buffer.from("{} trailing"),
        "read_wake_alarm",
      ),
    ).toThrowError("invalid_response");
    expect(() =>
      parseLinuxPowerHelperResponse(Buffer.from([0xff]), "read_wake_alarm"),
    ).toThrowError("invalid_utf8");
  });
});
