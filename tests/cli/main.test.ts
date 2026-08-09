import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import { runAtlasCli } from "../../src/cli/main.js";

function stream(): PassThrough {
  return new PassThrough();
}

async function content(value: PassThrough): Promise<string> {
  const chunks: Buffer[] = [];
  value.on("data", (chunk: Buffer) => chunks.push(chunk));
  await new Promise<void>((resolve) => value.end(resolve));
  return Buffer.concat(chunks).toString("utf8");
}

describe("atlas CLI entrypoint", () => {
  it("renders the installed package version", async () => {
    const output = stream();
    const errors = stream();

    await expect(
      runAtlasCli(["--version"], undefined, output, errors),
    ).resolves.toBe(0);
    await expect(content(output)).resolves.toBe("1.0.0-rc.10\n");
    await expect(content(errors)).resolves.toBe("");
  });

  it("renders root help", async () => {
    const output = stream();
    const errors = stream();

    await expect(
      runAtlasCli(["--help"], undefined, output, errors),
    ).resolves.toBe(0);
    await expect(content(output)).resolves.toContain("atlas <command>");
    await expect(content(errors)).resolves.toBe("");
  });

  it("renders nested help", async () => {
    const output = stream();
    const errors = stream();

    await expect(
      runAtlasCli(
        ["services", "schedule", "--help"],
        undefined,
        output,
        errors,
      ),
    ).resolves.toBe(0);
    await expect(content(output)).resolves.toContain("services schedule show");
  });

  it("uses stable JSON and invalid-command exit codes", async () => {
    const output = stream();
    const errors = stream();

    await expect(
      runAtlasCli(["not-a-command", "--json"], undefined, output, errors),
    ).resolves.toBe(2);
    const result = JSON.parse(await content(errors)) as {
      error: { code: string };
    };
    expect(result.error.code).toBe("unknown_command");
  });

  it("does not claim an unimplemented command succeeded", async () => {
    const output = stream();
    const errors = stream();

    await expect(
      runAtlasCli(["infra", "status"], undefined, output, errors),
    ).resolves.toBe(2);
    expect(await content(errors)).toContain("command_not_implemented");
  });
});
