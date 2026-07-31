import { describe, expect, it } from "vitest";

import { createAdministrativeEventHistoryPage } from "../../../src/event-history/domain/administrative-event-history-page.js";
import { createAdministrativeEventHistoryQuery } from "../../../src/event-history/domain/administrative-event-history-query.js";
import { createAdministrativeEvent } from "../../../src/event-history/domain/administrative-event.js";

const event = createAdministrativeEvent({
  sequence: 3,
  attemptId: "00000000-0000-4000-8000-000000000003",
  occurredAt: "2026-08-01T12:00:00.000Z",
  source: { kind: "automated", actorId: "machine-power-scheduler" },
  target: { kind: "machine", id: "atlas" },
  operation: "run_machine_power_scheduler_tick",
  status: "succeeded",
  details: { schedulerOutcome: "idle" },
});

describe("administrative event-history query and page", () => {
  it("applies bounded defaults and freezes the page", () => {
    const query = createAdministrativeEventHistoryQuery();
    const page = createAdministrativeEventHistoryPage({
      events: [event],
      hasMore: true,
    });

    expect(query).toEqual({ afterSequence: 0, limit: 50 });
    expect(page.nextAfterSequence).toBe(3);
    expect(Object.isFrozen(query)).toBe(true);
    expect(Object.isFrozen(page)).toBe(true);
    expect(Object.isFrozen(page.events)).toBe(true);
  });

  it("validates cursor, limit, filters, and half-open time intervals", () => {
    expect(
      createAdministrativeEventHistoryQuery({
        afterSequence: 2,
        limit: 100,
        source: "automated",
        operation: "run_machine_power_scheduler_tick",
        status: "succeeded",
        attemptId: "00000000-0000-4000-8000-000000000003",
        occurredFrom: "2026-08-01T00:00:00.000Z",
        occurredTo: "2026-08-02T00:00:00.000Z",
      }),
    ).toMatchObject({ afterSequence: 2, limit: 100 });
    expect(() =>
      createAdministrativeEventHistoryQuery({ limit: 101 }),
    ).toThrow();
    expect(() =>
      createAdministrativeEventHistoryQuery({ afterSequence: -1 }),
    ).toThrow();
    expect(() =>
      createAdministrativeEventHistoryQuery({
        occurredFrom: "2026-08-02T00:00:00.000Z",
        occurredTo: "2026-08-01T00:00:00.000Z",
      }),
    ).toThrow();
    expect(() =>
      createAdministrativeEventHistoryQuery({ unknown: true }),
    ).toThrow();
    expect(() =>
      createAdministrativeEventHistoryQuery({ [Symbol("unknown")]: true }),
    ).toThrow();
  });

  it("omits the next cursor for an empty result", () => {
    const page = createAdministrativeEventHistoryPage({
      events: [],
      hasMore: false,
    });
    expect(page).toEqual({ events: [], hasMore: false });
    expect("nextAfterSequence" in page).toBe(false);
  });
});
