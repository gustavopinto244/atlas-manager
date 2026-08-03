import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { Buffer } from "node:buffer";
import process from "node:process";

const root = process.cwd();
const digest = (value) => createHash("sha256").update(value).digest("hex");
const bytes = async (relative) => readFile(join(root, relative));
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
const packageJson = JSON.parse(
  await readFile(join(root, "package.json"), "utf8"),
);
const api = await bytes("docs/contracts/atlas-manager-administrative-api.json");
const dependencies = await bytes(
  "docs/release/atlas-manager-production-dependencies.json",
);
const requirements = await bytes(
  "docs/release/atlas-manager-v1-requirements-traceability.md",
);
const dashboard = Buffer.concat([
  await bytes("src/dashboard/main.ts"),
  await bytes("src/dashboard/styles.css"),
]);
const documentationFiles = [
  "CHANGELOG.md",
  "SECURITY.md",
  "docs/release/atlas-manager-1.0.0-rc.2.md",
  "docs/release/atlas-manager-v1-security-review.md",
  "docs/release/atlas-manager-v1-operational-readiness.md",
  "docs/release/atlas-manager-v1-requirements-traceability.md",
];
const documentation = Buffer.concat(
  await Promise.all(
    documentationFiles.map(async (relative) =>
      Buffer.concat([Buffer.from(`${relative}\n`), await bytes(relative)]),
    ),
  ),
);

const contract = {
  schemaVersion: 1,
  releaseVersion: packageJson.version,
  sourceCommit,
  sourceDateEpoch: Number(process.env.SOURCE_DATE_EPOCH ?? "0"),
  targetPlatform: "linux-amd64",
  nodeVersion: "24.18.0",
  npmVersion: "11.16.0",
  goVersion: "1.23.0",
  administrativeApiContractSha256: digest(api),
  dashboardAssetsSha256: digest(dashboard),
  productionDependenciesSha256: digest(dependencies),
  documentationInventorySha256: digest(documentation),
  bundleSha256: process.env.BUNDLE_SHA256 ?? null,
  requirementsTraceabilitySha256: digest(requirements),
  releaseAcceptanceEvidenceSha256: process.env.RELEASE_EVIDENCE_SHA256 ?? null,
};
await writeFile(
  join(root, "docs/contracts/atlas-manager-release-contract.json"),
  `${JSON.stringify(contract, null, 2)}\n`,
);
