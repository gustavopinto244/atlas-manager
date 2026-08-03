import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";

const artifactDirectory = process.env.RELEASE_ARTIFACT_DIR;
const sourceCommit = process.env.SOURCE_COMMIT;
if (!artifactDirectory) throw new Error("release_artifact_dir_required");
if (!sourceCommit || !/^[0-9a-f]{40}$/u.test(sourceCommit))
  throw new Error("source_commit_invalid");
const digestFile = async (name) =>
  createHash("sha256")
    .update(await readFile(join(artifactDirectory, name)))
    .digest("hex");
const evidence = JSON.parse(
  await readFile(
    join(
      artifactDirectory,
      "atlas-manager-v1-software-release-candidate-evidence.json",
    ),
    "utf8",
  ),
);
const contract = JSON.parse(
  await readFile(
    join(artifactDirectory, "atlas-manager-release-contract.json"),
    "utf8",
  ),
);
const traceability = await readFile(
  join(artifactDirectory, "atlas-manager-v1-requirements-traceability.md"),
  "utf8",
);
const rehearsalA = JSON.parse(
  await readFile(
    join(artifactDirectory, "atlas-manager-release-rehearsal-a.json"),
    "utf8",
  ),
);
const rehearsalB = JSON.parse(
  await readFile(
    join(artifactDirectory, "atlas-manager-release-rehearsal-b.json"),
    "utf8",
  ),
);
for (const value of [
  evidence.sourceCommit,
  evidence.baselineCommit,
  evidence.bundle?.sourceCommit,
  evidence.rehearsal?.sourceCommit,
  contract.sourceCommit,
  rehearsalA.sourceCommit,
  rehearsalB.sourceCommit,
]) {
  if (value !== sourceCommit) throw new Error("release_commit_mismatch");
}
const traceabilityMatch = traceability.match(
  /^Source commit: `([0-9a-f]{40})`$/mu,
);
if (traceabilityMatch?.[1] !== sourceCommit)
  throw new Error("traceability_commit_mismatch");
if (rehearsalA.result !== "passed" || rehearsalB.result !== "passed")
  throw new Error("rehearsal_not_passed");

const output = {
  schemaVersion: 1,
  sourceCommit,
  bundleSha256: process.env.BUNDLE_SHA256 ?? null,
  dashboardAssetsSha256: process.env.DASHBOARD_ASSETS_SHA256 ?? null,
  rehearsalEvidenceSha256: await digestFile(
    "atlas-manager-release-rehearsal-a.json",
  ),
  releaseEvidenceSha256: await digestFile(
    "atlas-manager-v1-software-release-candidate-evidence.json",
  ),
  releaseContractSha256: await digestFile(
    "atlas-manager-release-contract.json",
  ),
  requirementsTraceabilitySha256: await digestFile(
    "atlas-manager-v1-requirements-traceability.md",
  ),
};
await writeFile(
  join(artifactDirectory, "atlas-manager-release-digests.json"),
  `${JSON.stringify(output, null, 2)}\n`,
);
process.stdout.write(`${JSON.stringify({ result: "valid", ...output })}\n`);
