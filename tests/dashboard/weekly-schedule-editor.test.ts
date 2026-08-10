import { describe, expect, it } from "vitest";

import {
  buildSchedulePreviewQuery,
  clearDayWindow,
  copyWindowToDays,
  validateWeeklyEditorWindows,
} from "../../src/dashboard/weekly-schedule-editor.js";

describe("weekly schedule editor contract", () => {
  it("rejects reversed times and accepts a valid window", () => {
    expect(
      validateWeeklyEditorWindows(
        [{ weekday: "monday", start: "18:00", end: "08:00" }],
        "America/Sao_Paulo",
      ),
    ).toBe("Start time must be before end time.");
    expect(
      validateWeeklyEditorWindows(
        [{ weekday: "monday", start: "08:00", end: "18:00" }],
        "America/Sao_Paulo",
      ),
    ).toBeNull();
  });

  it("rejects invalid weekdays and empty schedules", () => {
    expect(validateWeeklyEditorWindows([], "America/Sao_Paulo")).toContain(
      "at least one",
    );
    expect(
      validateWeeklyEditorWindows(
        [{ weekday: "mondayx", start: "08:00", end: "18:00" }],
        "America/Sao_Paulo",
      ),
    ).toContain("Weekday");
  });
});

describe("copyWindowToDays", () => {
  it("copies the source day's window onto each target, replacing what was there", () => {
    const windows = [
      { weekday: "monday", start: "09:00", end: "17:00" },
      { weekday: "tuesday", start: "10:00", end: "12:00" },
    ];
    const result = copyWindowToDays(windows, "monday", [
      "tuesday",
      "wednesday",
    ]);
    expect(result).toEqual(
      expect.arrayContaining([
        { weekday: "monday", start: "09:00", end: "17:00" },
        { weekday: "tuesday", start: "09:00", end: "17:00" },
        { weekday: "wednesday", start: "09:00", end: "17:00" },
      ]),
    );
    expect(result).toHaveLength(3);
  });

  it("never copies the source day onto itself even if included as a target", () => {
    const windows = [{ weekday: "monday", start: "09:00", end: "17:00" }];
    const result = copyWindowToDays(windows, "monday", ["monday", "tuesday"]);
    expect(result).toEqual(
      expect.arrayContaining([
        { weekday: "monday", start: "09:00", end: "17:00" },
        { weekday: "tuesday", start: "09:00", end: "17:00" },
      ]),
    );
    expect(result).toHaveLength(2);
  });

  it("returns the original windows unchanged when the source day has no window", () => {
    const windows = [{ weekday: "monday", start: "09:00", end: "17:00" }];
    expect(copyWindowToDays(windows, "friday", ["tuesday"])).toBe(windows);
  });
});

describe("clearDayWindow", () => {
  it("removes only the given weekday's window", () => {
    const windows = [
      { weekday: "monday", start: "09:00", end: "17:00" },
      { weekday: "tuesday", start: "09:00", end: "17:00" },
    ];
    expect(clearDayWindow(windows, "monday")).toEqual([
      { weekday: "tuesday", start: "09:00", end: "17:00" },
    ]);
  });
});

describe("buildSchedulePreviewQuery", () => {
  it("serializes the candidate policy as JSON in the query string", () => {
    const query = buildSchedulePreviewQuery({
      policy: { mode: "always" },
      startsAt: "2026-01-01T00:00:00.000Z",
      endsAt: "2026-01-02T00:00:00.000Z",
    });
    const params = new URLSearchParams(query);
    expect(params.get("startsAt")).toBe("2026-01-01T00:00:00.000Z");
    expect(params.get("endsAt")).toBe("2026-01-02T00:00:00.000Z");
    expect(JSON.parse(params.get("policy")!)).toEqual({ mode: "always" });
  });
});
