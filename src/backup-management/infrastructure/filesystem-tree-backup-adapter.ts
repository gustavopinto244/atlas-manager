import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { chmod, mkdir, open, readdir, rename, rm } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import type {
  BackupAdapter,
  BackupArtifactResult,
} from "../application/ports/backup-ports.js";
import {
  createBackupManifest,
  serializeBackupManifest,
  type BackupManifestFile,
} from "../domain/backup-manifest.js";
import {
  BACKUP_DESTINATION_ROOT,
  type BackupTarget,
} from "../domain/backup-target.js";

const COPY_BUFFER_BYTES = 64 * 1024;

interface CopyState {
  files: number;
  totalBytes: number;
  /** Relative path to the SHA-256 computed while streaming the copy. */
  readonly digests: Map<string, string>;
}

export class FilesystemTreeBackupAdapter implements BackupAdapter {
  readonly #destinationRoot: string;

  public constructor(destinationRoot = BACKUP_DESTINATION_ROOT) {
    this.#destinationRoot = resolve(destinationRoot);
  }

  public async run(input: {
    readonly target: BackupTarget;
    readonly runId: string;
    readonly startedAt: string;
  }): Promise<BackupArtifactResult> {
    if (
      input.target.kind !== "filesystem_tree" ||
      input.target.sourcePath === null
    )
      throw new Error("backup_target_kind_invalid");
    const source = resolve(input.target.sourcePath);
    const targetRoot = join(
      this.#destinationRoot,
      "artifacts",
      input.target.id,
    );
    const candidate = join(targetRoot, `${input.runId}.candidate`);
    const published = join(targetRoot, input.runId);
    assertContained(this.#destinationRoot, candidate);
    const sourceInfo = await openNoFollow(source);
    if (sourceInfo.kind !== "directory") {
      await sourceInfo.close();
      throw new Error("backup_source_invalid");
    }
    await sourceInfo.close();
    let candidateCreated = false;
    try {
      await mkdir(this.#destinationRoot, { recursive: true, mode: 0o700 });
      await chmod(this.#destinationRoot, 0o700);
      await mkdir(join(this.#destinationRoot, "artifacts"), {
        recursive: true,
        mode: 0o700,
      });
      await mkdir(targetRoot, { recursive: true, mode: 0o700 });
      await mkdir(candidate, { recursive: false, mode: 0o700 });
      candidateCreated = true;
      await mkdir(join(candidate, "data"), { recursive: false, mode: 0o700 });
      await chmod(candidate, 0o700);
      const copyState: CopyState = {
        files: 0,
        totalBytes: 0,
        digests: new Map<string, string>(),
      };
      await this.#copyTree(
        source,
        join(candidate, "data"),
        input.target,
        [],
        copyState,
      );
      const completedAt = new Date().toISOString();
      const files = await this.#readCopiedFiles(
        join(candidate, "data"),
        copyState.digests,
      );
      const manifest = createBackupManifest({
        schemaVersion: 1,
        targetId: input.target.id,
        runId: input.runId,
        startedAt: input.startedAt,
        completedAt,
        fileCount: files.length,
        totalBytes: files.reduce((sum, file) => sum + file.size, 0),
        files,
      });
      const manifestFile = await open(
        join(candidate, "MANIFEST.json"),
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600,
      );
      await manifestFile.writeFile(serializeBackupManifest(manifest));
      await manifestFile.sync();
      await manifestFile.close();
      await syncDirectory(join(candidate, "data"));
      await syncDirectory(candidate);
      await rename(candidate, published);
      const manifestHash = createHash("sha256")
        .update(serializeBackupManifest(manifest))
        .digest("hex");
      return Object.freeze({
        fileCount: manifest.fileCount,
        totalBytes: manifest.totalBytes,
        manifestSha256: manifestHash,
        artifactDirectory: published,
      });
    } catch (error) {
      if (candidateCreated) await this.#removeOwnCandidate(candidate);
      if (error instanceof Error && error.message.startsWith("backup_"))
        throw error;
      throw new Error("backup_filesystem_copy_failed", { cause: error });
    }
  }

  async #copyTree(
    source: string,
    destination: string,
    target: BackupTarget,
    parts: string[],
    state: CopyState,
  ): Promise<void> {
    const entries = (await readdir(source, { withFileTypes: true })).sort(
      (left, right) => Buffer.from(left.name).compare(Buffer.from(right.name)),
    );
    for (const entry of entries) {
      const nextParts = [...parts, entry.name];
      const path = join(source, entry.name);
      const relativePath = nextParts.join("/");
      if (
        nextParts.length > target.limits.maxDepth ||
        Buffer.byteLength(relativePath, "utf8") >
          target.limits.maxRelativePathBytes
      )
        throw new Error("backup_limit_exceeded");
      const info = await openNoFollow(path);
      try {
        if (info.kind === "directory") {
          await mkdir(join(destination, entry.name), {
            recursive: false,
            mode: 0o700,
          });
          await this.#copyTree(
            path,
            join(destination, entry.name),
            target,
            nextParts,
            state,
          );
        } else if (info.kind === "file") {
          if (info.nlink !== 1 || info.size > target.limits.maxFileBytes)
            throw new Error("backup_file_unsafe");
          state.files += 1;
          state.totalBytes += info.size;
          if (
            state.files > target.limits.maxFiles ||
            state.totalBytes > target.limits.maxTotalBytes
          )
            throw new Error("backup_limit_exceeded");
          const output = join(destination, entry.name);
          const inputHandle = await open(
            path,
            constants.O_RDONLY | constants.O_NOFOLLOW,
          );
          const outputHandle = await open(
            output,
            constants.O_WRONLY |
              constants.O_CREAT |
              constants.O_EXCL |
              constants.O_NOFOLLOW,
            0o600,
          );
          const hash = createHash("sha256");
          let copied = 0;
          const buffer = Buffer.allocUnsafe(COPY_BUFFER_BYTES);
          try {
            while (copied < info.size) {
              const result = await inputHandle.read(
                buffer,
                0,
                Math.min(buffer.length, info.size - copied),
                copied,
              );
              if (result.bytesRead === 0)
                throw new Error("backup_source_changed");
              await outputHandle.write(buffer.subarray(0, result.bytesRead));
              hash.update(buffer.subarray(0, result.bytesRead));
              copied += result.bytesRead;
            }
            const finalInfo = await inputHandle.stat();
            if (
              finalInfo.size !== info.size ||
              finalInfo.nlink !== 1 ||
              finalInfo.mtimeMs !== info.mtimeMs ||
              finalInfo.ctimeMs !== info.ctimeMs
            )
              throw new Error("backup_source_changed");
            await outputHandle.chmod(0o600);
            await outputHandle.sync();
            if (copied !== info.size) throw new Error("backup_source_changed");
          } finally {
            await inputHandle.close();
            await outputHandle.close();
          }
          const digest = hash.digest("hex");
          if (copied !== info.size || digest.length !== 64)
            throw new Error("backup_source_changed");
          // Recorded for the manifest. Re-reading the copy to recompute this
          // would double the I/O and hold whole files in memory.
          state.digests.set(relativePath, digest);
        } else {
          throw new Error("backup_file_unsafe");
        }
      } finally {
        await info.close();
      }
    }
  }

  // Walks the published tree to revalidate what was actually written, and pairs
  // each entry with the digest computed during the streaming copy. The tree walk
  // stays: it is what proves the copy produced only regular files and
  // directories. Only the redundant whole-file re-read is gone.
  async #readCopiedFiles(
    dataRoot: string,
    digests: ReadonlyMap<string, string>,
  ): Promise<BackupManifestFile[]> {
    const files: BackupManifestFile[] = [];
    const walk = async (directory: string, parts: string[]): Promise<void> => {
      const entries = (await readdir(directory, { withFileTypes: true })).sort(
        (left, right) =>
          Buffer.from(left.name).compare(Buffer.from(right.name)),
      );
      for (const entry of entries) {
        const next = [...parts, entry.name];
        const path = join(directory, entry.name);
        const info = await openNoFollow(path);
        try {
          if (info.kind === "directory") await walk(path, next);
          else if (info.kind === "file") {
            const relativePath = next.join("/");
            const sha256 = digests.get(relativePath);
            if (sha256 === undefined)
              throw new Error("backup_published_artifact_unsafe");
            files.push({
              path: relativePath,
              size: info.size,
              mode: info.mode & 0o777,
              sha256,
            });
          } else throw new Error("backup_published_artifact_unsafe");
        } finally {
          await info.close();
        }
      }
    };
    await walk(dataRoot, []);
    return files.sort((left, right) =>
      Buffer.from(left.path).compare(Buffer.from(right.path)),
    );
  }

  async #removeOwnCandidate(candidate: string): Promise<void> {
    try {
      const expected = `${sep}candidate`;
      if (!candidate.endsWith(expected)) return;
      await rm(candidate, { recursive: true, force: false });
    } catch {
      /* current-attempt cleanup is deliberately best effort */
    }
  }
}

async function openNoFollow(path: string): Promise<{
  readonly kind: "file" | "directory" | "other";
  readonly size: number;
  readonly mode: number;
  readonly nlink: number;
  readonly mtimeMs: number;
  readonly ctimeMs: number;
  readonly close: () => Promise<void>;
}> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  const info = await handle.stat();
  return {
    kind: info.isDirectory() ? "directory" : info.isFile() ? "file" : "other",
    size: info.size,
    mode: info.mode,
    nlink: info.nlink,
    mtimeMs: info.mtimeMs,
    ctimeMs: info.ctimeMs,
    close: () => handle.close(),
  };
}

function assertContained(root: string, candidate: string): void {
  const relation = relative(root, candidate);
  if (
    relation === "" ||
    relation.startsWith("..") ||
    resolve(root, relation) !== candidate
  )
    throw new Error("backup_destination_escape");
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
