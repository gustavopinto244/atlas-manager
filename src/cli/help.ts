import { ATLAS_COMMANDS, commandPath } from "./command-tree.js";

export const ATLAS_HELP = `Atlas Manager operator CLI

Usage:
  atlas <command> [options]

Global options:
  --help, -h       Show help
  --json           Emit the stable JSON envelope

Commands:
${ATLAS_COMMANDS.map((command) => `  ${commandPath(command.path).padEnd(32)} ${command.summary}`).join("\n")}

Environment:
  ATLAS_BASE_URL                   Administrative endpoint (default http://127.0.0.1:3000)
  ATLAS_CLOUDFLARE_ACCESS_JWT      An externally issued Cloudflare Access assertion

Administrative mutations remain protected by the Atlas security boundary.
The CLI never forges Cloudflare Access assertions, never accepts a credential
as an argument, and never falls back to running PM2, Docker or systemd
directly when an administrative request is refused.
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
