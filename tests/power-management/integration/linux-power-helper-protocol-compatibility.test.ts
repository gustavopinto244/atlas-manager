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
