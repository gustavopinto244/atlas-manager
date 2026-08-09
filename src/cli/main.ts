#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { commandPath, findCommand } from "./command-tree.js";
import { AtlasCliError, exitCodeForCliError } from "./errors.js";
import type { AtlasCliTransport, CliResult } from "./contracts.js";
import { helpFor } from "./help.js";
import { createAtlasHttpTransport } from "./http-transport.js";
import { parseCliArguments } from "./parser.js";

const packageMetadata = createRequire(import.meta.url)("../../package.json") as
  Readonly<{ version?: unknown }> | undefined;
const cliVersion = readCliVersion(packageMetadata?.version);

function readCliVersion(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(value)
  )
    throw new Error("cli_package_version_invalid");
  return value;
}

export async function runAtlasCli(
  argv: readonly string[],
  transport?: AtlasCliTransport,
  output: NodeJS.WritableStream = process.stdout,
  errorOutput: NodeJS.WritableStream = process.stderr,
): Promise<number> {
  if (argv.length === 1 && (argv[0] === "--version" || argv[0] === "-V")) {
    output.write(`${cliVersion}\n`);
    return 0;
  }
  let parsed;
  try {
    parsed = parseCliArguments(argv);
    if (parsed.help) {
      output.write(helpFor(parsed.command));
      return 0;
    }
    const command = findCommand(parsed.command);
    if (command === undefined) {
      throw new AtlasCliError("unknown_command", "Unknown command");
    }
    if (!command.implemented && transport === undefined) {
      throw new AtlasCliError(
        "command_not_implemented",
        `Command not implemented yet: ${commandPath(parsed.command)}`,
      );
    }
    const effectiveTransport = transport ?? createAtlasHttpTransport();
    const controller = new AbortController();
    const onInterrupt = (): void => controller.abort();
    process.once("SIGINT", onInterrupt);
    try {
      const data = await effectiveTransport.execute(
        commandPath(parsed.command),
        parsed.commandArguments,
        controller.signal,
      );
      writeResult(output, parsed.format, {
        schemaVersion: 1,
        command: commandPath(parsed.command),
        status: "ok",
        data,
      });
      return 0;
    } finally {
      process.off("SIGINT", onInterrupt);
    }
  } catch (error) {
    const cliError =
      error instanceof AtlasCliError
        ? error
        : new AtlasCliError("infrastructure_unavailable", "Command failed");
    const format =
      parsed?.format ?? (argv.includes("--json") ? "json" : "human");
    const result: CliResult = {
      schemaVersion: 1,
      command: parsed === undefined ? "" : commandPath(parsed.command),
      status: "error",
      error: { code: cliError.code, message: cliError.message },
    };
    writeResult(errorOutput, format, result);
    return exitCodeForCliError(cliError);
  }
}

function writeResult(
  output: NodeJS.WritableStream,
  format: "human" | "json",
  result: CliResult,
): void {
  if (format === "json") {
    output.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (result.status === "ok") {
    output.write(`${JSON.stringify(result.data, null, 2)}\n`);
    return;
  }
  output.write(`error: ${result.error?.code}: ${result.error?.message}\n`);
}

const invokedEntryPoint =
  process.argv[1] === undefined ? undefined : realpathSync(process.argv[1]);
if (invokedEntryPoint === fileURLToPath(import.meta.url)) {
  void runAtlasCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
