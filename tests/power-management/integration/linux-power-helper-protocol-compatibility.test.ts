import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createLinuxPowerHelperRequest,
  parseLinuxPowerHelperResponse,
  serializeLinuxPowerHelperRequest,
} from "../../../src/power-management/domain/linux-power-helper-protocol.js";

const directory = dirname(fileURLToPath(import.meta.url));
const corpus = join(directory, "../../../power-helper/testdata/protocol");

const operations = [
  "read_rtc_information",
  "read_wake_alarm",
  "schedule_wake_alarm",
  "cancel_wake_alarm",
  "request_shutdown",
] as const;

describe("cross-language Linux power-helper protocol corpus", () => {
  it("serializes the shared valid requests byte-for-byte", () => {
    for (const operation of operations) {
      const source = readFileSync(
        join(corpus, "valid", `${operation}.json`),
        "utf8",
      );
      const request = createLinuxPowerHelperRequest(
        JSON.parse(source) as unknown,
      );
      expect(serializeLinuxPowerHelperRequest(request)).toBe(source);
    }
  });

  it("accepts every canonical deny-all response fixture", () => {
    for (const operation of operations) {
      const response = readFileSync(
        join(corpus, "responses", `${operation}.json`),
        "utf8",
      );
      expect(parseLinuxPowerHelperResponse(response, operation)).toEqual({
        version: 1,
        operation,
        outcome: "rejected",
        code: "operation_unsupported",
      });
    }
  });

  it("accepts every canonical read-success response fixture", () => {
    const fixtures = [
      ["read_rtc_information_unsupported.json", "read_rtc_information"],
      ["read_rtc_information_not_scheduled.json", "read_rtc_information"],
      ["read_rtc_information_scheduled.json", "read_rtc_information"],
      ["read_wake_alarm_unsupported.json", "read_wake_alarm"],
      ["read_wake_alarm_not_scheduled.json", "read_wake_alarm"],
      ["read_wake_alarm_scheduled.json", "read_wake_alarm"],
    ] as const;
    for (const [name, operation] of fixtures) {
      const response = readFileSync(
        join(corpus, "responses", "success", name),
        "utf8",
      );
      expect(parseLinuxPowerHelperResponse(response, operation)).toEqual(
        JSON.parse(response),
      );
    }
  });

  it("accepts every canonical mutation-success response fixture", () => {
    const fixtures = [
      ["schedule_wake_alarm_scheduled.json", "schedule_wake_alarm"],
      ["schedule_wake_alarm_replaced.json", "schedule_wake_alarm"],
      ["schedule_wake_alarm_unchanged.json", "schedule_wake_alarm"],
      ["cancel_wake_alarm_cancelled.json", "cancel_wake_alarm"],
      ["cancel_wake_alarm_not_scheduled.json", "cancel_wake_alarm"],
    ] as const;
    for (const [name, operation] of fixtures) {
      const response = readFileSync(
        join(corpus, "responses", "success", name),
        "utf8",
      );
      expect(parseLinuxPowerHelperResponse(response, operation)).toEqual(
        JSON.parse(response),
      );
    }
  });

  it("rejects invalid read-success response fixtures", () => {
    const fixtures = [
      ["read_wake_alarm_scheduled_missing_timestamp.json", "read_wake_alarm"],
      ["read_rtc_information_with_code.json", "read_rtc_information"],
      ["read_wake_alarm_with_result_on_failure.json", "read_wake_alarm"],
    ] as const;
    for (const [name, operation] of fixtures) {
      const response = readFileSync(
        join(corpus, "responses", "invalid", name),
        "utf8",
      );
      expect(() =>
        parseLinuxPowerHelperResponse(response, operation),
      ).toThrow();
    }
  });

  it("rejects invalid mutation-success response fixtures", () => {
    const fixtures = [
      ["schedule_wake_alarm_cancelled.json", "schedule_wake_alarm"],
      ["cancel_wake_alarm_scheduled.json", "cancel_wake_alarm"],
      ["schedule_wake_alarm_replaced_same.json", "schedule_wake_alarm"],
      ["cancel_wake_alarm_scheduled_after.json", "cancel_wake_alarm"],
      ["schedule_wake_alarm_missing_timestamp.json", "schedule_wake_alarm"],
      ["schedule_wake_alarm_with_code.json", "schedule_wake_alarm"],
      ["cancel_wake_alarm_with_result_on_failure.json", "cancel_wake_alarm"],
    ] as const;
    for (const [name, operation] of fixtures) {
      const response = readFileSync(
        join(corpus, "responses", "invalid", name),
        "utf8",
      );
      expect(() =>
        parseLinuxPowerHelperResponse(response, operation),
      ).toThrow();
    }
  });

  it.skipIf(!process.env.ATLAS_MANAGER_POWER_HELPER_FIXTURE)(
    "round-trips read requests through the deterministic Go fixture",
    () => {
      const fixture = process.env.ATLAS_MANAGER_POWER_HELPER_FIXTURE;
      if (!fixture) {
        throw new Error("fixture path is required");
      }
      for (const operation of [
        "read_rtc_information",
        "read_wake_alarm",
      ] as const) {
        const source = readFileSync(
          join(corpus, "valid", `${operation}.json`),
          "utf8",
        );
        const request = createLinuxPowerHelperRequest(
          JSON.parse(source) as unknown,
        );
        const result = spawnSync(fixture, {
          input: Buffer.from(serializeLinuxPowerHelperRequest(request), "utf8"),
          encoding: "buffer",
          maxBuffer: 16_384,
          timeout: 5_000,
        });
        expect(result.status).toBe(0);
        expect(result.stderr).toEqual(Buffer.alloc(0));
        const expected =
          operation === "read_rtc_information"
            ? '{"version":1,"operation":"read_rtc_information","outcome":"success","result":{"rtcTime":"2026-08-01T18:00:00.000Z","wakeAlarm":{"state":"not_scheduled"}}}\n'
            : '{"version":1,"operation":"read_wake_alarm","outcome":"success","result":{"state":"not_scheduled"}}\n';
        expect(result.stdout.toString("utf8")).toBe(expected);
        expect(parseLinuxPowerHelperResponse(result.stdout, operation)).toEqual(
          {
            version: 1,
            operation,
            outcome: "success",
            result:
              operation === "read_rtc_information"
                ? {
                    rtcTime: "2026-08-01T18:00:00.000Z",
                    wakeAlarm: { state: "not_scheduled" },
                  }
                : {
                    state: "not_scheduled",
                  },
          },
        );
      }
    },
  );

  it.skipIf(!process.env.ATLAS_MANAGER_POWER_HELPER_FIXTURE)(
    "round-trips mutation requests through the deterministic Go fixture",
    () => {
      const fixture = process.env.ATLAS_MANAGER_POWER_HELPER_FIXTURE;
      if (!fixture) {
        throw new Error("fixture path is required");
      }
      const cases = [
        [
          "schedule_wake_alarm",
          '{"version":1,"operation":"schedule_wake_alarm","outcome":"success","result":{"before":{"state":"not_scheduled"},"after":{"state":"scheduled","scheduledFor":"2026-08-02T09:00:00.000Z"},"outcome":"scheduled"}}\n',
        ],
        [
          "cancel_wake_alarm",
          '{"version":1,"operation":"cancel_wake_alarm","outcome":"success","result":{"before":{"state":"not_scheduled"},"after":{"state":"not_scheduled"},"outcome":"not_scheduled"}}\n',
        ],
      ] as const;
      for (const [operation, expected] of cases) {
        const source = readFileSync(
          join(corpus, "valid", `${operation}.json`),
          "utf8",
        );
        const request = createLinuxPowerHelperRequest(
          JSON.parse(source) as unknown,
        );
        const result = spawnSync(fixture, {
          input: Buffer.from(serializeLinuxPowerHelperRequest(request), "utf8"),
          encoding: "buffer",
          maxBuffer: 16_384,
          timeout: 5_000,
        });
        expect(result.status).toBe(0);
        expect(result.stderr).toEqual(Buffer.alloc(0));
        expect(result.stdout.toString("utf8")).toBe(expected);
        expect(parseLinuxPowerHelperResponse(result.stdout, operation)).toEqual(
          JSON.parse(expected),
        );
      }
    },
  );

  it("keeps the shared invalid corpus available to the TypeScript suite", () => {
    const invalidNames = [
      "empty",
      "invalid-utf8.hex",
      "missing-newline",
      "unknown-field",
      "duplicate-field",
      "array",
      "primitive",
      "invalid-version",
      "unknown-operation",
      "invalid-timestamp",
      "nonfuture-schedule",
      "nested-value",
      "multiple-lines",
      "trailing-data",
    ];
    for (const name of invalidNames) {
      const fixture = readFileSync(
        join(corpus, "invalid", name.endsWith(".hex") ? name : `${name}.json`),
      );
      expect(name === "empty" || fixture.length > 0).toBe(true);
    }

    expect(() =>
      createLinuxPowerHelperRequest({
        version: 1,
        operation: "read_wake_alarm",
        requestedAt: "2026-08-01T12:00:00.000Z",
        extra: true,
      }),
    ).toThrow();
  });
});
