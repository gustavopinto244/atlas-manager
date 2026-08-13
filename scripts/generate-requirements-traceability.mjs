import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import process from "node:process";

const root = process.cwd();
const checkVersioned = process.argv[2] === "--check-versioned";
if (process.argv.length !== (checkVersioned ? 3 : 2))
  throw new Error("traceability_arguments_invalid");
if (checkVersioned && process.env.RELEASE_ARTIFACT_DIR)
  throw new Error("traceability_arguments_invalid");
const outputDirectory = process.env.RELEASE_ARTIFACT_DIR
  ? process.env.RELEASE_ARTIFACT_DIR
  : root;
const packageJson = JSON.parse(
  await readFile(join(root, "package.json"), "utf8"),
);
const sourceCommit =
  checkVersioned || process.env.RELEASE_SNAPSHOT === "true"
    ? null
    : (process.env.SOURCE_COMMIT ??
      execFileSync("git", ["rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim());
if (sourceCommit !== null && !/^[0-9a-f]{40}$/u.test(sourceCommit))
  throw new Error("source_commit_invalid");

const requirements = await readFile("docs/requirements.md", "utf8");
const statusConfiguration = JSON.parse(
  await readFile("scripts/requirements-traceability-status.json", "utf8"),
);
const identifiers = [
  ...requirements.matchAll(/^#### ((?:FR|NFR|SEC)-\d+) — (.+)$/gmu),
].map(([, id, title]) => ({ id, title }));
if (identifiers.length === 0) throw new Error("requirements_inventory_empty");

const implementedWithPhysicalGate = new Map(
  Object.entries(statusConfiguration.implementedWithPhysicalGate ?? {}),
);
const implementedValues = statusConfiguration.implemented ?? [];
const deferredValues = statusConfiguration.deferredByAcceptedScope ?? [];
if (!Array.isArray(implementedValues) || !Array.isArray(deferredValues))
  throw new Error("requirement_status_invalid");
if (
  implementedValues.some((id) => typeof id !== "string") ||
  deferredValues.some((id) => typeof id !== "string")
)
  throw new Error("requirement_status_invalid");
const implemented = new Set(implementedValues);
const deferred = new Set(deferredValues);
if (
  implemented.size !== implementedValues.length ||
  deferred.size !== deferredValues.length
)
  throw new Error("requirement_status_duplicate");
const requirementIds = new Set(identifiers.map(({ id }) => id));
for (const remainingGate of implementedWithPhysicalGate.values()) {
  if (typeof remainingGate !== "string" || remainingGate.length === 0)
    throw new Error("requirement_status_invalid");
}
for (const id of [
  ...implemented,
  ...implementedWithPhysicalGate.keys(),
  ...deferred,
]) {
  if (!requirementIds.has(id)) throw new Error("requirement_status_unknown");
}
for (const id of requirementIds) {
  const classificationCount =
    Number(implemented.has(id)) +
    Number(implementedWithPhysicalGate.has(id)) +
    Number(deferred.has(id));
  if (classificationCount === 0) throw new Error("requirement_status_missing");
  if (classificationCount !== 1) throw new Error("requirement_status_conflict");
}
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
  const status = implementedWithPhysicalGate.has(id)
    ? "implemented_with_physical_gate"
    : deferred.has(id)
      ? "deferred_by_accepted_scope"
      : implemented.has(id)
        ? "implemented"
        : (() => {
            throw new Error("requirement_status_missing");
          })();
  const remaining =
    status === "implemented_with_physical_gate"
      ? implementedWithPhysicalGate.get(id)
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
      "implemented",
      "ADR-027/031/032/034; source command inventory and operator package tests",
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

Release: \`${process.env.RELEASE_VERSION ?? packageJson.version}\`
${sourceLine}
Scope: software/control-plane traceability; physical-effect gates remain separate.

The table is generated from the normative identifiers in \`docs/requirements.md\`.
\`implemented\` means the software path exists and is covered by the relevant
tests; it does not claim that the full release gate has passed locally when a
required external tool is unavailable.

${requirementTable}

Additional accepted scope boundaries:

${scopeTable}
`;
const outputPath = process.env.RELEASE_ARTIFACT_DIR
  ? join(outputDirectory, "atlas-manager-v1-requirements-traceability.md")
  : join(root, "docs/release/atlas-manager-v1-requirements-traceability.md");
if (checkVersioned) {
  if ((await readFile(outputPath, "utf8")) !== output)
    throw new Error("versioned_traceability_generation_mismatch");
  process.stdout.write('{"result":"equivalent"}\n');
} else {
  await writeFile(outputPath, output);
}
