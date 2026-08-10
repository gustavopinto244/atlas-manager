import { describe, expect, it } from "vitest";

import {
  controlOperationsFor,
  supportsLogs,
  statusChipModifier,
} from "../../src/dashboard/service-operations.js";

describe("controlOperationsFor", () => {
  it("returns only the control operations the service supports, in canonical order", () => {
    expect(
      controlOperationsFor({
        supportedOperations: ["restart", "readStatus", "start"],
      }),
    ).toEqual(["start", "restart"]);
  });

  it("returns an empty list for a read-only service", () => {
    expect(
      controlOperationsFor({ supportedOperations: ["readStatus"] }),
    ).toEqual([]);
  });

  it("returns an empty list when supportedOperations is missing or malformed", () => {
    expect(controlOperationsFor({})).toEqual([]);
    expect(controlOperationsFor({ supportedOperations: "start" })).toEqual([]);
    expect(controlOperationsFor({ supportedOperations: [42, null] })).toEqual(
      [],
    );
  });

  it("returns all three control operations when fully supported", () => {
    expect(
      controlOperationsFor({
        supportedOperations: ["readStatus", "start", "stop", "restart"],
      }),
    ).toEqual(["start", "stop", "restart"]);
  });
});

describe("supportsLogs", () => {
  it("is true only when readLogs is present", () => {
    expect(supportsLogs({ supportedOperations: ["readLogs"] })).toBe(true);
    expect(supportsLogs({ supportedOperations: ["readStatus"] })).toBe(false);
    expect(supportsLogs({})).toBe(false);
  });
});

describe("statusChipModifier", () => {
  it.each([
    ["running", "online"],
    ["stopped", "offline"],
    ["failed", "unavailable"],
    ["unknown", "degraded"],
  ])("maps backend state %s to chip modifier %s", (status, modifier) => {
    expect(statusChipModifier(status)).toBe(modifier);
  });

  it("treats an unrecognized or missing status as degraded rather than online", () => {
    expect(statusChipModifier("something-new")).toBe("degraded");
    expect(statusChipModifier(undefined)).toBe("degraded");
    expect(statusChipModifier(null)).toBe("degraded");
  });
});
