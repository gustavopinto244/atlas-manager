import { readFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";

const root = process.cwd();
const readJson = async (relative) =>
  JSON.parse(await readFile(join(root, relative), "utf8"));
const evidence = await readJson(
  "atlas-manager-v1-software-release-candidate-evidence.json",
);
const contract = await readJson(
  "docs/contracts/atlas-manager-release-contract.json",
);
const traceability = await readFile(
  join(root, "docs/release/atlas-manager-v1-requirements-traceability.md"),
  "utf8",
);

if (evidence.result !== "not_qualified")
  throw new Error("versioned_evidence_must_not_be_qualified");
if (evidence.sourceCommit !== null || evidence.baselineCommit !== null)
  throw new Error("versioned_evidence_commit_must_be_null");
if (evidence.bundle?.sourceCommit !== null)
  throw new Error("versioned_bundle_commit_must_be_null");
if (evidence.bundle?.dashboardAssetsSha256 !== null)
  throw new Error("versioned_dashboard_digest_must_be_null");
if (evidence.rehearsal?.sourceCommit !== null)
  throw new Error("versioned_rehearsal_commit_must_be_null");
if (evidence.bundle?.sha256 !== null)
  throw new Error("versioned_bundle_digest_must_be_null");
if (evidence.rehearsal?.evidenceSha256 !== null)
  throw new Error("versioned_rehearsal_digest_must_be_null");
if (contract.sourceCommit !== null)
  throw new Error("versioned_contract_commit_must_be_null");
for (const field of [
  "administrativeApiContractSha256",
  "productionDependenciesSha256",
  "documentationInventorySha256",
  "requirementsTraceabilitySha256",
]) {
  if (contract[field] !== null)
    throw new Error(`versioned_contract_digest_must_be_null:${field}`);
}
if (contract.dashboardAssetsSha256 !== null)
  throw new Error("versioned_dashboard_digest_must_be_null");
if (contract.bundleSha256 !== null)
  throw new Error("versioned_bundle_digest_must_be_null");
if (contract.releaseAcceptanceEvidenceSha256 !== null)
  throw new Error("versioned_evidence_digest_must_be_null");
if (!traceability.includes("Source commit: detached CI qualification artifact"))
  throw new Error("versioned_traceability_must_be_detached");
if (/Source commit: `?[0-9a-f]{40}/u.test(traceability))
  throw new Error("versioned_traceability_contains_commit");

process.stdout.write(
  JSON.stringify({ result: "valid", versionedEvidence: "not_qualified" }) +
    "\n",
);
