import { describe, expect, it, vi } from "vitest";

import { createAtlasHttpTransport } from "../../src/cli/http-transport.js";

describe("atlas doctor", () => {
  it("returns individual failures without hiding passing health checks", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
      .mockResolvedValueOnce(new Response("{}", { status: 403 }))
      .mockResolvedValueOnce(new Response("{}", { status: 403 }));
    const transport = createAtlasHttpTransport({ fetchImplementation });

    await expect(
      transport.execute("doctor", [], new AbortController().signal),
    ).resolves.toEqual({
      endpoint: "127.0.0.1:3000",
      status: "partial",
      checks: [
        { name: "atlas_health_live", status: "pass" },
        { name: "atlas_health_server", status: "pass" },
        {
          name: "administrative_overview",
          status: "fail",
          code: "administrative_access_denied",
        },
        {
          name: "administrative_security_posture",
          status: "fail",
          code: "administrative_access_denied",
        },
      ],
    });
  });
});
