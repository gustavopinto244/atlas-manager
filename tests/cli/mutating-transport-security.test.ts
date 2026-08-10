import { PassThrough } from "node:stream";
import process from "node:process";

import { describe, expect, it, vi } from "vitest";

import { createAtlasHttpTransport } from "../../src/cli/http-transport.js";
import { runAtlasCli } from "../../src/cli/main.js";

/** Extracts a request URL without relying on default stringification. */
function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

const ASSERTION = "externally-issued-access-assertion-value";
const SERVICE_ID = "task-manager";

const SERVICE_BODY = Object.freeze({
  service: {
    id: SERVICE_ID,
    displayName: "Task Manager",
    status: "running",
    availability: "available",
    supportedOperations: ["readStatus", "start", "stop", "restart"],
    managementKind: "pm2",
    dependencies: [],
  },
  dependents: [],
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function drain(value: PassThrough): Promise<string> {
  const chunks: Buffer[] = [];
  value.on("data", (chunk: Buffer) => chunks.push(chunk));
  await new Promise<void>((resolve) => value.end(resolve));
  return Buffer.concat(chunks).toString("utf8");
}

async function runCli(
  argv: readonly string[],
  fetchImplementation: typeof fetch,
  overrides: Readonly<{
    baseUrl?: string;
    administrativeAccessToken?: string;
  }> = {},
): Promise<Readonly<{ code: number; out: string; err: string }>> {
  const output = new PassThrough();
  const errors = new PassThrough();
  const transport = createAtlasHttpTransport({
    baseUrl: overrides.baseUrl ?? "https://atlas.example.com",
    fetchImplementation,
    ...(overrides.administrativeAccessToken === undefined
      ? {}
      : { administrativeAccessToken: overrides.administrativeAccessToken }),
  });
  const code = await runAtlasCli(argv, transport, output, errors);
  return { code, out: await drain(output), err: await drain(errors) };
}

function headersOf(init: RequestInit | undefined): Record<string, string> {
  return (init?.headers ?? {}) as Record<string, string>;
}

describe("mutating CLI transport — credential handling", () => {
  it("forwards the externally issued assertion only in the Access header", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockImplementation(async (input) =>
        urlOf(input).includes("/actions/")
          ? json(200, {
              serviceId: SERVICE_ID,
              operation: "restart",
              successful: true,
            })
          : json(200, SERVICE_BODY),
      );

    const result = await runCli(
      ["services", "restart", SERVICE_ID, "--json"],
      fetchImplementation,
      { administrativeAccessToken: ASSERTION },
    );

    expect(result.code).toBe(0);
    for (const [input, init] of fetchImplementation.mock.calls) {
      expect(headersOf(init)["Cf-Access-Jwt-Assertion"]).toBe(ASSERTION);
      // never in the URL: not the path, not the query, not the fragment
      expect(urlOf(input)).not.toContain(ASSERTION);
    }
  });

  it("omits the Access header entirely when no assertion is supplied", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => json(401, { error: { code: "x" } }));

    await runCli(
      ["services", "restart", SERVICE_ID, "--json"],
      fetchImplementation,
    );

    for (const [, init] of fetchImplementation.mock.calls)
      expect(headersOf(init)).not.toHaveProperty("Cf-Access-Jwt-Assertion");
  });

  it("never fabricates a principal, role or cookie header", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockImplementation(async (input) =>
        urlOf(input).includes("/actions/")
          ? json(200, {
              serviceId: SERVICE_ID,
              operation: "start",
              successful: true,
            })
          : json(200, SERVICE_BODY),
      );

    await runCli(
      ["services", "start", SERVICE_ID, "--json"],
      fetchImplementation,
      { administrativeAccessToken: ASSERTION },
    );

    for (const [, init] of fetchImplementation.mock.calls) {
      const names = Object.keys(headersOf(init)).map((name) =>
        name.toLowerCase(),
      );
      expect(names).not.toContain("cookie");
      expect(names).not.toContain("authorization");
      expect(names).not.toContain("cf-access-authenticated-user-email");
      expect(names.filter((name) => name.startsWith("cf-"))).toEqual([
        "cf-access-jwt-assertion",
      ]);
    }
  });

  it.each([
    ["success", 200, 0],
    ["authorization refusal", 403, 3],
    ["server failure", 500, 1],
  ])(
    "never discloses the assertion in output on %s",
    async (_label, mutationStatus, expectedCode) => {
      const fetchImplementation = vi
        .fn<typeof fetch>()
        .mockImplementation(async (input) =>
          urlOf(input).includes("/actions/")
            ? json(
                mutationStatus,
                mutationStatus === 200
                  ? {
                      serviceId: SERVICE_ID,
                      operation: "restart",
                      successful: true,
                    }
                  : { error: { code: "denied", message: "denied" } },
              )
            : json(200, SERVICE_BODY),
        );

      const result = await runCli(
        ["services", "restart", SERVICE_ID, "--json"],
        fetchImplementation,
        { administrativeAccessToken: ASSERTION },
      );

      expect(result.code).toBe(expectedCode);
      expect(result.out).not.toContain(ASSERTION);
      expect(result.err).not.toContain(ASSERTION);
    },
  );
});

describe("mutating CLI transport — base URL policy", () => {
  it("refuses a mutation over plaintext HTTP to a non-loopback host with no network activity", async () => {
    const fetchImplementation = vi.fn<typeof fetch>();

    const result = await runCli(
      ["services", "restart", SERVICE_ID, "--json"],
      fetchImplementation,
      {
        baseUrl: "http://atlas.example.com",
        administrativeAccessToken: ASSERTION,
      },
    );

    expect(result.code).toBe(2);
    expect(
      (JSON.parse(result.err) as { error: { code: string } }).error.code,
    ).toBe("insecure_transport");
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("withholds the assertion from a plaintext non-loopback read", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => json(200, { services: [] }));

    await runCli(["services", "list", "--json"], fetchImplementation, {
      baseUrl: "http://atlas.example.com",
      administrativeAccessToken: ASSERTION,
    });

    const [, init] = fetchImplementation.mock.calls[0]!;
    expect(headersOf(init)).not.toHaveProperty("Cf-Access-Jwt-Assertion");
  });

  it.each([
    "http://127.0.0.1:3000",
    "http://localhost:3000",
    "https://atlas.example.com",
  ])("permits a mutation and forwards the assertion over %s", async (base) => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockImplementation(async (input) =>
        urlOf(input).includes("/actions/")
          ? json(200, {
              serviceId: SERVICE_ID,
              operation: "stop",
              successful: true,
            })
          : json(200, SERVICE_BODY),
      );

    const result = await runCli(
      ["services", "stop", SERVICE_ID, "--json"],
      fetchImplementation,
      { baseUrl: base, administrativeAccessToken: ASSERTION },
    );

    expect(result.code).toBe(0);
    const [, init] = fetchImplementation.mock.calls[0]!;
    expect(headersOf(init)["Cf-Access-Jwt-Assertion"]).toBe(ASSERTION);
  });

  it("rejects a base URL carrying embedded credentials", async () => {
    expect(() =>
      createAtlasHttpTransport({ baseUrl: "https://user:pass@atlas.example" }),
    ).toThrow("must not contain credentials");
  });
});

describe("mutating CLI transport — redirect containment", () => {
  it("never follows a redirect on any administrative request", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockImplementation(async (input) =>
        urlOf(input).includes("/actions/")
          ? json(200, {
              serviceId: SERVICE_ID,
              operation: "restart",
              successful: true,
            })
          : json(200, SERVICE_BODY),
      );

    await runCli(
      ["services", "restart", SERVICE_ID, "--json"],
      fetchImplementation,
      { administrativeAccessToken: ASSERTION },
    );

    expect(fetchImplementation.mock.calls.length).toBeGreaterThan(0);
    for (const [, init] of fetchImplementation.mock.calls)
      expect(init?.redirect).toBe("error");
  });

  it("cannot leak the assertion to a redirect target chosen by the server", async () => {
    // Mirrors how fetch behaves under `redirect: "error"`: the redirect is
    // surfaced as a transport failure, and no second request is made — so the
    // credential is never re-sent to the Location the server picked.
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockImplementation(async (input, init) => {
        if (!urlOf(input).includes("/actions/")) return json(200, SERVICE_BODY);
        expect(init?.redirect).toBe("error");
        throw Object.assign(new TypeError("fetch failed"), {
          cause: new Error("unexpected redirect"),
        });
      });

    const result = await runCli(
      ["services", "restart", SERVICE_ID, "--json"],
      fetchImplementation,
      { administrativeAccessToken: ASSERTION },
    );

    expect(result.code).toBe(5);
    expect(
      fetchImplementation.mock.calls.filter(([input]) =>
        urlOf(input).includes("evil"),
      ),
    ).toHaveLength(0);
    expect(
      fetchImplementation.mock.calls.filter(
        ([input]) => !urlOf(input).startsWith("https://atlas.example.com/"),
      ),
    ).toHaveLength(0);
  });
});

describe("mutating CLI transport — authorization failures", () => {
  it.each([401, 403])(
    "reports HTTP %s as an authorization failure and never falls back",
    async (status) => {
      const fetchImplementation = vi
        .fn<typeof fetch>()
        .mockImplementation(async (input) =>
          urlOf(input).includes("/actions/")
            ? json(status, { error: { code: "denied", message: "denied" } })
            : json(200, SERVICE_BODY),
        );

      const result = await runCli(
        ["services", "restart", SERVICE_ID, "--json"],
        fetchImplementation,
        { administrativeAccessToken: ASSERTION },
      );

      expect(result.code).toBe(3);
      expect(
        (JSON.parse(result.err) as { error: { code: string } }).error.code,
      ).toBe("administrative_access_denied");
      // exactly the pre-check and the refused mutation: nothing else was tried
      expect(fetchImplementation).toHaveBeenCalledTimes(2);
    },
  );

  it("stops at the pre-check when authorization is already refused", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        json(401, { error: { code: "denied", message: "denied" } }),
      );

    const result = await runCli(
      ["services", "restart", SERVICE_ID, "--json"],
      fetchImplementation,
    );

    expect(result.code).toBe(3);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });
});

describe("mutating CLI transport — interruption", () => {
  it("reports a clean cancellation when interrupted before dispatch", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockImplementation(
      async () =>
        new Promise<Response>(() => {
          setImmediate(() => process.emit("SIGINT"));
        }),
    );

    const result = await runCli(
      ["services", "restart", SERVICE_ID, "--json"],
      fetchImplementation,
      { administrativeAccessToken: ASSERTION },
    );

    expect(result.code).toBe(130);
    const error = (
      JSON.parse(result.err) as { error: { code: string; message: string } }
    ).error;
    expect(error.code).toBe("interrupted");
    expect(error.message).toContain("no operation was dispatched");
  });

  it("reports an indeterminate outcome when interrupted after dispatch", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockImplementation(async (input) => {
        if (!urlOf(input).includes("/actions/")) return json(200, SERVICE_BODY);
        return new Promise<Response>(() => {
          setImmediate(() => process.emit("SIGINT"));
        });
      });

    const result = await runCli(
      ["services", "restart", SERVICE_ID, "--json"],
      fetchImplementation,
      { administrativeAccessToken: ASSERTION },
    );

    expect(result.code).toBe(130);
    const error = (
      JSON.parse(result.err) as { error: { code: string; message: string } }
    ).error;
    expect(error.code).toBe("mutation_interrupted_outcome_unknown");
    expect(error.message).toContain("atlas services status task-manager");
  });
});

describe("mutating CLI transport — response bounds", () => {
  it("refuses an oversized mutation response instead of buffering it", async () => {
    const oversized = JSON.stringify({
      serviceId: SERVICE_ID,
      operation: "restart",
      successful: true,
      padding: "x".repeat(300_000),
    });
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockImplementation(async (input) =>
        urlOf(input).includes("/actions/")
          ? new Response(oversized, {
              status: 200,
              headers: { "content-type": "application/json" },
            })
          : json(200, SERVICE_BODY),
      );

    const result = await runCli(
      ["services", "restart", SERVICE_ID, "--json"],
      fetchImplementation,
      { administrativeAccessToken: ASSERTION },
    );

    expect(result.code).not.toBe(0);
  });
});
