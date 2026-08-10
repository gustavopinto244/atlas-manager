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
const TARGET_ID = "atlas-config";
const RETENTION_PATH = `${BASE_URL}/admin/backups/targets/${TARGET_ID}/retention`;
const PRUNE_PATH = `${RETENTION_PATH}/prunes`;

const TARGET_RECORD = Object.freeze({
  id: TARGET_ID,
  displayName: "Atlas Configuration",
  kind: "mock",
  scheduleMode: "manual",
  retentionSummary: { keepLastSuccessful: 5, maxSuccessfulAgeDays: null },
  capabilities: { manualRun: true, schedule: true, retention: true },
});

const RETENTION_POLICY = Object.freeze({
  keepLastSuccessful: 7,
  maxSuccessfulAgeDays: 30,
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
      if (method === "GET" && url.endsWith("/retention"))
        return stub.reread === undefined
          ? json(200, RETENTION_POLICY)
          : stub.reread();
      if (method === "GET")
        return stub.target === undefined
          ? json(200, TARGET_RECORD)
          : stub.target();
      return stub.mutate === undefined
        ? json(200, RETENTION_POLICY)
        : stub.mutate();
    });
  return { implementation, calls };
}

function pruneResult(
  result: string,
  processedCount = 9,
  deletedCount = 4,
): unknown {
  return { targetId: TARGET_ID, processedCount, deletedCount, result };
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
): Promise<Readonly<{ code: number; out: string; err: string }>> {
  const output = new PassThrough();
  const errors = new PassThrough();
  const transport = createAtlasHttpTransport({
    baseUrl: BASE_URL,
    administrativeAccessToken: "externally-issued-assertion",
    fetchImplementation,
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

describe("atlas backups retention set", () => {
  it("forwards the policy verbatim through the canonical retention route", async () => {
    const atlas = fakeAtlas();
    const result = await runCli(
      [
        "backups",
        "retention",
        "set",
        TARGET_ID,
        "--policy",
        JSON.stringify(RETENTION_POLICY),
        "--json",
      ],
      atlas.implementation,
    );

    expect(result.code).toBe(0);
    expect(envelope(result.out).data).toMatchObject({
      targetId: TARGET_ID,
      operation: "update",
      result: "completed",
      authoritativeRead: "ok",
      policy: RETENTION_POLICY,
    });
    expect(atlas.calls[1]).toEqual({
      method: "PUT",
      url: RETENTION_PATH,
      body: {
        confirmation: "confirm_registered_backup_retention_update",
        policy: RETENTION_POLICY,
      },
    });
  });

  it.each([
    ['{"keepLastSuccessful":0}', "below the minimum"],
    ['{"keepLastSuccessful":101}', "above the maximum"],
    ['{"maxSuccessfulAgeDays":30}', "missing the required field"],
    ['{"keepLastSuccessful":5,"unexpected":true}', "carrying an unknown field"],
  ])("leaves a policy %s (%s) for the server to reject", async (policy) => {
    const atlas = fakeAtlas({
      mutate: () => json(400, errorBody("invalid_backup_request")),
    });
    const result = await runCli(
      ["backups", "retention", "set", TARGET_ID, "--policy", policy, "--json"],
      atlas.implementation,
    );

    // The CLI never second-guesses the retention bounds: it dispatches the
    // policy and reports the server's refusal as an invalid policy, not as
    // a retryable infrastructure problem.
    expect(result.code).toBe(1);
    expect(envelope(result.err).error?.code).toBe("schedule_invalid");
    expect(atlas.calls.filter((call) => call.method === "PUT")).toHaveLength(1);
  });

  it("reports an unknown target without dispatching a mutation", async () => {
    const atlas = fakeAtlas({
      target: () => json(404, errorBody("registered_backup_target_not_found")),
    });
    const result = await runCli(
      [
        "backups",
        "retention",
        "set",
        "no-such-target",
        "--policy",
        '{"keepLastSuccessful":5}',
        "--json",
      ],
      atlas.implementation,
    );

    expect(result.code).toBe(1);
    expect(envelope(result.err).error?.code).toBe("backup_target_not_found");
    expect(atlas.calls.map((call) => call.method)).toEqual(["GET"]);
  });

  it("writes retention even for a target whose scheduling is disabled", async () => {
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
        "retention",
        "set",
        TARGET_ID,
        "--policy",
        '{"keepLastSuccessful":5}',
        "--json",
      ],
      atlas.implementation,
    );

    // Retention applies to every registered target, so the schedule
    // capability must not gate it.
    expect(result.code).toBe(0);
    expect(atlas.calls.filter((call) => call.method === "PUT")).toHaveLength(1);
  });
});

describe("atlas backups retention prune — outcome is read from the result, not the status", () => {
  it("reports a completed prune with the counts the server returned", async () => {
    const atlas = fakeAtlas({
      mutate: () => json(200, pruneResult("completed")),
    });
    const result = await runCli(
      ["backups", "retention", "prune", TARGET_ID, "--json"],
      atlas.implementation,
    );

    expect(result.code).toBe(0);
    expect(envelope(result.out).data).toMatchObject({
      targetId: TARGET_ID,
      operation: "prune",
      result: "completed",
      processedCount: 9,
      deletedCount: 4,
    });
    expect(atlas.calls[1]).toEqual({
      method: "POST",
      url: PRUNE_PATH,
      body: { confirmation: "confirm_registered_backup_retention_prune" },
    });
  });

  it("reports a partial prune as a known failure carrying its counts", async () => {
    const atlas = fakeAtlas({
      mutate: () => json(200, pruneResult("partial", 9, 3)),
    });
    const result = await runCli(
      ["backups", "retention", "prune", TARGET_ID, "--json"],
      atlas.implementation,
    );

    // The server already said exactly how much succeeded, so this is a known
    // partial failure and not an ambiguity.
    expect(result.code).toBe(1);
    const error = envelope(result.err).error;
    expect(error?.code).toBe("backup_operation_failed");
    expect(error?.message).toContain("partial");
    expect(error?.message).toContain("9");
    expect(error?.message).toContain("3");
  });

  it.each(["busy", "blocked"])(
    "reports a %s prune as an indeterminate outcome",
    async (outcome) => {
      const atlas = fakeAtlas({
        mutate: () => json(200, pruneResult(outcome, 0, 0)),
      });
      const result = await runCli(
        ["backups", "retention", "prune", TARGET_ID, "--json"],
        atlas.implementation,
      );

      // HTTP 200 is not success here. The prune did not run to completion and
      // the operator cannot tell from this response what was deleted.
      expect(result.code).toBe(5);
      const error = envelope(result.err).error;
      expect(error?.code).toBe("mutation_outcome_unknown");
      expect(error?.message).toContain(outcome);
      expect(error?.message).toContain("atlas backups runs");
    },
  );

  it("renders the outcome word verbatim in human output", async () => {
    const atlas = fakeAtlas({
      mutate: () => json(200, pruneResult("completed")),
    });
    const result = await runCli(
      ["backups", "retention", "prune", TARGET_ID],
      atlas.implementation,
    );

    expect(result.out).toBe(
      `Backup target: ${TARGET_ID}\nRetention prune: completed\nProcessed: 9\nDeleted: 4\n`,
    );
  });

  it("rejects a prune response missing its counts", async () => {
    const atlas = fakeAtlas({
      mutate: () => json(200, { result: "completed" }),
    });
    const result = await runCli(
      ["backups", "retention", "prune", TARGET_ID, "--json"],
      atlas.implementation,
    );

    expect(result.code).toBe(1);
    expect(envelope(result.err).error?.code).toBe("backup_operation_failed");
  });

  it("maps a busy backup gate to the conflict exit code without retrying", async () => {
    const atlas = fakeAtlas({
      mutate: () => json(409, errorBody("backup_operation_busy")),
    });
    const result = await runCli(
      ["backups", "retention", "prune", TARGET_ID, "--json"],
      atlas.implementation,
    );

    expect(result.code).toBe(4);
    expect(envelope(result.err).error?.code).toBe("operation_conflict");
    expect(atlas.calls.filter((call) => call.method === "POST")).toHaveLength(
      1,
    );
  });

  it("reports a possibly delivered prune as indeterminate and never retries", async () => {
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
      ["backups", "retention", "prune", TARGET_ID, "--json"],
      atlas.implementation,
    );

    expect(result.code).toBe(5);
    expect(envelope(result.err).error?.code).toBe("mutation_outcome_unknown");
    expect(atlas.calls.filter((call) => call.method === "POST")).toHaveLength(
      1,
    );
  });

  it("reports an unknown target without dispatching a prune", async () => {
    const atlas = fakeAtlas({
      target: () => json(404, errorBody("registered_backup_target_not_found")),
    });
    const result = await runCli(
      ["backups", "retention", "prune", "no-such-target", "--json"],
      atlas.implementation,
    );

    expect(result.code).toBe(1);
    expect(envelope(result.err).error?.code).toBe("backup_target_not_found");
    expect(atlas.calls.map((call) => call.method)).toEqual(["GET"]);
  });
});

describe("atlas backups retention prune — the confirmation has no bypass", () => {
  it.each(["--force", "--yes", "-y", "--no-confirm", "--confirm"])(
    "rejects %s as an unknown option and never dispatches",
    async (flag) => {
      const atlas = fakeAtlas();
      const result = await runCli(
        ["backups", "retention", "prune", flag, "--json"],
        atlas.implementation,
      );

      // The canonical confirmation the server requires is supplied by the
      // route descriptor and is the only accepted authorization. There is
      // deliberately no CLI flag that skips or pre-answers it.
      expect(result.code).toBe(2);
      expect(envelope(result.err).error?.code).toBe("invalid_arguments");
      expect(envelope(result.err).error?.message).toContain("Unknown option");
      expect(atlas.implementation).not.toHaveBeenCalled();
    },
  );

  it("rejects a bypass flag placed after a valid target id", async () => {
    const atlas = fakeAtlas();
    const result = await runCli(
      ["backups", "retention", "prune", TARGET_ID, "--force", "--json"],
      atlas.implementation,
    );

    expect(result.code).toBe(2);
    expect(envelope(result.err).error?.message).toContain(
      "Unexpected argument",
    );
    expect(atlas.implementation).not.toHaveBeenCalled();
  });
});

describe("atlas backups retention arguments", () => {
  it.each([
    [["set"], [] as string[], "backup target id is required"],
    [["set"], [TARGET_ID], "Option --policy <json> is required"],
    [
      ["set"],
      [TARGET_ID, "--policy", "{oops"],
      "Option --policy requires valid JSON",
    ],
    [["set"], ["Not_A_Target", "--policy", "{}"], "Invalid backup target id"],
    [["prune"], [], "backup target id is required"],
    [["prune"], ["/var/lib/atlas"], "Invalid backup target id"],
    [["show"], [TARGET_ID, "extra"], "Unexpected argument"],
  ])("rejects %j %j as a usage error", async (subcommand, args, expected) => {
    const atlas = fakeAtlas();
    const result = await runCli(
      ["backups", "retention", ...subcommand, ...args, "--json"],
      atlas.implementation,
    );

    expect(result.code).toBe(2);
    expect(envelope(result.err).error?.code).toBe("invalid_arguments");
    expect(envelope(result.err).error?.message).toContain(expected);
    expect(atlas.implementation).not.toHaveBeenCalled();
  });
});
