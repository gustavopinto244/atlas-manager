import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, readFile, rm } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import type {
  BackupArtifactStore,
  ManagedBackupArtifact,
} from "../application/apply-registered-backup-retention.js";
import { createBackupManifest } from "../domain/backup-manifest.js";
import { BACKUP_DESTINATION_ROOT } from "../domain/backup-target.js";
import { parseStrictJson } from "../../config/strict-json.js";

const MAX_ARTIFACT_ENTRIES = 100_000;

export class FilesystemBackupArtifactStore implements BackupArtifactStore {
  readonly #root: string;

  public constructor(root = BACKUP_DESTINATION_ROOT) {
    this.#root = resolve(root);
  }

  public async listManaged(
    targetId: string,
  ): Promise<readonly ManagedBackupArtifact[]> {
    const targetRoot = join(this.#root, "artifacts", targetId);
    assertContained(this.#root, targetRoot);
    const entries = await readDirectoryOrEmpty(targetRoot);
    if (entries.length > MAX_ARTIFACT_ENTRIES)
      throw new Error("backup_artifacts_too_many");
    const artifacts: ManagedBackupArtifact[] = [];
    for (const entry of entries.sort(bytewise)) {
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
          entry,
        )
      ) {
        if (entry.endsWith(".candidate"))
          throw new Error("backup_candidate_present");
        throw new Error("backup_unknown_artifact");
      }
      const artifactRoot = join(targetRoot, entry);
      const info = await lstat(artifactRoot);
      if (!info.isDirectory() || info.nlink < 2 || (info.mode & 0o077) !== 0)
        throw new Error("backup_artifact_unsafe");
      const manifestPath = join(artifactRoot, "MANIFEST.json");
      const manifestInfo = await lstat(manifestPath);
      if (
        !manifestInfo.isFile() ||
        manifestInfo.nlink !== 1 ||
        (manifestInfo.mode & 0o077) !== 0
      )
        throw new Error("backup_artifact_unsafe");
      const manifestHandle = await open(
        manifestPath,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      let manifestBytes: Buffer;
      try {
        manifestBytes = await manifestHandle.readFile();
      } finally {
        await manifestHandle.close();
      }
      const manifest = createBackupManifest(
        parseStrictJson(manifestBytes.toString("utf8")),
      );
      if (manifest.targetId !== targetId || manifest.runId !== entry)
        throw new Error("backup_artifact_identity_mismatch");
      await verifyPublishedTree(artifactRoot, manifest);
      artifacts.push(
        Object.freeze({
          targetId,
          runId: entry,
          completedAt: manifest.completedAt,
          manifestSha256: createHash("sha256")
            .update(manifestBytes)
            .digest("hex"),
        }),
      );
    }
    return Object.freeze(artifacts);
  }

  public async removeManaged(targetId: string, runId: string): Promise<void> {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
        runId,
      )
    )
      throw new Error("backup_artifact_identity_invalid");
    const targetRoot = join(this.#root, "artifacts", targetId);
    const artifactRoot = join(targetRoot, runId);
    assertContained(this.#root, artifactRoot);
    const info = await lstat(artifactRoot);
    if (!info.isDirectory() || info.nlink < 2 || (info.mode & 0o077) !== 0)
      throw new Error("backup_artifact_unsafe");
    await rm(artifactRoot, { recursive: true, force: false });
  }
}

async function readDirectoryOrEmpty(path: string): Promise<string[]> {
  try {
    const info = await lstat(path);
    if (!info.isDirectory() || info.nlink < 2 || (info.mode & 0o077) !== 0)
      throw new Error("backup_artifact_root_unsafe");
    return await readdir(path);
  } catch (error) {
    if (
      error instanceof Error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    )
      return [];
    throw error;
  }
}

function assertContained(root: string, target: string): void {
  const relation = relative(root, target);
  if (
    relation === "" ||
    relation.startsWith("..") ||
    resolve(root, relation) !== target
  )
    throw new Error("backup_destination_escape");
}

function bytewise(left: string, right: string): number {
  return Buffer.from(left).compare(Buffer.from(right));
}

async function verifyPublishedTree(
  artifactRoot: string,
  manifest: ReturnType<typeof createBackupManifest>,
): Promise<void> {
  const rootEntries = await readdir(artifactRoot);
  if (
    rootEntries.length !== 2 ||
    !rootEntries.includes("MANIFEST.json") ||
    !rootEntries.includes("data")
  )
    throw new Error("backup_artifact_unknown_file");
  const dataRoot = join(artifactRoot, "data");
  const dataInfo = await lstat(dataRoot);
  if (
    !dataInfo.isDirectory() ||
    dataInfo.nlink < 2 ||
    (dataInfo.mode & 0o077) !== 0
  )
    throw new Error("backup_artifact_unsafe");
  const expected = new Map(manifest.files.map((file) => [file.path, file]));
  const seen = new Set<string>();
  const walk = async (
    directory: string,
    parts: readonly string[],
  ): Promise<void> => {
    for (const entry of (await readdir(directory)).sort(bytewise)) {
      const next = [...parts, entry];
      const path = join(directory, entry);
      assertContained(artifactRoot, path);
      const info = await lstat(path);
      if (info.isDirectory()) {
        if (info.nlink < 2 || (info.mode & 0o077) !== 0)
          throw new Error("backup_artifact_unsafe");
        await walk(path, next);
        continue;
      }
      if (!info.isFile() || info.nlink !== 1 || (info.mode & 0o077) !== 0)
        throw new Error("backup_artifact_unsafe");
      const relativePath = next.join("/");
      const expectedFile = expected.get(relativePath);
      if (expectedFile === undefined || seen.has(relativePath))
        throw new Error("backup_artifact_unknown_file");
      const bytes = await readFile(path);
      if (
        bytes.byteLength !== expectedFile.size ||
        createHash("sha256").update(bytes).digest("hex") !== expectedFile.sha256
      )
        throw new Error("backup_artifact_modified");
      seen.add(relativePath);
    }
  };
  await walk(dataRoot, []);
  if (seen.size !== expected.size)
    throw new Error("backup_artifact_file_missing");
}
