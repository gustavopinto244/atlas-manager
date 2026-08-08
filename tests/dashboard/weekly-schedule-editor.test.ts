import { describe, expect, it } from "vitest";

import { validateWeeklyEditorWindows } from "../../src/dashboard/weekly-schedule-editor.js";

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
