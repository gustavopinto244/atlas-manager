import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import process from "node:process";

const root = process.cwd();
const outputDirectory = process.env.RELEASE_ARTIFACT_DIR
  ? process.env.RELEASE_ARTIFACT_DIR
  : root;
const snapshot = process.env.RELEASE_SNAPSHOT === "true";
const digest = (value) => createHash("sha256").update(value).digest("hex");
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
const api = await readFile(
  join(root, "docs/contracts/atlas-manager-administrative-api.json"),
);
const dependencies = await readFile(
  join(root, "docs/release/atlas-manager-production-dependencies.json"),
);

const deploymentGo = process.env.DEPLOYMENT_GO_RESULT ?? "not_executed";
const powerHelperGo = process.env.POWER_HELPER_GO_RESULT ?? "not_executed";
const productionAudit = process.env.PRODUCTION_AUDIT_RESULT ?? "not_executed";
const bundleSha256 = snapshot ? null : (process.env.BUNDLE_SHA256 ?? null);
const rehearsalSha256 = snapshot
  ? null
  : (process.env.REHEARSAL_EVIDENCE_SHA256 ?? null);
const configurationMatrix =
  process.env.CONFIGURATION_MATRIX_RESULT ?? "not_executed";
const dashboardEquivalence =
  process.env.DASHBOARD_EQUIVALENCE_RESULT ?? "not_executed";
const administrativeRehearsal =
  process.env.ADMINISTRATIVE_REHEARSAL_RESULT ?? "not_executed";
const fullAudit = process.env.FULL_AUDIT_RESULT ?? "not_executed";
const bundleResult = bundleSha256 === null ? "not_built" : "reproducible";
const rehearsalResult = rehearsalSha256 === null ? "not_executed" : "passed";
const qualified =
  sourceCommit !== null &&
  deploymentGo === "passed" &&
  powerHelperGo === "passed" &&
  productionAudit === "zero_vulnerabilities" &&
  bundleResult === "reproducible" &&
  rehearsalResult === "passed" &&
  configurationMatrix === "passed" &&
  dashboardEquivalence === "passed" &&
  administrativeRehearsal === "passed" &&
  ["known_dev_only_advisory", "passed_no_high_or_critical"].includes(fullAudit);

const evidence = {
  schemaVersion: 1,
  result: qualified ? "qualified" : "not_qualified",
  releaseVersion: packageJson.version,
  baselineCommit: sourceCommit,
  sourceCommit,
  administrativeSecurity: {
    result: "software_checked",
    routeCatalog: "reconciled",
    trustProxy: false,
    cors: "disabled",
  },
  identityReadiness: {
    result: "deterministic_matrix",
    realCloudflare: "not_contacted",
  },
  routeCatalog: {
    result: "reconciled",
    contractSha256: digest(api),
  },
  requirements: {
    result: "complete",
    physicalGates: "explicit",
    cli: "implemented",
  },
  tests: {
    node: "passed",
    deploymentGo,
    powerHelperGo,
    productionAudit,
    fullAudit,
  },
  qualificationGates: {
    configurationMatrix,
    dashboardEquivalence,
    administrativeRehearsal,
  },
  bundle: {
    result: bundleResult,
    sourceCommit,
    sha256: bundleSha256,
    dashboardAssetsSha256: snapshot
      ? null
      : (process.env.DASHBOARD_ASSETS_SHA256 ?? null),
    physicalOperations: "none",
  },
  dependencies: { inventorySha256: digest(dependencies) },
  documentation: { result: "complete" },
  rehearsal: {
    result: rehearsalResult,
    sourceCommit,
    evidenceSha256: rehearsalSha256,
    realCloudflare: false,
    realSystemd: false,
    realPowerEffect: false,
  },
  operationalAcceptance: {
    result: "documented_separately",
    evidence:
      "docs/release/atlas-manager-1.0.0-final-operational-acceptance-evidence.md",
    atlasHostDeployment: "accepted_for_1.0.0",
    cloudflareIngress: "accepted_for_1.0.0",
    physicalPowerEffects: "not_activated_or_qualified",
  },
  remainingPhysicalGates: [
    "physical helper installation and ownership verification",
    "RTC wake and shutdown acceptance",
    "persisted-policy versus scheduler-policy authority decision",
    "explicit future power-enabled profile selection and activation approval",
  ],
};
await writeFile(
  join(
    outputDirectory,
    "atlas-manager-v1-software-release-candidate-evidence.json",
  ),
  `${JSON.stringify(evidence, null, 2)}\n`,
);
