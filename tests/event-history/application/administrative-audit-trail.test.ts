import { describe, expect, it } from "vitest";

import { AdministrativeAuditTrail } from "../../../src/event-history/application/administrative-audit-trail.js";
import { InMemoryAdministrativeEventAttemptIdGenerator } from "../../../src/event-history/infrastructure/in-memory-administrative-event-attempt-id-generator.js";
import { InMemoryAdministrativeEventHistory } from "../../../src/event-history/infrastructure/in-memory-administrative-event-history.js";

const OCCURRED_AT = "2026-08-01T12:00:00.000Z";
const SOURCE = {
  kind: "administrative" as const,
  actorId: "unattributed-local" as const,
};
const TARGET = { kind: "machine" as const, id: "atlas" as const };

describe("AdministrativeAuditTrail", () => {
  it("generates one internal attempt ID and records started then terminal events", async () => {
    const store = new InMemoryAdministrativeEventHistory();
    const audit = new AdministrativeAuditTrail(
      store,
      new InMemoryAdministrativeEventAttemptIdGenerator([
        "00000000-0000-4000-8000-000000000001",
      ]),
    );
    const attempt = await audit.begin({
      occurredAt: OCCURRED_AT,
      source: SOURCE,
      target: TARGET,
      operation: "cancel_wake_alarm",
    });
    const terminal = await audit.complete(attempt, "succeeded", {
      mutationOutcome: "cancelled",
    });
    expect(attempt.attemptId).toBe("00000000-0000-4000-8000-000000000001");
    expect(attempt.started.sequence).toBe(1);
    expect(terminal.sequence).toBe(2);
    expect(terminal.attemptId).toBe(attempt.attemptId);
    expect(terminal.occurredAt).toBe(OCCURRED_AT);
  });

  it("maps recorder failures to safe audit errors", async () => {
    const store = new InMemoryAdministrativeEventHistory({
      recordFailure: new Error("raw"),
    });
    const audit = new AdministrativeAuditTrail(
      store,
      new InMemoryAdministrativeEventAttemptIdGenerator([
        "00000000-0000-4000-8000-000000000001",
      ]),
    );
    await expect(
      audit.begin({
        occurredAt: OCCURRED_AT,
        source: SOURCE,
        target: TARGET,
        operation: "cancel_wake_alarm",
      }),
    ).rejects.toMatchObject({
      code: "administrative_audit_failed",
    });
  });
});
