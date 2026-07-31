import { describe, expect, it } from "vitest";

import { createEventHistory } from "../../../src/event-history/composition/create-event-history.js";
import { InMemoryAdministrativeEventHistory } from "../../../src/event-history/infrastructure/in-memory-administrative-event-history.js";

describe("createEventHistory", () => {
  it("returns three frozen stable capabilities without doing work during construction", async () => {
    const capabilities = createEventHistory();
    const record = capabilities.recordAdministrativeEvent;
    expect(Object.isFrozen(capabilities)).toBe(true);
    expect(capabilities.recordAdministrativeEvent).toBe(record);
    expect(Object.isFrozen(record)).toBe(true);
    await expect(
      capabilities.checkAdministrativeEventHistoryReadiness.execute(),
    ).resolves.toEqual({ outcome: "ready" });
  });

  it("shares an explicitly supplied store for recording, readiness, and queries", async () => {
    const store = new InMemoryAdministrativeEventHistory();
    const capabilities = createEventHistory({
      recorder: store,
      reader: store,
      readiness: store,
    });
    await capabilities.recordAdministrativeEvent.execute({
      attemptId: "00000000-0000-4000-8000-000000000001",
      occurredAt: "2026-08-01T12:00:00.000Z",
      source: { kind: "system", actorId: "atlas-manager" },
      target: { kind: "machine", id: "atlas" },
      operation: "request_machine_shutdown",
      status: "started",
    });
    await expect(
      capabilities.getAdministrativeEventHistory.execute(),
    ).resolves.toMatchObject({
      events: [{ sequence: 1 }],
    });
  });

  it("accepts explicit file persistence configuration without selecting an implicit path", () => {
    expect(() =>
      createEventHistory({ filePath: "relative-events.jsonl" }),
    ).toThrow();
    expect(() => createEventHistory({ persistence: {} })).toThrow();
  });
});
