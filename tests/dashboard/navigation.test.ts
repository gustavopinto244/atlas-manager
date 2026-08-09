import { describe, expect, it } from "vitest";

import { DASHBOARD_PAGES } from "../../src/dashboard/navigation.js";

describe("dashboard navigation contract", () => {
  it("exposes the planned operational sections in stable order", () => {
    expect(DASHBOARD_PAGES.map(([page]) => page)).toEqual([
      "overview",
      "services",
      "schedules",
      "machine",
      "backups",
      "events",
      "infrastructure",
      "settings",
    ]);
  });
});
