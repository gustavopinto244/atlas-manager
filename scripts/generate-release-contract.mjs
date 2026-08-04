import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { Buffer } from "node:buffer";
import process from "node:process";

const root = process.cwd();
const outputDirectory = process.env.RELEASE_ARTIFACT_DIR
  ? process.env.RELEASE_ARTIFACT_DIR
  : root;
const snapshot = process.env.RELEASE_SNAPSHOT === "true";
const digest = (value) => createHash("sha256").update(value).digest("hex");
const bytes = async (relative) => readFile(join(root, relative));
const documentationBytes = async (relative) =>
  relative === "docs/release/atlas-manager-v1-requirements-traceability.md" &&
  sourceCommit !== null &&
  process.env.RELEASE_ARTIFACT_DIR
    ? readFile(
        join(
          process.env.RELEASE_ARTIFACT_DIR,
          "atlas-manager-v1-requirements-traceability.md",
        ),
      )
    : bytes(relative);
const sourceCommit = snapshot
  ? null
  : (process.env.SOURCE_COMMIT ??
    execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim());
if (sourceCommit !== null && !/^[0-9a-f]{40}$/u.test(sourceCommit))
  throw new Error("source_commit_invalid");
const packageJson = JSON.parse(
  await readFile(join(root, "package.json"), "utf8"),
);
const api = await bytes("docs/contracts/atlas-manager-administrative-api.json");
const dependencies = await bytes(
  "docs/release/atlas-manager-production-dependencies.json",
);
const requirements = await readFile(
  sourceCommit !== null && process.env.RELEASE_ARTIFACT_DIR
    ? join(
        process.env.RELEASE_ARTIFACT_DIR,
        "atlas-manager-v1-requirements-traceability.md",
      )
    : join(root, "docs/release/atlas-manager-v1-requirements-traceability.md"),
);
const dashboard = Buffer.concat([
  await bytes("src/dashboard/main.ts"),
  await bytes("src/dashboard/styles.css"),
]);
const dashboardAssetsSha256 = process.env.DASHBOARD_ASSETS_SHA256;
const documentationFiles = [
  "CHANGELOG.md",
  "SECURITY.md",
  "docs/release/atlas-manager-1.0.0-rc.6.md",
  "docs/release/atlas-manager-v1-security-review.md",
  "docs/release/atlas-manager-v1-operational-readiness.md",
  "docs/release/atlas-manager-v1-requirements-traceability.md",
];
const documentation = Buffer.concat(
  await Promise.all(
    documentationFiles.map(async (relative) =>
      Buffer.concat([
        Buffer.from(`${relative}\n`),
        await documentationBytes(relative),
      ]),
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
  administrativeApiContractSha256: snapshot ? null : digest(api),
  dashboardAssetsSha256: snapshot
    ? null
    : dashboardAssetsSha256 || digest(dashboard),
  productionDependenciesSha256: snapshot ? null : digest(dependencies),
  documentationInventorySha256: snapshot ? null : digest(documentation),
  bundleSha256: snapshot ? null : (process.env.BUNDLE_SHA256 ?? null),
  requirementsTraceabilitySha256: snapshot ? null : digest(requirements),
  releaseAcceptanceEvidenceSha256: snapshot
    ? null
    : (process.env.RELEASE_EVIDENCE_SHA256 ?? null),
};
await writeFile(
  process.env.RELEASE_ARTIFACT_DIR
    ? join(outputDirectory, "atlas-manager-release-contract.json")
    : join(root, "docs/contracts/atlas-manager-release-contract.json"),
  `${JSON.stringify(contract, null, 2)}\n`,
);
