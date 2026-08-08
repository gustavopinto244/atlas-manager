import { AtlasCliError } from "./errors.js";
import { ATLAS_COMMANDS, commandPath, findCommand } from "./command-tree.js";
import type { CliOutputFormat } from "./contracts.js";

export type ParsedCliArguments = Readonly<{
  command: readonly string[];
  commandArguments: readonly string[];
  format: CliOutputFormat;
  help: boolean;
}>;

export function parseCliArguments(argv: readonly string[]): ParsedCliArguments {
  const values = [...argv];
  let format: CliOutputFormat = "human";
  const commandArguments: string[] = [];
  const command: string[] = [];
  let help = false;

  const positional = values.filter(
    (value) => value !== "--json" && value !== "--help" && value !== "-h",
  );
  const explicitHelp = positional[0] === "help";
  if (explicitHelp) help = true;
  const helpTarget = explicitHelp ? positional.slice(1) : positional;
  const commandCandidate =
    explicitHelp || values.includes("--help") || values.includes("-h")
      ? helpTarget
      : longestKnownCommandPrefix(helpTarget);
  for (const value of values) {
    if (explicitHelp && value === "help") continue;
    if (value === "--json") {
      format = "json";
      continue;
    }
    if (value === "--help" || value === "-h") {
      help = true;
      continue;
    }
    if (
      command.length < commandCandidate.length &&
      commandArguments.length === 0
    ) {
      command.push(value);
    } else {
      commandArguments.push(value);
    }
  }

  if (command.length === 0) {
    if (help) return Object.freeze({ command, commandArguments, format, help });
    if (commandArguments.length > 0) {
      throw new AtlasCliError(
        "unknown_command",
        `Unknown command: ${commandArguments.join(" ")}`,
      );
    }
    throw new AtlasCliError("invalid_arguments", "A command is required");
  }
  if (command[0] === "help") {
    return Object.freeze({
      command: command.slice(1),
      commandArguments,
      format,
      help: true,
    });
  }
  if (!help && findCommand(command) === undefined) {
    throw new AtlasCliError(
      "unknown_command",
      `Unknown command: ${commandPath(command)}`,
    );
  }
  return Object.freeze({ command, commandArguments, format, help });
}

function longestKnownCommandPrefix(
  values: readonly string[],
): readonly string[] {
  let best: readonly string[] = [];
  for (const entry of ATLAS_COMMANDS) {
    if (
      entry.path.length > best.length &&
      entry.path.every((part, index) => part === values[index])
    ) {
      best = entry.path;
    }
  }
  return best;
}
