import { describe, expect, it } from "vitest";

import {
  fromDomainWindows,
  readMachinePolicy,
  toDomainWindows,
} from "../../src/dashboard/machine-schedule-editor.js";

describe("toDomainWindows / fromDomainWindows", () => {
  it("round-trips between the editor's `weekday` field and the domain's `dayOfWeek` field", () => {
    const editorWindows = [
      { weekday: "monday", start: "08:00", end: "18:00" },
      { weekday: "friday", start: "09:00", end: "12:00" },
    ];
    const domainWindows = toDomainWindows(editorWindows);
    expect(domainWindows).toEqual([
      { dayOfWeek: "monday", start: "08:00", end: "18:00" },
      { dayOfWeek: "friday", start: "09:00", end: "12:00" },
    ]);
    expect(fromDomainWindows(domainWindows)).toEqual(editorWindows);
  });

  it("drops malformed entries rather than throwing", () => {
    expect(fromDomainWindows("not an array")).toEqual([]);
    expect(
      fromDomainWindows([
        { dayOfWeek: "monday", start: "08:00", end: "18:00" },
        { dayOfWeek: "monday", start: 8 },
        null,
        "garbage",
      ]),
    ).toEqual([{ weekday: "monday", start: "08:00", end: "18:00" }]);
  });
});

describe("readMachinePolicy", () => {
  it("falls back to always_on/America/Sao_Paulo/no-windows for unrecognized input", () => {
    expect(readMachinePolicy(undefined)).toEqual({
      mode: "always_on",
      timezone: "America/Sao_Paulo",
      windows: [],
    });
    expect(readMachinePolicy(null)).toEqual({
      mode: "always_on",
      timezone: "America/Sao_Paulo",
      windows: [],
    });
    expect(readMachinePolicy("garbage")).toEqual({
      mode: "always_on",
      timezone: "America/Sao_Paulo",
      windows: [],
    });
  });

  it("reads a plain policy object, as the overview's machineSchedule field provides", () => {
    expect(
      readMachinePolicy({
        mode: "scheduled",
        timezone: "America/Sao_Paulo",
        weeklySchedule: {
          windows: [{ dayOfWeek: "monday", start: "08:00", end: "18:00" }],
        },
      }),
    ).toEqual({
      mode: "scheduled",
      timezone: "America/Sao_Paulo",
      windows: [{ weekday: "monday", start: "08:00", end: "18:00" }],
    });
  });

  it("reads a wrapped {policy, source} object, as GET /admin/machine/schedule provides", () => {
    expect(
      readMachinePolicy({
        policy: { mode: "manual" },
        source: "environment_default",
      }),
    ).toEqual({
      mode: "manual",
      timezone: "America/Sao_Paulo",
      windows: [],
    });
  });
});
