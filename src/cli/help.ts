import { ATLAS_COMMANDS, commandPath } from "./command-tree.js";

export const ATLAS_HELP = `Atlas Manager operator CLI

Usage:
  atlas <command> [options]

Global options:
  --help, -h       Show help
  --json           Emit the stable JSON envelope

Commands:
${ATLAS_COMMANDS.map((command) => `  ${commandPath(command.path).padEnd(32)} ${command.summary}`).join("\n")}

Administrative mutations remain protected by the Atlas security boundary.
The CLI never forges Cloudflare Access assertions.
`;

export function helpFor(command: readonly string[]): string {
  if (command.length === 0) return ATLAS_HELP;
  const prefix = command.join(" ");
  const matches = ATLAS_COMMANDS.filter(
    (entry) => entry.path.slice(0, command.length).join(" ") === prefix,
  );
  if (matches.length === 0) return ATLAS_HELP;
  return `atlas ${prefix}\n\n${matches
    .map((entry) => `  ${commandPath(entry.path)} — ${entry.summary}`)
    .join("\n")}\n`;
}
