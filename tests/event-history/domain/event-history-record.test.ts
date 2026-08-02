import { describe, expect, it } from "vitest";
import {
  createNextEventHistoryRecord,
  serializeEventHistoryRecord,
  serializeEventHistoryRecordForHash,
} from "../../../src/event-history/domain/event-history-record.js";

describe("version-two event-history record", () => {
  it("keeps the canonical golden encoding stable", () => {
    const record = createNextEventHistoryRecord(
      {
        sequence: 1,
        attemptId: "00000000-0000-4000-8000-000000000001",
        occurredAt: "2026-08-02T12:00:00.000Z",
        source: { kind: "administrative", actorId: "unattributed-local" },
        target: { kind: "machine", id: "atlas" },
        operation: "authorize_administrative_operation",
        status: "succeeded",
        details: {
          requestedOperation: "read_wake_alarm",
          permission: "power.wake.read",
          decision: "allowed",
        },
      },
      "0".repeat(64),
    );
    expect(serializeEventHistoryRecordForHash(record)).toBe(
      '{"event":{"attemptId":"00000000-0000-4000-8000-000000000001","details":{"decision":"allowed","permission":"power.wake.read","requestedOperation":"read_wake_alarm"},"occurredAt":"2026-08-02T12:00:00.000Z","operation":"authorize_administrative_operation","sequence":1,"source":{"actorId":"unattributed-local","kind":"administrative"},"status":"succeeded","target":{"id":"atlas","kind":"machine"}},"previousRecordSha256":"0000000000000000000000000000000000000000000000000000000000000000","schemaVersion":2,"sequence":1}',
    );
    expect(serializeEventHistoryRecord(record)).toBe(
      '{"event":{"attemptId":"00000000-0000-4000-8000-000000000001","details":{"decision":"allowed","permission":"power.wake.read","requestedOperation":"read_wake_alarm"},"occurredAt":"2026-08-02T12:00:00.000Z","operation":"authorize_administrative_operation","sequence":1,"source":{"actorId":"unattributed-local","kind":"administrative"},"status":"succeeded","target":{"id":"atlas","kind":"machine"}},"previousRecordSha256":"0000000000000000000000000000000000000000000000000000000000000000","recordSha256":"78eea42638180c1c57e25290776652253c9ebda96cd2517e7ef88d361dc05092","schemaVersion":2,"sequence":1}\n',
    );
  });
});
