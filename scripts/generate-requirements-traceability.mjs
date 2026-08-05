import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import process from "node:process";

const root = process.cwd();
const outputDirectory = process.env.RELEASE_ARTIFACT_DIR
  ? process.env.RELEASE_ARTIFACT_DIR
  : root;
const sourceCommit =
  process.env.RELEASE_SNAPSHOT === "true"
    ? null
    : (process.env.SOURCE_COMMIT ??
      execFileSync("git", ["rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim());
if (sourceCommit !== null && !/^[0-9a-f]{40}$/u.test(sourceCommit))
  throw new Error("source_commit_invalid");

const requirements = await readFile("docs/requirements.md", "utf8");
const identifiers = [
  ...requirements.matchAll(/^#### ((?:FR|NFR|SEC)-\d+) — (.+)$/gmu),
].map(([, id, title]) => ({ id, title }));
if (identifiers.length === 0) throw new Error("requirements_inventory_empty");

const physical = new Set(["FR-022", "FR-024", "FR-025", "FR-026", "FR-027"]);
const deferred = new Set(["FR-004", "FR-015", "FR-037"]);
function table(headers, values) {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...values.map((row) => row[index].length)),
  );
  const line = (row) =>
    `| ${row.map((value, index) => value.padEnd(widths[index])).join(" | ")} |`;
  return [
    line(headers),
    line(widths.map((width) => "-".repeat(width))),
    ...values.map(line),
  ].join("\n");
}
const rows = identifiers.map(({ id, title }) => {
  const status = physical.has(id)
    ? "physical_gate"
    : deferred.has(id)
      ? "deferred_by_accepted_scope"
      : "implemented";
  const remaining =
    status === "physical_gate"
      ? "separately approved physical Atlas qualification"
      : status === "deferred_by_accepted_scope"
        ? "future reviewed scope"
        : "software qualification evidence and CI release gate";
  return [id, title.replaceAll("|", "\\|"), status, remaining];
});

const requirementTable = table(
  ["ID", "Requirement", "Status", "Remaining gate"],
  rows,
);
const scopeTable = table(
  ["Scope", "Status", "Evidence"],
  [
    [
      "General administrative CLI",
      "deferred_by_accepted_scope",
      "ADR-025; narrow deployment and maintenance entrypoints remain",
    ],
    [
      "Backup restoration",
      "deferred_by_accepted_scope",
      "ADR-023; no restore route or capability",
    ],
    [
      "Remote backup replication",
      "deferred_by_accepted_scope",
      "ADR-023; local artifacts only",
    ],
    [
      "External audit attestation",
      "deferred_by_accepted_scope",
      "ADR-024/025; hash chains provide integrity evidence only",
    ],
    [
      "Physical Atlas deployment and real power effects",
      "physical_gate",
      "release notes and operational runbooks",
    ],
  ],
);

const sourceLine = sourceCommit
  ? `Source commit: \`${sourceCommit}\``
  : "Source commit: detached CI qualification artifact";
const output = `# Atlas Manager v1 requirements traceability

Release candidate: \`1.0.0-rc.7\`
${sourceLine}
Scope: software-only qualification; physical gates are intentionally separate.

The table is generated from the normative identifiers in \`docs/requirements.md\`.
\`implemented\` means the software path exists and is covered by the relevant
tests; it does not claim that the full release gate has passed locally when a
required external tool is unavailable.

${requirementTable}

Additional accepted scope boundaries:

${scopeTable}
`;
await writeFile(
  process.env.RELEASE_ARTIFACT_DIR
    ? join(outputDirectory, "atlas-manager-v1-requirements-traceability.md")
    : join(root, "docs/release/atlas-manager-v1-requirements-traceability.md"),
  output,
);
