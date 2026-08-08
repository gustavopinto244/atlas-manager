#!/usr/bin/env node

import process from "node:process";
import { commandPath, findCommand } from "./command-tree.js";
import { AtlasCliError, exitCodeForCliError } from "./errors.js";
import type { AtlasCliTransport, CliResult } from "./contracts.js";
import { helpFor } from "./help.js";
import { parseCliArguments } from "./parser.js";

export async function runAtlasCli(
  argv: readonly string[],
  transport?: AtlasCliTransport,
  output: NodeJS.WritableStream = process.stdout,
  errorOutput: NodeJS.WritableStream = process.stderr,
): Promise<number> {
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
    if (!command.implemented || transport === undefined) {
      throw new AtlasCliError(
        "command_not_implemented",
        `Command not implemented yet: ${commandPath(parsed.command)}`,
      );
    }
    const controller = new AbortController();
    const onInterrupt = (): void => controller.abort();
    process.once("SIGINT", onInterrupt);
    try {
      const data = await transport.execute(
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

if (import.meta.url === `file://${process.argv[1]}`) {
  void runAtlasCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
