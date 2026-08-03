import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import process from "node:process";

const root = process.cwd();
const readJson = async (relative) =>
  JSON.parse(await readFile(join(root, relative), "utf8"));
const digest = (value) => createHash("sha256").update(value).digest("hex");
const packageJson = await readJson("package.json");
const contract = await readJson(
  "docs/contracts/atlas-manager-release-contract.json",
);
const evidence = await readJson(
  "atlas-manager-v1-software-release-candidate-evidence.json",
);
const api = await readFile(
  join(root, "docs/contracts/atlas-manager-administrative-api.json"),
  "utf8",
);
const dependencies = await readFile(
  join(root, "docs/release/atlas-manager-production-dependencies.json"),
  "utf8",
);
const commit = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();

if (packageJson.version !== "1.0.0-rc.2")
  throw new Error("release_version_invalid");
if (contract.releaseVersion !== packageJson.version)
  throw new Error("release_contract_version_invalid");
if (contract.sourceCommit !== commit)
  throw new Error("release_contract_commit_invalid");
if (evidence.releaseVersion !== packageJson.version)
  throw new Error("release_evidence_version_invalid");
if (evidence.baselineCommit !== commit || evidence.sourceCommit !== commit)
  throw new Error("release_evidence_commit_invalid");
if (contract.administrativeApiContractSha256 !== digest(api))
  throw new Error("release_contract_api_digest_invalid");
if (contract.productionDependenciesSha256 !== digest(dependencies))
  throw new Error("release_contract_dependency_digest_invalid");
if (evidence.routeCatalog?.contractSha256 !== digest(api))
  throw new Error("release_evidence_api_digest_invalid");

const forbidden =
  /PLACEHOLDER|TBD|ci-generated|reproducible_in_ci|not_run|environment_unavailable|rc\.1/u;
for (const relative of [
  "docs/contracts/atlas-manager-administrative-api.json",
  "docs/contracts/atlas-manager-release-contract.json",
  "docs/release/atlas-manager-production-dependencies.json",
  "atlas-manager-v1-software-release-candidate-evidence.json",
]) {
  const value = await readFile(join(root, relative), "utf8");
  if (forbidden.test(value)) throw new Error("release_artifact_placeholder");
}

if (evidence.result === "qualified") {
  if (evidence.tests?.deploymentGo !== "passed")
    throw new Error("release_go_gate_missing");
  if (evidence.tests?.powerHelperGo !== "passed")
    throw new Error("release_power_helper_gate_missing");
  if (evidence.bundle?.result !== "reproducible")
    throw new Error("release_bundle_gate_missing");
  if (evidence.rehearsal?.result !== "passed")
    throw new Error("release_rehearsal_gate_missing");
}

process.stdout.write(
  JSON.stringify({
    result: "valid",
    releaseVersion: packageJson.version,
    sourceCommit: commit,
  }) + "\n",
);
