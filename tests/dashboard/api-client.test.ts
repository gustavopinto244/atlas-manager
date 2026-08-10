import { describe, expect, it } from "vitest";

import {
  AdministrativeApiClient,
  describeAdministrativeFailure,
  hasRecordArray,
  isRecord,
} from "../../src/dashboard/api-client.js";

function respondWith(
  status: number,
  body: unknown,
  options: Readonly<{ malformed?: boolean }> = {},
): AdministrativeApiClient {
  return new AdministrativeApiClient({
    fetch: () =>
      Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        json: () =>
          options.malformed === true
            ? Promise.reject(new Error("invalid json"))
            : Promise.resolve(body),
      } as unknown as Response),
  });
}

describe("AdministrativeApiClient", () => {
  it("returns the decoded value on success", async () => {
    const client = respondWith(200, { services: [] });
    const result = await client.read("/admin/services");
    expect(result).toEqual({ outcome: "success", value: { services: [] } });
  });

  it("maps transport status codes to distinct outcomes", async () => {
    const cases: readonly (readonly [number, string])[] = [
      [401, "unauthorized"],
      [403, "forbidden"],
      [409, "busy"],
      [429, "busy"],
      [500, "unavailable"],
      [503, "unavailable"],
      [404, "unavailable"],
    ];
    for (const [status, outcome] of cases) {
      const result = await respondWith(status, {}).read("/admin/overview");
      expect(result.outcome, `status ${status}`).toBe(outcome);
    }
  });

  it("reports malformed JSON as invalid_response rather than an empty state", async () => {
    const client = respondWith(200, undefined, { malformed: true });
    const result = await client.read("/admin/services");
    expect(result.outcome).toBe("invalid_response");
  });

  it("reports a malformed DTO as invalid_response rather than an empty state", async () => {
    const client = respondWith(200, { services: "not-an-array" });
    const result = await client.read(
      "/admin/services",
      hasRecordArray("services"),
    );
    expect(result.outcome).toBe("invalid_response");
  });

  it("accepts a well formed but empty collection as success", async () => {
    const client = respondWith(200, { services: [] });
    const result = await client.read(
      "/admin/services",
      hasRecordArray("services"),
    );
    expect(result.outcome).toBe("success");
  });

  it("reports a rejected request as network_error", async () => {
    const client = new AdministrativeApiClient({
      fetch: () => Promise.reject(new Error("offline")),
    });
    const result = await client.read("/admin/overview");
    expect(result.outcome).toBe("network_error");
  });

  it("describes every failure outcome distinctly", () => {
    const outcomes = [
      "unauthorized",
      "forbidden",
      "busy",
      "unavailable",
      "invalid_response",
      "network_error",
    ] as const;
    const messages = outcomes.map((outcome) =>
      describeAdministrativeFailure(outcome),
    );
    expect(new Set(messages).size).toBe(outcomes.length);
    expect(messages.every((message) => message.length > 0)).toBe(true);
  });

  it("rejects arrays and null as records", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
  });
});
