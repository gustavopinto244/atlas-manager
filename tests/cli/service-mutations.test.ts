import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import { createAtlasHttpTransport } from "../../src/cli/http-transport.js";
import { runAtlasCli } from "../../src/cli/main.js";

/** Extracts a request URL without relying on default stringification. */
function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

const BASE_URL = "https://atlas.example.com";
const SERVICE_ID = "task-manager";

const SERVICE_RECORD = Object.freeze({
  id: SERVICE_ID,
  displayName: "Task Manager",
  status: "running",
  availability: "available",
  supportedOperations: ["readStatus", "start", "stop", "restart"],
  managementKind: "pm2",
  dependencies: [],
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function errorBody(code: string): unknown {
  return { error: { code, message: code } };
}

type AtlasStub = Readonly<{
  /** Response for GET /admin/services/:id, or a thrown value. */
  read?: () => Response | Promise<Response>;
  /** Response for the mutation, or a thrown value. */
  mutate?: () => Response | Promise<Response>;
  /** Response for the authoritative re-read, defaults to `read`. */
  reread?: () => Response | Promise<Response>;
}>;

/**
 * A fetch stub shaped like the real administrative boundary: a single-service
 * read, one mutation route, then the authoritative re-read.
 */
function fakeAtlas(stub: AtlasStub = {}) {
  const calls: Array<Readonly<{ method: string; url: string; body: unknown }>> =
    [];
  let reads = 0;
  const implementation = vi
    .fn<typeof fetch>()
    .mockImplementation(async (input, init) => {
      const url = urlOf(input);
      const method = init?.method ?? "GET";
      calls.push({
        method,
        url,
        body:
          typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      });
      if (method === "GET") {
        reads += 1;
        const responder = reads === 1 ? stub.read : (stub.reread ?? stub.read);
        return responder === undefined
          ? json(200, { service: SERVICE_RECORD, dependents: [] })
          : responder();
      }
      return stub.mutate === undefined
        ? json(200, {
            serviceId: SERVICE_ID,
            operation: "restart",
            successful: true,
          })
        : stub.mutate();
    });
  return { implementation, calls };
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
    mutationTimeoutMs?: number;
  }> = {},
): Promise<Readonly<{ code: number; out: string; err: string }>> {
  const output = new PassThrough();
  const errors = new PassThrough();
  const transport = createAtlasHttpTransport({
    baseUrl: overrides.baseUrl ?? BASE_URL,
    administrativeAccessToken:
      overrides.administrativeAccessToken ?? "externally-issued-assertion",
    fetchImplementation,
    ...(overrides.mutationTimeoutMs === undefined
      ? {}
      : { mutationTimeoutMs: overrides.mutationTimeoutMs }),
  });
  const code = await runAtlasCli(argv, transport, output, errors);
  return { code, out: await drain(output), err: await drain(errors) };
}

function envelope(value: string): {
  status: string;
  command: string;
  data?: unknown;
  error?: { code: string; message: string };
} {
  return JSON.parse(value) as ReturnType<typeof envelope>;
}

describe("atlas services start/stop/restart", () => {
  it.each(["start", "stop", "restart"] as const)(
    "sends %s through the canonical administrative route with its exact confirmation",
    async (operation) => {
      const atlas = fakeAtlas();
      const result = await runCli(
        ["services", operation, SERVICE_ID, "--json"],
        atlas.implementation,
      );

      expect(result.code).toBe(0);
      expect(envelope(result.out)).toMatchObject({
        status: "ok",
        command: `services ${operation}`,
        data: {
          serviceId: SERVICE_ID,
          operation,
          result: "completed",
          state: "running",
          authoritativeRead: "ok",
        },
      });
      // pre-check read, mutation, authoritative re-read
      expect(atlas.calls).toHaveLength(3);
      expect(atlas.calls[1]).toEqual({
        method: "POST",
        url: `${BASE_URL}/admin/services/${SERVICE_ID}/actions/${operation}`,
        body: { confirmation: `confirm_registered_service_${operation}` },
      });
    },
  );

  it("renders a short human result instead of a raw payload", async () => {
    const atlas = fakeAtlas();
    const result = await runCli(
      ["services", "restart", SERVICE_ID],
      atlas.implementation,
    );

    expect(result.code).toBe(0);
    expect(result.out).toBe(
      "Service: Task Manager\nOperation: restart\nResult: completed\nState: running\n",
    );
  });

  it("reports the authoritative state read after the mutation, not the state before it", async () => {
    const atlas = fakeAtlas({
      read: () =>
        json(200, {
          service: { ...SERVICE_RECORD, status: "stopped" },
          dependents: [],
        }),
      reread: () =>
        json(200, {
          service: { ...SERVICE_RECORD, status: "running" },
          dependents: [],
        }),
    });
    const result = await runCli(
      ["services", "start", SERVICE_ID, "--json"],
      atlas.implementation,
    );

    expect(result.code).toBe(0);
    expect(envelope(result.out).data).toMatchObject({ state: "running" });
  });

  it("still reports an accepted mutation when the authoritative re-read fails", async () => {
    const atlas = fakeAtlas({
      reread: () => json(503, errorBody("administrative_unavailable")),
    });
    const result = await runCli(
      ["services", "restart", SERVICE_ID, "--json"],
      atlas.implementation,
    );

    expect(result.code).toBe(0);
    expect(envelope(result.out).data).toMatchObject({
      result: "completed",
      state: "unknown",
      authoritativeRead: "unavailable",
    });
    expect(
      (await runCli(["services", "restart", SERVICE_ID], atlas.implementation))
        .out,
    ).toContain("could not be re-read");
  });

  it("reports an unknown service without dispatching a mutation", async () => {
    const atlas = fakeAtlas({
      read: () => json(404, errorBody("registered_service_not_found")),
    });
    const result = await runCli(
      ["services", "restart", "no-such-service", "--json"],
      atlas.implementation,
    );

    expect(result.code).toBe(1);
    expect(envelope(result.err).error?.code).toBe("service_not_found");
    expect(atlas.calls.map((call) => call.method)).toEqual(["GET"]);
  });

  it("refuses an unsupported operation without attempting the adapter", async () => {
    const atlas = fakeAtlas({
      read: () =>
        json(200, {
          service: { ...SERVICE_RECORD, supportedOperations: ["readStatus"] },
          dependents: [],
        }),
    });
    const result = await runCli(
      ["services", "restart", SERVICE_ID, "--json"],
      atlas.implementation,
    );

    expect(result.code).toBe(1);
    expect(envelope(result.err).error?.code).toBe(
      "service_operation_unsupported",
    );
    expect(atlas.calls.map((call) => call.method)).toEqual(["GET"]);
  });

  it("maps a busy mutation gate to the conflict exit code without retrying", async () => {
    const atlas = fakeAtlas({
      mutate: () =>
        json(409, errorBody("administrative_service_operation_busy")),
    });
    const result = await runCli(
      ["services", "restart", SERVICE_ID, "--json"],
      atlas.implementation,
    );

    expect(result.code).toBe(4);
    expect(envelope(result.err).error?.code).toBe("operation_conflict");
    expect(atlas.calls.filter((call) => call.method === "POST")).toHaveLength(
      1,
    );
  });

  it("maps administrative rate limiting to the conflict exit code without retrying", async () => {
    const atlas = fakeAtlas({
      mutate: () => json(429, errorBody("administrative_request_limited")),
    });
    const result = await runCli(
      ["services", "restart", SERVICE_ID, "--json"],
      atlas.implementation,
    );

    expect(result.code).toBe(4);
    expect(envelope(result.err).error?.code).toBe("operation_conflict");
    expect(atlas.calls.filter((call) => call.method === "POST")).toHaveLength(
      1,
    );
  });

  it("maps a server failure to an operational failure", async () => {
    const atlas = fakeAtlas({
      mutate: () =>
        json(503, errorBody("administrative_service_management_unavailable")),
    });
    const result = await runCli(
      ["services", "restart", SERVICE_ID, "--json"],
      atlas.implementation,
    );

    expect(result.code).toBe(1);
    expect(envelope(result.err).error?.code).toBe("service_operation_failed");
  });

  it("treats an unconfirmed audit outcome as indeterminate rather than failed", async () => {
    const atlas = fakeAtlas({
      mutate: () =>
        json(503, errorBody("administrative_service_state_recheck_required")),
    });
    const result = await runCli(
      ["services", "restart", SERVICE_ID, "--json"],
      atlas.implementation,
    );

    expect(result.code).toBe(5);
    const error = envelope(result.err).error;
    expect(error?.code).toBe("mutation_outcome_unknown");
    expect(error?.message).toContain("atlas services status task-manager");
  });

  it("rejects a malformed mutation response", async () => {
    const atlas = fakeAtlas({
      mutate: () =>
        new Response("{not json", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });
    const result = await runCli(
      ["services", "restart", SERVICE_ID, "--json"],
      atlas.implementation,
    );

    expect(result.code).toBe(1);
    expect(envelope(result.err).error?.code).toBe("service_operation_failed");
  });

  it("rejects a mutation response of the wrong shape", async () => {
    const atlas = fakeAtlas({
      mutate: () => json(200, { unexpected: true }),
    });
    const result = await runCli(
      ["services", "restart", SERVICE_ID, "--json"],
      atlas.implementation,
    );

    expect(result.code).toBe(1);
    expect(envelope(result.err).error?.code).toBe("service_operation_failed");
  });

  it("does not claim success when the backend reports the operation unsuccessful", async () => {
    const atlas = fakeAtlas({
      mutate: () =>
        json(200, {
          serviceId: SERVICE_ID,
          operation: "restart",
          successful: false,
        }),
    });
    const result = await runCli(
      ["services", "restart", SERVICE_ID, "--json"],
      atlas.implementation,
    );

    expect(result.code).toBe(1);
    expect(envelope(result.err).error?.code).toBe("service_operation_failed");
  });

  it("reports a provably undelivered mutation as unavailable infrastructure", async () => {
    const atlas = fakeAtlas({
      mutate: () => {
        throw Object.assign(new TypeError("fetch failed"), {
          cause: Object.assign(new Error("connect ECONNREFUSED"), {
            code: "ECONNREFUSED",
          }),
        });
      },
    });
    const result = await runCli(
      ["services", "restart", SERVICE_ID, "--json"],
      atlas.implementation,
    );

    expect(result.code).toBe(5);
    expect(envelope(result.err).error?.code).toBe("infrastructure_unavailable");
  });

  it("reports a possibly delivered mutation as indeterminate and never retries", async () => {
    const atlas = fakeAtlas({
      mutate: () => {
        throw Object.assign(new TypeError("fetch failed"), {
          cause: Object.assign(new Error("socket hang up"), {
            code: "ECONNRESET",
          }),
        });
      },
    });
    const result = await runCli(
      ["services", "restart", SERVICE_ID, "--json"],
      atlas.implementation,
    );

    expect(result.code).toBe(5);
    const error = envelope(result.err).error;
    expect(error?.code).toBe("mutation_outcome_unknown");
    expect(error?.message).toContain("may still have been applied");
    expect(atlas.calls.filter((call) => call.method === "POST")).toHaveLength(
      1,
    );
  });

  it("reports a timed-out mutation as indeterminate and never retries", async () => {
    const atlas = fakeAtlas({
      mutate: async () =>
        new Promise<Response>(() => {
          /* never settles; the bounded timeout must fire */
        }),
    });
    const result = await runCli(
      ["services", "restart", SERVICE_ID, "--json"],
      atlas.implementation,
      { mutationTimeoutMs: 20 },
    );

    expect(result.code).toBe(5);
    expect(envelope(result.err).error?.code).toBe("mutation_outcome_unknown");
    expect(atlas.calls.filter((call) => call.method === "POST")).toHaveLength(
      1,
    );
  });
});

describe("atlas service mutation arguments", () => {
  it.each([
    [[], "service id is required"],
    [[SERVICE_ID, "extra"], "Unexpected argument"],
    [["--pm2"], "Unknown option"],
    [["--container"], "Unknown option"],
    [["--unit"], "Unknown option"],
    [["Not_A_Service"], "Invalid service id"],
  ])("rejects %j as a usage error", async (args, expected) => {
    const atlas = fakeAtlas();
    const result = await runCli(
      ["services", "restart", ...args, "--json"],
      atlas.implementation,
    );

    expect(result.code).toBe(2);
    expect(envelope(result.err).error?.code).toBe("invalid_arguments");
    expect(envelope(result.err).error?.message).toContain(expected);
    expect(atlas.implementation).not.toHaveBeenCalled();
  });
});
