import { describe, expect, it, vi } from "vitest";

import { createAtlasHttpTransport } from "../../src/cli/http-transport.js";

/** Extracts a request URL without relying on default stringification. */
function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

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

  it("includes the protected security posture in doctor checks", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => response(200, { status: "ok" }));
    const transport = createAtlasHttpTransport({ fetchImplementation });

    await expect(
      transport.execute("doctor", [], new AbortController().signal),
    ).resolves.toMatchObject({
      status: "pass",
      checks: [
        { name: "atlas_health_live", status: "pass" },
        { name: "atlas_health_server", status: "pass" },
        { name: "administrative_overview", status: "pass" },
        { name: "administrative_security_posture", status: "pass" },
      ],
    });
    // Four legacy checks plus the one infrastructure diagnostics read.
    expect(fetchImplementation).toHaveBeenCalledTimes(5);
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

  it("reads a service schedule preview for an explicit interval", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(200, { outcome: "required" }));
    const transport = createAtlasHttpTransport({ fetchImplementation });

    await expect(
      transport.execute(
        "services schedule preview",
        [
          "task-manager",
          "--from",
          "2026-08-08T08:00:00.000Z",
          "--to",
          "2026-08-08T18:00:00.000Z",
        ],
        new AbortController().signal,
      ),
    ).resolves.toEqual({ outcome: "required" });
    expect(fetchImplementation).toHaveBeenCalledWith(
      new URL(
        "http://127.0.0.1:3000/admin/services/task-manager/availability/preview?startsAt=2026-08-08T08%3A00%3A00.000Z&endsAt=2026-08-08T18%3A00%3A00.000Z",
      ),
      expect.objectContaining({ headers: { accept: "application/json" } }),
    );
  });

  it("forwards only a supplied real Access assertion to protected requests", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(200, { services: [] }));
    const transport = createAtlasHttpTransport({
      administrativeAccessToken: "real-token-from-access",
      fetchImplementation,
    });

    await transport.execute("services list", [], new AbortController().signal);

    expect(fetchImplementation).toHaveBeenCalledWith(
      new URL("http://127.0.0.1:3000/admin/services"),
      expect.objectContaining({
        headers: {
          accept: "application/json",
          "Cf-Access-Jwt-Assertion": "real-token-from-access",
        },
      }),
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

describe("Atlas CLI schedule preview", () => {
  // Slice 4 added a candidate/draft preview alongside the pre-existing
  // persisted-policy preview. It is read-only, so it does not depend on the
  // ADR-031 mutation transport, but it must not change what the existing
  // invocation means.
  const CANDIDATE_POLICY = JSON.stringify({ mode: "manual" });

  it("previews a candidate policy through the draft preview route", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(200, { source: "candidate_preview" }));
    const transport = createAtlasHttpTransport({ fetchImplementation });

    await expect(
      transport.execute(
        "services schedule preview",
        [
          "task-manager",
          "--from",
          "2026-08-08T08:00:00.000Z",
          "--to",
          "2026-08-08T18:00:00.000Z",
          "--policy",
          CANDIDATE_POLICY,
        ],
        new AbortController().signal,
      ),
    ).resolves.toEqual({ source: "candidate_preview" });
    const [url] = fetchImplementation.mock.calls[0]!;
    expect(urlOf(url)).toContain(
      "/admin/services/task-manager/schedule/preview?",
    );
    expect(urlOf(url)).toContain(
      `policy=${encodeURIComponent(CANDIDATE_POLICY)}`,
    );
  });

  it("keeps the persisted-policy preview as the default behaviour", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(200, { outcome: "required" }));
    const transport = createAtlasHttpTransport({ fetchImplementation });

    await transport.execute(
      "services schedule preview",
      ["task-manager"],
      new AbortController().signal,
    );

    const [url] = fetchImplementation.mock.calls[0]!;
    expect(urlOf(url)).toContain("/availability/preview?");
    expect(urlOf(url)).not.toContain("/schedule/preview");
  });

  it("rejects an unknown preview option", async () => {
    const transport = createAtlasHttpTransport({
      fetchImplementation: vi.fn<typeof fetch>(),
    });

    await expect(
      transport.execute(
        "services schedule preview",
        ["task-manager", "--unexpected", "value"],
        new AbortController().signal,
      ),
    ).rejects.toThrow("Unknown option: --unexpected");
  });

  it("requires an explicit interval alongside a candidate policy", async () => {
    const transport = createAtlasHttpTransport({
      fetchImplementation: vi.fn<typeof fetch>(),
    });

    await expect(
      transport.execute(
        "services schedule preview",
        ["task-manager", "--policy", CANDIDATE_POLICY],
        new AbortController().signal,
      ),
    ).rejects.toThrow("Preview options require --from");
  });
});
