import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import { ATLAS_COMMANDS } from "../../src/cli/command-tree.js";
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
    await expect(content(output)).resolves.toBe("1.0.0\n");
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

  // ADR-032 completed the last five stubs, so no command reaches the
  // not-implemented branch any more. The branch itself still guards the
  // command tree: an entry declared without an implementation must never be
  // reported as a success.
  it("does not claim an unimplemented command succeeded", async () => {
    const output = stream();
    const errors = stream();

    await expect(
      runAtlasCli(["definitely", "not", "real"], undefined, output, errors),
    ).resolves.toBe(2);
    expect(await content(errors)).toContain("unknown_command");
  });

  it("leaves no command declared but unimplemented", () => {
    expect(
      ATLAS_COMMANDS.filter((command) => !command.implemented),
    ).toHaveLength(0);
  });
});
