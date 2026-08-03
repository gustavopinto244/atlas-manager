import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const sourceCommit = "0123456789abcdef0123456789abcdef01234567";
const roots: string[] = [];
const execute = promisify(execFile);
type Metadata = { bundleSha256: string };
const parseMetadata = (value: string): Metadata => {
  const parsed: unknown = JSON.parse(value);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("bundleSha256" in parsed) ||
    typeof parsed.bundleSha256 !== "string"
  )
    throw new Error("metadata_fixture_invalid");
  return { bundleSha256: parsed.bundleSha256 };
};
const hash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "atlas-bundle-metadata-"));
  roots.push(root);
  const bundleRoot = join(root, "atlas-manager_1.0.0-rc.2_linux_amd64");
  const archive = join(root, "atlas-manager_1.0.0-rc.2_linux_amd64.tar.gz");
  const output = join(root, "deployment-bundle-metadata.json");
  const application = join(bundleRoot, "application.txt");
  await mkdir(bundleRoot, { recursive: true });
  await writeFile(application, "fixture\n");
  const manifest = {
    schemaVersion: 1,
    name: "atlas-manager",
    version: "1.0.0-rc.2",
    sourceCommit,
    sourceDateEpoch: 0,
    target: { os: "linux", arch: "amd64" },
    nodeVersion: "24.18.0",
    npmVersion: "11.16.0",
    goVersion: "1.23.0",
    runtimeNodePath: "/usr/bin/node",
    systemdUnitPath: "/etc/systemd/system/atlas-manager.service",
    files: [
      {
        path: "application.txt",
        size: 8,
        mode: 420,
        sha256: hash("fixture\n"),
      },
    ],
  };
  const manifestBytes = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeFile(join(bundleRoot, "MANIFEST.json"), manifestBytes);
  await writeFile(
    join(bundleRoot, "SHA256SUMS"),
    `${hash("fixture\n")}  application.txt\n${hash(manifestBytes)}  MANIFEST.json\n`,
  );
  await writeFile(archive, "deterministic archive bytes\n");
  return {
    root,
    bundleRoot,
    archive,
    output,
    bundleSha: hash("deterministic archive bytes\n"),
  };
};

const generate = async (
  value: Awaited<ReturnType<typeof fixture>>,
  options: {
    sourceCommit?: string;
    evidence?: string;
    metadataPath?: string;
    output?: string;
  } = {},
) =>
  execute(
    process.execPath,
    [
      "scripts/generate-deployment-bundle-metadata.mjs",
      "--bundle-root",
      value.bundleRoot,
      "--bundle-archive",
      value.archive,
      "--output",
      options.output ?? value.output,
      ...(options.metadataPath ? ["--metadata", options.metadataPath] : []),
      ...(options.evidence ? ["--evidence", options.evidence] : []),
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        SOURCE_COMMIT: options.sourceCommit ?? sourceCommit,
        RELEASE_VERSION: "1.0.0-rc.2",
      },
    },
  );

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("deployment bundle metadata", () => {
  it("generates deterministic metadata bound to the validated archive", async () => {
    const first = await fixture();
    await generate(first);
    const firstBytes = await readFile(first.output, "utf8");
    const second = await fixture();
    await generate(second);
    const firstMetadata = parseMetadata(firstBytes);
    const secondMetadata = parseMetadata(await readFile(second.output, "utf8"));

    expect(firstMetadata).toEqual(secondMetadata);
    expect(firstMetadata.bundleSha256).toBe(first.bundleSha);
    expect(firstBytes).toBe(await readFile(second.output, "utf8"));
  });

  it("rejects invalid source commits", async () => {
    const value = await fixture();
    await expect(
      generate(value, { sourceCommit: "not-a-commit" }),
    ).rejects.toThrow("deployment_bundle_source_commit_invalid");
  });

  it("rejects invalid or mismatched evidence bundle hashes", async () => {
    const value = await fixture();
    const evidence = join(value.root, "evidence.json");
    await writeFile(
      evidence,
      JSON.stringify({ sourceCommit, bundle: { sha256: "invalid" } }),
    );
    await expect(generate(value, { evidence })).rejects.toThrow(
      "deployment_bundle_evidence_sha_invalid",
    );

    await writeFile(
      evidence,
      JSON.stringify({ sourceCommit, bundle: { sha256: "0".repeat(64) } }),
    );
    await expect(generate(value, { evidence })).rejects.toThrow(
      "deployment_bundle_evidence_sha_mismatch",
    );
  });

  it("rejects metadata that does not match the archive", async () => {
    const value = await fixture();
    await generate(value);
    const metadata = parseMetadata(await readFile(value.output, "utf8"));
    metadata.bundleSha256 = "0".repeat(64);
    const metadataPath = join(value.root, "tampered-metadata.json");
    const output = join(value.root, "regenerated-metadata.json");
    await writeFile(metadataPath, JSON.stringify(metadata));
    await expect(generate(value, { metadataPath, output })).rejects.toThrow(
      "deployment_bundle_metadata_mismatch",
    );
  });

  it.each([
    ["archive", (value: Awaited<ReturnType<typeof fixture>>) => value.archive],
    [
      "manifest",
      (value: Awaited<ReturnType<typeof fixture>>) =>
        join(value.bundleRoot, "MANIFEST.json"),
    ],
    [
      "checksums",
      (value: Awaited<ReturnType<typeof fixture>>) =>
        join(value.bundleRoot, "SHA256SUMS"),
    ],
  ])("rejects a missing %s", async (_name, pathForCase) => {
    const value = await fixture();
    await rm(pathForCase(value));
    await expect(generate(value)).rejects.toThrow();
  });
});
