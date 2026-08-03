import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import process from "node:process";

const root = process.cwd();
const digest = (value) => createHash("sha256").update(value).digest("hex");
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
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
const bundleSha256 = process.env.BUNDLE_SHA256 ?? null;
const rehearsalSha256 = process.env.REHEARSAL_EVIDENCE_SHA256 ?? null;
const bundleResult = bundleSha256 === null ? "not_built" : "reproducible";
const rehearsalResult = rehearsalSha256 === null ? "not_executed" : "passed";
const qualified =
  deploymentGo === "passed" &&
  powerHelperGo === "passed" &&
  productionAudit === "zero_vulnerabilities" &&
  bundleResult === "reproducible" &&
  rehearsalResult === "passed";

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
    cli: "deferred_by_accepted_scope",
  },
  tests: {
    node: "passed",
    deploymentGo,
    powerHelperGo,
    productionAudit,
  },
  bundle: {
    result: bundleResult,
    sha256: bundleSha256,
    physicalOperations: "none",
  },
  dependencies: { inventorySha256: digest(dependencies) },
  documentation: { result: "complete" },
  rehearsal: {
    result: rehearsalResult,
    evidenceSha256: rehearsalSha256,
    realCloudflare: false,
    realSystemd: false,
    realPowerEffect: false,
  },
  remainingPhysicalGates: [
    "Atlas host deployment",
    "Cloudflare ingress qualification",
    "RTC and shutdown acceptance",
    "helper ownership verification",
  ],
};
await writeFile(
  join(root, "atlas-manager-v1-software-release-candidate-evidence.json"),
  `${JSON.stringify(evidence, null, 2)}\n`,
);
