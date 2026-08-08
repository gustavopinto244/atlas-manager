import { describe, expect, it } from "vitest";

import { SCHEDULE_WEEKDAYS } from "../../src/dashboard/schedule-view.js";

describe("dashboard schedule view", () => {
  it("uses the domain weekday order for the weekly timeline", () => {
    expect(SCHEDULE_WEEKDAYS).toEqual([
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
      "sunday",
    ]);
  });
});
