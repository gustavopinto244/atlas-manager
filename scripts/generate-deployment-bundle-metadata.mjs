import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { resolve, basename, join } from "node:path";
import process from "node:process";

const commitPattern = /^[0-9a-f]{40}$/u;
const shaPattern = /^[0-9a-f]{64}$/u;

const parseArguments = () => {
  const args = new Map();
  for (let index = 2; index < process.argv.length; index += 2) {
    const key = process.argv[index];
    const value = process.argv[index + 1];
    if (!key?.startsWith("--") || !value || args.has(key))
      throw new Error("deployment_bundle_metadata_arguments_invalid");
    args.set(key, resolve(value));
  }
  const required = ["--bundle-root", "--bundle-archive", "--output"];
  if (args.size < required.length || required.some((key) => !args.has(key)))
    throw new Error("deployment_bundle_metadata_arguments_invalid");
  return args;
};

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sha256File = async (path) => sha256(await readFile(path));
const requireFile = async (path, error) => {
  try {
    const info = await stat(path);
    if (!info.isFile()) throw new Error(error);
  } catch {
    throw new Error(error);
  }
};

const validateChecksums = async (bundleRoot, manifest) => {
  const checksumPath = join(bundleRoot, "SHA256SUMS");
  await requireFile(checksumPath, "deployment_bundle_checksums_missing");
  const lines = (await readFile(checksumPath, "utf8"))
    .split("\n")
    .filter(Boolean);
  const expected = new Map();
  for (const line of lines) {
    const match = /^(?<sha>[0-9a-f]{64}) {2}(?<path>[^\n]+)$/u.exec(line);
    if (
      !match?.groups?.sha ||
      !match.groups.path ||
      expected.has(match.groups.path)
    )
      throw new Error("deployment_bundle_checksums_invalid");
    expected.set(match.groups.path, match.groups.sha);
  }
  const requiredPaths = [
    ...manifest.files.map((file) => file.path),
    "MANIFEST.json",
  ];
  if (
    expected.size !== requiredPaths.length ||
    requiredPaths.some((path) => expected.get(path) === undefined)
  )
    throw new Error("deployment_bundle_checksums_inventory_invalid");
  for (const path of requiredPaths) {
    const actual = await sha256File(join(bundleRoot, path));
    if (actual !== expected.get(path))
      throw new Error("deployment_bundle_checksums_mismatch");
  }
};

const validateCommitBoundJson = async (path, sourceCommit, bundleSha256) => {
  if (!path) return;
  const value = JSON.parse(await readFile(path, "utf8"));
  if (value.sourceCommit !== sourceCommit)
    throw new Error("deployment_bundle_commit_mismatch");
  if (value.bundle?.sha256 !== undefined) {
    if (!shaPattern.test(value.bundle.sha256))
      throw new Error("deployment_bundle_evidence_sha_invalid");
    if (value.bundle.sha256 !== bundleSha256)
      throw new Error("deployment_bundle_evidence_sha_mismatch");
  }
  if (value.bundleSha256 !== undefined && value.bundleSha256 !== bundleSha256)
    throw new Error("deployment_bundle_contract_sha_mismatch");
  if (
    value.bundle?.sourceCommit !== undefined &&
    value.bundle.sourceCommit !== sourceCommit
  )
    throw new Error("deployment_bundle_nested_commit_mismatch");
};

export const generateDeploymentBundleMetadata = async ({
  bundleRoot,
  bundleArchive,
  output,
  sourceCommit,
  evidence,
  contract,
  digests,
  releaseVersion,
  nodeVersion = "24.18.0",
  npmVersion = "11.16.0",
  goVersion = "1.23.0",
  metadataPath,
}) => {
  if (!commitPattern.test(sourceCommit ?? ""))
    throw new Error("deployment_bundle_source_commit_invalid");
  if (!releaseVersion || !/^\d+\.\d+\.\d+[-a-z0-9.]+$/u.test(releaseVersion))
    throw new Error("deployment_bundle_release_version_invalid");
  await requireFile(bundleArchive, "deployment_bundle_archive_missing");
  await requireFile(
    join(bundleRoot, "MANIFEST.json"),
    "deployment_bundle_manifest_missing",
  );
  const manifest = JSON.parse(
    await readFile(join(bundleRoot, "MANIFEST.json"), "utf8"),
  );
  if (
    manifest.schemaVersion !== 1 ||
    manifest.name !== "atlas-manager" ||
    manifest.version !== releaseVersion ||
    manifest.sourceCommit !== sourceCommit ||
    manifest.sourceDateEpoch !== 0 ||
    manifest.target?.os !== "linux" ||
    manifest.target?.arch !== "amd64" ||
    manifest.nodeVersion !== nodeVersion ||
    manifest.npmVersion !== npmVersion ||
    manifest.goVersion !== goVersion ||
    !Array.isArray(manifest.files)
  )
    throw new Error("deployment_bundle_manifest_invalid");
  const expectedArchiveName = `atlas-manager_${releaseVersion}_linux_amd64.tar.gz`;
  if (basename(bundleArchive) !== expectedArchiveName)
    throw new Error("deployment_bundle_filename_invalid");
  await validateChecksums(bundleRoot, manifest);
  const bundleSha256 = await sha256File(bundleArchive);
  if (!shaPattern.test(bundleSha256))
    throw new Error("deployment_bundle_sha_invalid");
  await validateCommitBoundJson(evidence, sourceCommit, bundleSha256);
  await validateCommitBoundJson(contract, sourceCommit, bundleSha256);
  await validateCommitBoundJson(digests, sourceCommit, bundleSha256);
  const metadata = {
    schemaVersion: 1,
    releaseVersion,
    sourceCommit,
    sourceDateEpoch: 0,
    bundleFilename: expectedArchiveName,
    bundleSha256,
    nodeVersion,
    npmVersion,
    goVersion,
    targetOs: "linux",
    targetArch: "amd64",
  };
  await writeFile(output, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  if (metadataPath)
    await validateDeploymentBundleMetadata(
      metadataPath,
      bundleArchive,
      sourceCommit,
      releaseVersion,
    );
  return metadata;
};

export const validateDeploymentBundleMetadata = async (
  metadataPath,
  bundleArchive,
  sourceCommit,
  releaseVersion,
) => {
  if (!commitPattern.test(sourceCommit ?? ""))
    throw new Error("deployment_bundle_source_commit_invalid");
  const value = JSON.parse(await readFile(metadataPath, "utf8"));
  const actualSha = await sha256File(bundleArchive);
  if (
    value.schemaVersion !== 1 ||
    value.releaseVersion !== releaseVersion ||
    value.sourceCommit !== sourceCommit ||
    value.sourceDateEpoch !== 0 ||
    value.bundleFilename !== basename(bundleArchive) ||
    value.bundleSha256 !== actualSha ||
    !shaPattern.test(value.bundleSha256) ||
    value.nodeVersion !== "24.18.0" ||
    value.npmVersion !== "11.16.0" ||
    value.goVersion !== "1.23.0" ||
    value.targetOs !== "linux" ||
    value.targetArch !== "amd64"
  )
    throw new Error("deployment_bundle_metadata_mismatch");
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArguments();
  const metadata = await generateDeploymentBundleMetadata({
    bundleRoot: args.get("--bundle-root"),
    bundleArchive: args.get("--bundle-archive"),
    output: args.get("--output"),
    sourceCommit: process.env.SOURCE_COMMIT,
    evidence: args.get("--evidence"),
    contract: args.get("--contract"),
    digests: args.get("--digests"),
    releaseVersion: process.env.RELEASE_VERSION,
    metadataPath: args.get("--metadata"),
  });
  process.stdout.write(`${JSON.stringify(metadata)}\n`);
}
