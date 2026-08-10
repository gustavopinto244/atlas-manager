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
const TARGET_ID = "atlas-config";
const SCHEDULE_PATH = `${BASE_URL}/admin/backups/targets/${TARGET_ID}/schedule`;

const TARGET_RECORD = Object.freeze({
  id: TARGET_ID,
  displayName: "Atlas Configuration",
  kind: "mock",
  scheduleMode: "manual",
  retentionSummary: { keepLastSuccessful: 5, maxSuccessfulAgeDays: null },
  capabilities: { manualRun: true, schedule: true, retention: true },
});

const MANUAL_SCHEDULE = Object.freeze({
  mode: "manual",
  timezone: null,
  schedule: null,
});

const SCHEDULED_POLICY = Object.freeze({
  mode: "scheduled",
  timezone: "America/Sao_Paulo",
  windows: [{ weekday: "sunday", start: "02:00", end: "03:00" }],
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
  target?: () => Response | Promise<Response>;
  mutate?: () => Response | Promise<Response>;
  reread?: () => Response | Promise<Response>;
}>;

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
          ? json(200, MANUAL_SCHEDULE)
          : stub.reread();
      if (method === "GET")
        return stub.target === undefined
          ? json(200, TARGET_RECORD)
          : stub.target();
      return stub.mutate === undefined
        ? json(200, MANUAL_SCHEDULE)
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

describe("atlas backups schedule set", () => {
  it("forwards the policy verbatim through the canonical schedule route", async () => {
    const atlas = fakeAtlas({
      mutate: () =>
        json(200, {
          mode: "scheduled",
          timezone: "America/Sao_Paulo",
          schedule: { windows: SCHEDULED_POLICY.windows },
        }),
      reread: () =>
        json(200, {
          mode: "scheduled",
          timezone: "America/Sao_Paulo",
          schedule: { windows: SCHEDULED_POLICY.windows },
        }),
    });
    const result = await runCli(
      [
        "backups",
        "schedule",
        "set",
        TARGET_ID,
        "--policy",
        JSON.stringify(SCHEDULED_POLICY),
        "--json",
      ],
      atlas.implementation,
    );

    expect(result.code).toBe(0);
    expect(envelope(result.out)).toMatchObject({
      status: "ok",
      command: "backups schedule set",
      data: {
        targetId: TARGET_ID,
        operation: "update",
        result: "completed",
        authoritativeRead: "ok",
        policy: { mode: "scheduled" },
      },
    });
    // Target pre-check, mutation, authoritative re-read.
    expect(atlas.calls.map((call) => call.method)).toEqual([
      "GET",
      "PUT",
      "GET",
    ]);
    expect(atlas.calls[1]).toEqual({
      method: "PUT",
      url: SCHEDULE_PATH,
      body: {
        confirmation: "confirm_registered_backup_schedule_update",
        policy: SCHEDULED_POLICY,
      },
    });
  });

  it("still reports an accepted mutation when the authoritative re-read fails", async () => {
    const atlas = fakeAtlas({
      reread: () => json(503, errorBody("backup_operation_unavailable")),
    });
    const result = await runCli(
      [
        "backups",
        "schedule",
        "set",
        TARGET_ID,
        "--policy",
        '{"mode":"manual"}',
        "--json",
      ],
      atlas.implementation,
    );

    expect(result.code).toBe(0);
    expect(envelope(result.out).data).toMatchObject({
      result: "completed",
      authoritativeRead: "unavailable",
      policy: null,
    });
  });

  it("maps a rejected policy to an invalid-policy failure, not a retryable one", async () => {
    const atlas = fakeAtlas({
      mutate: () => json(400, errorBody("invalid_backup_request")),
    });
    const result = await runCli(
      [
        "backups",
        "schedule",
        "set",
        TARGET_ID,
        "--policy",
        '{"mode":"whenever"}',
        "--json",
      ],
      atlas.implementation,
    );

    expect(result.code).toBe(1);
    expect(envelope(result.err).error?.code).toBe("schedule_invalid");
  });

  it("reports an unknown target without dispatching a mutation", async () => {
    const atlas = fakeAtlas({
      target: () => json(404, errorBody("registered_backup_target_not_found")),
    });
    const result = await runCli(
      [
        "backups",
        "schedule",
        "set",
        "no-such-target",
        "--policy",
        '{"mode":"manual"}',
        "--json",
      ],
      atlas.implementation,
    );

    expect(result.code).toBe(1);
    expect(envelope(result.err).error?.code).toBe("backup_target_not_found");
    expect(atlas.calls.map((call) => call.method)).toEqual(["GET"]);
  });

  it("refuses a target that does not support scheduling without dispatching", async () => {
    const atlas = fakeAtlas({
      target: () =>
        json(200, {
          ...TARGET_RECORD,
          scheduleMode: "disabled",
          capabilities: { manualRun: false, schedule: false, retention: true },
        }),
    });
    const result = await runCli(
      [
        "backups",
        "schedule",
        "set",
        TARGET_ID,
        "--policy",
        '{"mode":"manual"}',
        "--json",
      ],
      atlas.implementation,
    );

    expect(result.code).toBe(1);
    expect(envelope(result.err).error?.code).toBe(
      "backup_operation_unsupported",
    );
    expect(atlas.calls.map((call) => call.method)).toEqual(["GET"]);
  });

  it.each([409, 429])(
    "maps a busy or limited backup gate at %i to a conflict without retrying",
    async (status) => {
      const atlas = fakeAtlas({
        mutate: () =>
          json(
            status,
            errorBody(
              status === 409
                ? "backup_operation_busy"
                : "administrative_request_limited",
            ),
          ),
      });
      const result = await runCli(
        [
          "backups",
          "schedule",
          "set",
          TARGET_ID,
          "--policy",
          '{"mode":"manual"}',
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
        "backups",
        "schedule",
        "set",
        TARGET_ID,
        "--policy",
        '{"mode":"manual"}',
        "--json",
      ],
      atlas.implementation,
    );

    expect(result.code).toBe(1);
    expect(envelope(result.err).error?.code).toBe("backup_operation_failed");
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
        "backups",
        "schedule",
        "set",
        TARGET_ID,
        "--policy",
        '{"mode":"manual"}',
        "--json",
      ],
      atlas.implementation,
    );

    expect(result.code).toBe(5);
    expect(envelope(result.err).error?.code).toBe("mutation_outcome_unknown");
    expect(atlas.calls.filter((call) => call.method === "PUT")).toHaveLength(1);
  });

  it("reports a timed-out mutation as indeterminate and never retries", async () => {
    const atlas = fakeAtlas({
      mutate: async () =>
        new Promise<Response>(() => {
          /* never settles */
        }),
    });
    const result = await runCli(
      [
        "backups",
        "schedule",
        "set",
        TARGET_ID,
        "--policy",
        '{"mode":"manual"}',
        "--json",
      ],
      atlas.implementation,
      { mutationTimeoutMs: 20 },
    );

    expect(result.code).toBe(5);
    expect(envelope(result.err).error?.code).toBe("mutation_outcome_unknown");
  });

  it("reports an indeterminate outcome when interrupted after dispatch", async () => {
    const atlas = fakeAtlas({
      mutate: async () =>
        new Promise<Response>(() => {
          setImmediate(() => process.emit("SIGINT"));
        }),
    });
    const result = await runCli(
      [
        "backups",
        "schedule",
        "set",
        TARGET_ID,
        "--policy",
        '{"mode":"manual"}',
        "--json",
      ],
      atlas.implementation,
    );

    expect(result.code).toBe(130);
    expect(envelope(result.err).error?.code).toBe(
      "mutation_interrupted_outcome_unknown",
    );
  });
});

describe("atlas backups schedule remove", () => {
  it("removes the schedule and sends no policy key at all", async () => {
    const atlas = fakeAtlas();
    const result = await runCli(
      ["backups", "schedule", "remove", TARGET_ID, "--json"],
      atlas.implementation,
    );

    expect(result.code).toBe(0);
    expect(envelope(result.out).data).toMatchObject({
      targetId: TARGET_ID,
      operation: "delete",
      result: "completed",
    });
    const mutation = atlas.calls[1];
    expect(mutation).toEqual({
      method: "DELETE",
      url: SCHEDULE_PATH,
      body: { confirmation: "confirm_registered_backup_schedule_removal" },
    });
    expect(Object.keys(mutation?.body as Record<string, unknown>)).toEqual([
      "confirmation",
    ]);
  });
});

describe("atlas backups schedule — no mode alias subcommands exist", () => {
  it.each(["always", "manual", "disable", "disabled", "scheduled"])(
    "rejects `backups schedule %s` as an unknown command",
    async (alias) => {
      const atlas = fakeAtlas();
      const result = await runCli(
        ["backups", "schedule", alias, TARGET_ID, "--json"],
        atlas.implementation,
      );

      // Backup schedule modes are manual|scheduled|disabled — there is no
      // `always` — so partial alias parity with service schedules would be
      // more confusing than a single uniform `set --policy`.
      expect(result.code).toBe(2);
      expect(envelope(result.err).error?.code).toBe("unknown_command");
      expect(atlas.implementation).not.toHaveBeenCalled();
    },
  );
});

describe("atlas backups schedule arguments", () => {
  it.each([
    [["set"], [] as string[], "backup target id is required"],
    [["set"], [TARGET_ID], "Option --policy <json> is required"],
    [
      ["set"],
      [TARGET_ID, "--policy", "{oops"],
      "Option --policy requires valid JSON",
    ],
    [["set"], [TARGET_ID, "--force"], "Unknown option"],
    [["set"], ["/var/lib/atlas", "--policy", "{}"], "Invalid backup target id"],
    [["remove"], [], "backup target id is required"],
    [["remove"], [TARGET_ID, "extra"], "Unexpected argument"],
    [["remove"], ["--source", "/etc"], "Unknown option"],
    [["show"], [TARGET_ID, "extra"], "Unexpected argument"],
  ])("rejects %j %j as a usage error", async (subcommand, args, expected) => {
    const atlas = fakeAtlas();
    const result = await runCli(
      ["backups", "schedule", ...subcommand, ...args, "--json"],
      atlas.implementation,
    );

    expect(result.code).toBe(2);
    expect(envelope(result.err).error?.code).toBe("invalid_arguments");
    expect(envelope(result.err).error?.message).toContain(expected);
    expect(atlas.implementation).not.toHaveBeenCalled();
  });
});
