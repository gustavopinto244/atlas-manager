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

const BASE_URL = "https://atlas.example.com";
const SERVICE_ID = "task-manager";
const SCHEDULE_PATH = `${BASE_URL}/admin/services/${SERVICE_ID}/schedule`;

const SERVICE_RECORD = Object.freeze({
  id: SERVICE_ID,
  displayName: "Task Manager",
  status: "running",
  availability: "available",
  supportedOperations: ["readStatus", "start", "stop", "restart"],
  managementKind: "pm2",
  dependencies: [],
});

const SCHEDULED_POLICY = Object.freeze({
  mode: "scheduled",
  timezone: "America/Sao_Paulo",
  windows: [{ weekday: "monday", start: "08:00", end: "18:00" }],
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
  /** Response for the pre-check GET /admin/services/:id. */
  read?: () => Response | Promise<Response>;
  /** Response for the PUT/DELETE mutation. */
  mutate?: () => Response | Promise<Response>;
  /** Response for the authoritative GET /admin/services/:id/schedule. */
  reread?: () => Response | Promise<Response>;
}>;

/**
 * A fetch stub shaped like the real administrative boundary: a single-service
 * pre-check read, the schedule mutation, then the authoritative schedule read.
 */
function fakeAtlas(stub: AtlasStub = {}) {
  const calls: Array<Readonly<{ method: string; url: string; body: unknown }>> =
    [];
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
      if (method === "GET" && url.endsWith("/schedule"))
        return stub.reread === undefined
          ? json(200, {
              serviceId: SERVICE_ID,
              policy: { mode: "always", timezone: null, schedule: null },
              observedAt: "2026-08-10T12:00:00.000Z",
            })
          : stub.reread();
      if (method === "GET")
        return stub.read === undefined
          ? json(200, { service: SERVICE_RECORD, dependents: [] })
          : stub.read();
      return stub.mutate === undefined
        ? json(
            200,
            method === "DELETE"
              ? { serviceId: SERVICE_ID, removed: true }
              : { mode: "always", timezone: null, schedule: null },
          )
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
  overrides: Readonly<{ mutationTimeoutMs?: number }> = {},
): Promise<Readonly<{ code: number; out: string; err: string }>> {
  const output = new PassThrough();
  const errors = new PassThrough();
  const transport = createAtlasHttpTransport({
    baseUrl: BASE_URL,
    administrativeAccessToken: "externally-issued-assertion",
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

describe("atlas services schedule set", () => {
  it("forwards the policy verbatim through the canonical schedule route", async () => {
    const atlas = fakeAtlas({
      reread: () =>
        json(200, {
          serviceId: SERVICE_ID,
          policy: {
            mode: "scheduled",
            timezone: "America/Sao_Paulo",
            schedule: { windows: SCHEDULED_POLICY.windows },
          },
          observedAt: "2026-08-10T12:00:00.000Z",
        }),
      mutate: () =>
        json(200, {
          mode: "scheduled",
          timezone: "America/Sao_Paulo",
          schedule: { windows: SCHEDULED_POLICY.windows },
        }),
    });
    const result = await runCli(
      [
        "services",
        "schedule",
        "set",
        SERVICE_ID,
        "--policy",
        JSON.stringify(SCHEDULED_POLICY),
        "--json",
      ],
      atlas.implementation,
    );

    expect(result.code).toBe(0);
    expect(envelope(result.out)).toMatchObject({
      status: "ok",
      command: "services schedule set",
      data: {
        serviceId: SERVICE_ID,
        operation: "update",
        result: "completed",
        mode: "scheduled",
        authoritativeRead: "ok",
      },
    });
    // pre-check read, mutation, authoritative re-read — in that order.
    expect(atlas.calls.map((call) => call.method)).toEqual([
      "GET",
      "PUT",
      "GET",
    ]);
    expect(atlas.calls[1]).toEqual({
      method: "PUT",
      url: SCHEDULE_PATH,
      body: {
        confirmation: "confirm_registered_service_schedule_update",
        policy: SCHEDULED_POLICY,
      },
    });
    expect(atlas.calls[2]?.url).toBe(SCHEDULE_PATH);
  });

  it("reports the authoritative stored policy, not the one that was sent", async () => {
    const atlas = fakeAtlas({
      reread: () =>
        json(200, {
          serviceId: SERVICE_ID,
          policy: { mode: "manual", timezone: null, schedule: null },
          observedAt: "2026-08-10T12:00:00.000Z",
        }),
      mutate: () =>
        json(200, { mode: "manual", timezone: null, schedule: null }),
    });
    const result = await runCli(
      [
        "services",
        "schedule",
        "set",
        SERVICE_ID,
        "--policy",
        '{"mode":"manual"}',
        "--json",
      ],
      atlas.implementation,
    );

    expect(result.code).toBe(0);
    expect(envelope(result.out).data).toMatchObject({
      mode: "manual",
      policy: { mode: "manual" },
    });
  });

  it("still reports an accepted mutation when the authoritative re-read fails", async () => {
    const atlas = fakeAtlas({
      reread: () => json(503, errorBody("administrative_unavailable")),
    });
    const result = await runCli(
      [
        "services",
        "schedule",
        "set",
        SERVICE_ID,
        "--policy",
        '{"mode":"always"}',
        "--json",
      ],
      atlas.implementation,
    );

    expect(result.code).toBe(0);
    expect(envelope(result.out).data).toMatchObject({
      result: "completed",
      mode: "unknown",
      authoritativeRead: "unavailable",
    });
  });

  it("maps a rejected policy to the schedule-invalid failure", async () => {
    const atlas = fakeAtlas({
      mutate: () => json(400, errorBody("invalid_service_schedule_request")),
    });
    const result = await runCli(
      [
        "services",
        "schedule",
        "set",
        SERVICE_ID,
        "--policy",
        '{"mode":"whenever"}',
        "--json",
      ],
      atlas.implementation,
    );

    expect(result.code).toBe(1);
    expect(envelope(result.err).error?.code).toBe("schedule_invalid");
    // The CLI never pre-judges policy content: the server decided this.
    expect(atlas.calls.filter((call) => call.method === "PUT")).toHaveLength(1);
  });

  it("reports an unknown service without dispatching a mutation", async () => {
    const atlas = fakeAtlas({
      read: () => json(404, errorBody("registered_service_not_found")),
    });
    const result = await runCli(
      [
        "services",
        "schedule",
        "set",
        "no-such-service",
        "--policy",
        '{"mode":"always"}',
        "--json",
      ],
      atlas.implementation,
    );

    expect(result.code).toBe(1);
    expect(envelope(result.err).error?.code).toBe("service_not_found");
    expect(atlas.calls.map((call) => call.method)).toEqual(["GET"]);
  });

  it.each([401, 403])(
    "maps an authorization refusal at %i to the access-denied exit code",
    async (status) => {
      const atlas = fakeAtlas({
        mutate: () => json(status, errorBody("denied")),
      });
      const result = await runCli(
        [
          "services",
          "schedule",
          "set",
          SERVICE_ID,
          "--policy",
          '{"mode":"always"}',
          "--json",
        ],
        atlas.implementation,
      );

      expect(result.code).toBe(3);
      expect(envelope(result.err).error?.code).toBe(
        "administrative_access_denied",
      );
    },
  );

  it.each([409, 429])(
    "maps a busy or limited mutation at %i to a conflict without retrying",
    async (status) => {
      const atlas = fakeAtlas({
        mutate: () =>
          json(
            status,
            errorBody(
              status === 409
                ? "administrative_service_operation_busy"
                : "administrative_request_limited",
            ),
          ),
      });
      const result = await runCli(
        [
          "services",
          "schedule",
          "set",
          SERVICE_ID,
          "--policy",
          '{"mode":"always"}',
          "--json",
        ],
        atlas.implementation,
      );

      expect(result.code).toBe(4);
      expect(envelope(result.err).error?.code).toBe("operation_conflict");
      expect(atlas.calls.filter((call) => call.method === "PUT")).toHaveLength(
        1,
      );
    },
  );

  it("rejects a malformed mutation response", async () => {
    const atlas = fakeAtlas({
      mutate: () =>
        new Response("{not json", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });
    const result = await runCli(
      [
        "services",
        "schedule",
        "set",
        SERVICE_ID,
        "--policy",
        '{"mode":"always"}',
        "--json",
      ],
      atlas.implementation,
    );

    expect(result.code).toBe(1);
    expect(envelope(result.err).error?.code).toBe("service_operation_failed");
  });

  it("rejects a mutation response that does not acknowledge a stored policy", async () => {
    const atlas = fakeAtlas({ mutate: () => json(200, { unexpected: true }) });
    const result = await runCli(
      [
        "services",
        "schedule",
        "set",
        SERVICE_ID,
        "--policy",
        '{"mode":"always"}',
        "--json",
      ],
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
      [
        "services",
        "schedule",
        "set",
        SERVICE_ID,
        "--policy",
        '{"mode":"always"}',
        "--json",
      ],
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
      [
        "services",
        "schedule",
        "set",
        SERVICE_ID,
        "--policy",
        '{"mode":"always"}',
        "--json",
      ],
      atlas.implementation,
    );

    expect(result.code).toBe(5);
    const error = envelope(result.err).error;
    expect(error?.code).toBe("mutation_outcome_unknown");
    expect(error?.message).toContain("may still have been applied");
    expect(error?.message).toContain(
      `atlas services schedule show ${SERVICE_ID}`,
    );
    expect(atlas.calls.filter((call) => call.method === "PUT")).toHaveLength(1);
  });

  it("reports a timed-out mutation as indeterminate and never retries", async () => {
    const atlas = fakeAtlas({
      mutate: async () =>
        new Promise<Response>(() => {
          /* never settles; the bounded timeout must fire */
        }),
    });
    const result = await runCli(
      [
        "services",
        "schedule",
        "set",
        SERVICE_ID,
        "--policy",
        '{"mode":"always"}',
        "--json",
      ],
      atlas.implementation,
      { mutationTimeoutMs: 20 },
    );

    expect(result.code).toBe(5);
    expect(envelope(result.err).error?.code).toBe("mutation_outcome_unknown");
    expect(atlas.calls.filter((call) => call.method === "PUT")).toHaveLength(1);
  });

  it("treats an unconfirmed audit outcome as indeterminate rather than failed", async () => {
    const atlas = fakeAtlas({
      mutate: () =>
        json(500, errorBody("administrative_service_state_recheck_required")),
    });
    const result = await runCli(
      [
        "services",
        "schedule",
        "set",
        SERVICE_ID,
        "--policy",
        '{"mode":"always"}',
        "--json",
      ],
      atlas.implementation,
    );

    expect(result.code).toBe(5);
    expect(envelope(result.err).error?.code).toBe("mutation_outcome_unknown");
  });
});

describe("atlas services schedule always/manual/disable", () => {
  it.each([
    ["always", "always"],
    ["manual", "manual"],
    ["disable", "disabled"],
  ] as const)(
    "sends %s as an explicit stored policy with mode %s",
    async (subcommand, mode) => {
      const atlas = fakeAtlas({
        mutate: () => json(200, { mode, timezone: null, schedule: null }),
        reread: () =>
          json(200, {
            serviceId: SERVICE_ID,
            policy: { mode, timezone: null, schedule: null },
            observedAt: "2026-08-10T12:00:00.000Z",
          }),
      });
      const result = await runCli(
        ["services", "schedule", subcommand, SERVICE_ID, "--json"],
        atlas.implementation,
      );

      expect(result.code).toBe(0);
      expect(envelope(result.out).data).toMatchObject({
        operation: "update",
        result: "completed",
        mode,
      });
      expect(atlas.calls[1]).toEqual({
        method: "PUT",
        url: SCHEDULE_PATH,
        body: {
          confirmation: "confirm_registered_service_schedule_update",
          policy: { mode },
        },
      });
    },
  );

  it("renders a short human result instead of a raw payload", async () => {
    const atlas = fakeAtlas();
    const result = await runCli(
      ["services", "schedule", "always", SERVICE_ID],
      atlas.implementation,
    );

    expect(result.code).toBe(0);
    expect(result.out).toBe(
      "Service: task-manager\nSchedule: updated\nResult: completed\nEffective mode: always\n",
    );
  });
});

describe("atlas services schedule remove", () => {
  it("deletes the stored override and sends no policy key at all", async () => {
    const atlas = fakeAtlas({
      reread: () =>
        json(200, {
          serviceId: SERVICE_ID,
          policy: { mode: "always", timezone: null, schedule: null },
          observedAt: "2026-08-10T12:00:00.000Z",
        }),
    });
    const result = await runCli(
      ["services", "schedule", "remove", SERVICE_ID, "--json"],
      atlas.implementation,
    );

    expect(result.code).toBe(0);
    expect(envelope(result.out).data).toMatchObject({
      serviceId: SERVICE_ID,
      operation: "delete",
      result: "completed",
      authoritativeRead: "ok",
    });
    const mutation = atlas.calls[1];
    expect(mutation).toEqual({
      method: "DELETE",
      url: SCHEDULE_PATH,
      body: { confirmation: "confirm_registered_service_schedule_removal" },
    });
    // Removal is not "write mode disabled". The body carries no policy at all,
    // so the service falls back to its configured default policy.
    expect(Object.keys(mutation?.body as Record<string, unknown>)).toEqual([
      "confirmation",
    ]);
  });

  it("rejects a removal response that does not acknowledge the removal", async () => {
    const atlas = fakeAtlas({
      mutate: () => json(200, { serviceId: SERVICE_ID, removed: false }),
    });
    const result = await runCli(
      ["services", "schedule", "remove", SERVICE_ID, "--json"],
      atlas.implementation,
    );

    expect(result.code).toBe(1);
    expect(envelope(result.err).error?.code).toBe("service_operation_failed");
  });

  it("reports an unreadable transport failure as an unknown outcome", async () => {
    const atlas = fakeAtlas({
      mutate: () => {
        throw new TypeError("fetch failed");
      },
    });
    const result = await runCli(
      ["services", "schedule", "remove", SERVICE_ID, "--json"],
      atlas.implementation,
    );

    // Delivery was not provably prevented, so it must never be reported as a
    // definite failure.
    expect(result.code).toBe(5);
    expect(envelope(result.err).error?.code).toBe("mutation_outcome_unknown");
  });
});

describe("atlas services schedule mutation interruption", () => {
  it("reports a clean cancellation when interrupted before dispatch", async () => {
    const atlas = fakeAtlas({
      read: async () =>
        new Promise<Response>(() => {
          setImmediate(() => process.emit("SIGINT"));
        }),
    });
    const result = await runCli(
      ["services", "schedule", "always", SERVICE_ID, "--json"],
      atlas.implementation,
    );

    expect(result.code).toBe(130);
    const error = envelope(result.err).error;
    expect(error?.code).toBe("interrupted");
    expect(error?.message).toContain("no operation was dispatched");
    expect(atlas.calls.some((call) => call.method !== "GET")).toBe(false);
  });

  it("reports an indeterminate outcome when interrupted after dispatch", async () => {
    const atlas = fakeAtlas({
      mutate: async () =>
        new Promise<Response>(() => {
          setImmediate(() => process.emit("SIGINT"));
        }),
    });
    const result = await runCli(
      ["services", "schedule", "remove", SERVICE_ID, "--json"],
      atlas.implementation,
    );

    expect(result.code).toBe(130);
    const error = envelope(result.err).error;
    expect(error?.code).toBe("mutation_interrupted_outcome_unknown");
    expect(error?.message).toContain(
      `atlas services schedule show ${SERVICE_ID}`,
    );
    expect(atlas.calls.filter((call) => call.method === "DELETE")).toHaveLength(
      1,
    );
  });
});

describe("atlas service schedule mutation arguments", () => {
  it.each([
    [["set"], [] as string[], "service id is required"],
    [["set"], [SERVICE_ID], "Option --policy <json> is required"],
    [["set"], [SERVICE_ID, "--policy"], "Option --policy <json> is required"],
    [
      ["set"],
      [SERVICE_ID, "--policy", "{not json"],
      "Option --policy requires valid JSON",
    ],
    [
      ["set"],
      [SERVICE_ID, "--policy", "{}", "extra"],
      "Option --policy <json> is required",
    ],
    [["set"], [SERVICE_ID, "--force"], "Unknown option"],
    [["set"], ["Not_A_Service", "--policy", "{}"], "Invalid service id"],
    [["always"], [], "service id is required"],
    [["always"], [SERVICE_ID, "extra"], "Unexpected argument"],
    [["always"], ["--pm2"], "Unknown option"],
    [["disable"], ["--container"], "Unknown option"],
    [["remove"], ["--unit"], "Unknown option"],
    [["remove"], [SERVICE_ID, "--policy", "{}"], "Unexpected argument"],
  ])("rejects %j %j as a usage error", async (subcommand, args, expected) => {
    const atlas = fakeAtlas();
    const result = await runCli(
      ["services", "schedule", ...subcommand, ...args, "--json"],
      atlas.implementation,
    );

    expect(result.code).toBe(2);
    expect(envelope(result.err).error?.code).toBe("invalid_arguments");
    expect(envelope(result.err).error?.message).toContain(expected);
    expect(atlas.implementation).not.toHaveBeenCalled();
  });
});
