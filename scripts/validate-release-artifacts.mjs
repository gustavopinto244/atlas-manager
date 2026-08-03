import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import process from "node:process";

const root = process.cwd();
const artifactDirectory = process.env.RELEASE_ARTIFACT_DIR ?? root;
const readArtifactJson = async (relative) =>
  JSON.parse(await readFile(join(artifactDirectory, relative), "utf8"));
const digest = (value) => createHash("sha256").update(value).digest("hex");
const packageJson = JSON.parse(
  await readFile(join(root, "package.json"), "utf8"),
);
const contract = await readArtifactJson("atlas-manager-release-contract.json");
const evidence = await readArtifactJson(
  "atlas-manager-v1-software-release-candidate-evidence.json",
);
const evidenceBytes = await readFile(
  join(
    artifactDirectory,
    "atlas-manager-v1-software-release-candidate-evidence.json",
  ),
);
const traceabilityBytes = await readFile(
  join(artifactDirectory, "atlas-manager-v1-requirements-traceability.md"),
);
const api = await readFile(
  join(root, "docs/contracts/atlas-manager-administrative-api.json"),
  "utf8",
);
const dependencies = await readFile(
  join(root, "docs/release/atlas-manager-production-dependencies.json"),
  "utf8",
);
const commit =
  process.env.SOURCE_COMMIT ??
  execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
if (!/^[0-9a-f]{40}$/u.test(commit)) throw new Error("source_commit_invalid");

if (packageJson.version !== "1.0.0-rc.3")
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
if (contract.requirementsTraceabilitySha256 !== digest(traceabilityBytes))
  throw new Error("release_contract_traceability_digest_invalid");
if (contract.releaseAcceptanceEvidenceSha256 !== digest(evidenceBytes))
  throw new Error("release_contract_evidence_digest_invalid");
if (evidence.routeCatalog?.contractSha256 !== digest(api))
  throw new Error("release_evidence_api_digest_invalid");
if (evidence.bundle?.sourceCommit !== commit)
  throw new Error("release_evidence_bundle_commit_invalid");
if (evidence.rehearsal?.sourceCommit !== commit)
  throw new Error("release_evidence_rehearsal_commit_invalid");
if (evidence.bundle?.sha256 !== contract.bundleSha256)
  throw new Error("release_bundle_digest_mismatch");
if (evidence.bundle?.dashboardAssetsSha256 !== contract.dashboardAssetsSha256)
  throw new Error("release_dashboard_digest_mismatch");
if (
  evidence.bundle?.dashboardAssetsSha256 !== null &&
  !/^[0-9a-f]{64}$/u.test(evidence.bundle?.dashboardAssetsSha256 ?? "")
)
  throw new Error("release_evidence_dashboard_digest_invalid");
const forbidden =
  /PLACEHOLDER|TBD|ci-generated|reproducible_in_ci|not_run|environment_unavailable|rc\.1/u;
for (const relative of [
  "docs/contracts/atlas-manager-administrative-api.json",
  "docs/release/atlas-manager-production-dependencies.json",
]) {
  const value = await readFile(join(root, relative), "utf8");
  if (forbidden.test(value)) throw new Error("release_artifact_placeholder");
}
for (const relative of [
  "atlas-manager-release-contract.json",
  "atlas-manager-v1-software-release-candidate-evidence.json",
  "atlas-manager-v1-requirements-traceability.md",
]) {
  const value = await readFile(join(artifactDirectory, relative), "utf8");
  if (forbidden.test(value)) throw new Error("release_artifact_placeholder");
}

if (evidence.result === "qualified") {
  if (evidence.qualificationGates?.configurationMatrix !== "passed")
    throw new Error("release_configuration_matrix_missing");
  if (evidence.qualificationGates?.dashboardEquivalence !== "passed")
    throw new Error("release_dashboard_equivalence_missing");
  if (evidence.qualificationGates?.administrativeRehearsal !== "passed")
    throw new Error("release_administrative_rehearsal_missing");
  if (evidence.tests?.deploymentGo !== "passed")
    throw new Error("release_go_gate_missing");
  if (evidence.tests?.powerHelperGo !== "passed")
    throw new Error("release_power_helper_gate_missing");
  if (evidence.bundle?.result !== "reproducible")
    throw new Error("release_bundle_gate_missing");
  if (evidence.rehearsal?.result !== "passed")
    throw new Error("release_rehearsal_gate_missing");
  if (
    !["known_dev_only_advisory", "passed_no_high_or_critical"].includes(
      evidence.tests?.fullAudit,
    )
  )
    throw new Error("release_full_audit_classification_missing");
}

process.stdout.write(
  JSON.stringify({
    result: "valid",
    releaseVersion: packageJson.version,
    sourceCommit: commit,
  }) + "\n",
);
