import { describe, expect, it, vi } from "vitest";

import { createAtlasHttpTransport } from "../../src/cli/http-transport.js";

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Atlas HTTP CLI transport", () => {
  it("reads public health endpoints without adding authentication headers", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(200, { status: "ok" }))
      .mockResolvedValueOnce(
        response(200, { status: "ok", uptimeSeconds: 12 }),
      );
    const transport = createAtlasHttpTransport({
      baseUrl: "http://127.0.0.1:3000",
      fetchImplementation,
    });

    await expect(
      transport.execute("health", [], new AbortController().signal),
    ).resolves.toEqual({
      endpoint: "127.0.0.1:3000",
      live: { status: "ok" },
      server: { status: "ok", uptimeSeconds: 12 },
    });
    expect(fetchImplementation).toHaveBeenNthCalledWith(
      1,
      new URL("http://127.0.0.1:3000/health/live"),
      expect.objectContaining({ headers: { accept: "application/json" } }),
    );
  });

  it("reports administrative authentication as a partial status", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(200, { status: "ok" }))
      .mockResolvedValueOnce(response(200, { status: "ok" }))
      .mockResolvedValueOnce(response(401, { error: "required" }));
    const transport = createAtlasHttpTransport({ fetchImplementation });

    await expect(
      transport.execute("status", [], new AbortController().signal),
    ).resolves.toMatchObject({
      atlasManager: { endpoint: "127.0.0.1:3000" },
      administrative: { status: "authentication_required" },
    });
  });

  it("rejects credentials embedded in the base URL", () => {
    expect(() =>
      createAtlasHttpTransport({ baseUrl: "http://user:pass@localhost" }),
    ).toThrow("must not contain credentials");
  });

  it("reads the protected machine plan through the overview endpoint", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValueOnce(
      response(200, {
        machinePlan: {
          mode: "simulation",
          nextTransition: null,
        },
      }),
    );
    const transport = createAtlasHttpTransport({ fetchImplementation });

    await expect(
      transport.execute("machine plan", [], new AbortController().signal),
    ).resolves.toEqual({
      mode: "simulation",
      nextTransition: null,
    });
    expect(fetchImplementation).toHaveBeenCalledWith(
      new URL("http://127.0.0.1:3000/admin/overview"),
      expect.objectContaining({ headers: { accept: "application/json" } }),
    );
  });

  it("projects backup status from the protected overview", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response(200, { backups: { schedulerState: "available" } }),
      );
    const transport = createAtlasHttpTransport({ fetchImplementation });

    await expect(
      transport.execute("backups status", [], new AbortController().signal),
    ).resolves.toEqual({ schedulerState: "available" });
  });

  it("projects the safe machine status from the protected overview", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValueOnce(
      response(200, {
        powerSafety: {
          backend: "mock",
          effects: "disabled",
          machineScheduler: "disabled",
        },
      }),
    );
    const transport = createAtlasHttpTransport({ fetchImplementation });

    await expect(
      transport.execute("machine status", [], new AbortController().signal),
    ).resolves.toEqual({
      backend: "mock",
      effects: "disabled",
      machineScheduler: "disabled",
    });
  });

  it("projects the validated machine schedule from the protected overview", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response(200, { machineSchedule: { mode: "always_on" } }),
      );
    const transport = createAtlasHttpTransport({ fetchImplementation });

    await expect(
      transport.execute(
        "machine schedule show",
        [],
        new AbortController().signal,
      ),
    ).resolves.toEqual({ mode: "always_on" });
  });
});
