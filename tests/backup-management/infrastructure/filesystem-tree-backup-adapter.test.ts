import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FilesystemTreeBackupAdapter } from "../../../src/backup-management/infrastructure/filesystem-tree-backup-adapter.js";
import { createBackupTarget } from "../../../src/backup-management/domain/backup-target.js";

const sandboxes: string[] = [];
afterEach(async () => {
  await Promise.all(
    sandboxes
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

function makeTarget(sourcePath: string) {
  return createBackupTarget({
    id: "filesystem-backup",
    displayName: "Filesystem backup",
    kind: "filesystem_tree",
    sourcePath,
    schedule: { mode: "manual" },
    retention: { keepLastSuccessful: 1 },
    limits: {
      maxFiles: 20,
      maxTotalBytes: 4096,
      maxFileBytes: 2048,
      maxDepth: 8,
      maxRelativePathBytes: 256,
    },
  });
}

describe("FilesystemTreeBackupAdapter", () => {
  it("publishes a private deterministic artifact without child processes", async () => {
    const root = await mkdtemp(join(tmpdir(), "atlas-backup-test-"));
    sandboxes.push(root);
    const source = join(root, "source");
    const destination = join(root, "destination");
    await (
      await import("node:fs/promises")
    ).mkdir(join(source, "nested"), { recursive: true });
    await writeFile(join(source, "b.txt"), "bravo");
    await writeFile(join(source, "nested", "a.txt"), "alpha");
    const result = await new FilesystemTreeBackupAdapter(destination).run({
      target: makeTarget(source),
      runId: "6f5d6f49-6d3b-4f73-8f07-0f1b5ec9d1b2",
      startedAt: "2026-08-02T12:00:00.000Z",
    });
    const manifest = JSON.parse(
      await readFile(join(result.artifactDirectory, "MANIFEST.json"), "utf8"),
    ) as { files: { path: string }[]; totalBytes: number };
    expect(manifest.files.map((file) => file.path)).toEqual([
      "b.txt",
      "nested/a.txt",
    ]);
    expect(manifest.totalBytes).toBe(10);
    expect(
      await readFile(
        join(result.artifactDirectory, "data", "nested", "a.txt"),
        "utf8",
      ),
    ).toBe("alpha");
    expect(
      (await stat(join(result.artifactDirectory, "MANIFEST.json"))).mode &
        0o077,
    ).toBe(0);
    expect(
      await readdir(join(destination, "artifacts", "filesystem-backup")),
    ).toEqual(["6f5d6f49-6d3b-4f73-8f07-0f1b5ec9d1b2"]);
  });

  it("records manifest digests that match an independent hash of every copied file", async () => {
    const root = await mkdtemp(join(tmpdir(), "atlas-backup-digest-test-"));
    sandboxes.push(root);
    const source = join(root, "source");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(source, "nested"), { recursive: true });
    // Larger than the 64 KiB streaming buffer, so the digest spans reads.
    const contents: Readonly<Record<string, string>> = {
      "empty.txt": "",
      "small.txt": "backup contents",
      "nested/large.txt": "x".repeat(200_000),
    };
    for (const [name, value] of Object.entries(contents))
      await writeFile(join(source, name), value);

    const destination = join(root, "destination");
    const result = await new FilesystemTreeBackupAdapter(destination).run({
      target: createBackupTarget({
        id: "filesystem-backup",
        displayName: "Filesystem backup",
        kind: "filesystem_tree",
        sourcePath: source,
        schedule: { mode: "manual" },
        retention: { keepLastSuccessful: 1 },
        limits: {
          maxFiles: 20,
          maxTotalBytes: 1_000_000,
          maxFileBytes: 500_000,
          maxDepth: 8,
          maxRelativePathBytes: 256,
        },
      }),
      runId: "0f2d1c3b-5a6e-4d7f-8b9c-0a1b2c3d4e5f",
      startedAt: "2026-08-02T12:00:00.000Z",
    });

    const manifest = JSON.parse(
      await readFile(join(result.artifactDirectory, "MANIFEST.json"), "utf8"),
    ) as Readonly<{
      files: readonly Readonly<{
        path: string;
        size: number;
        sha256: string;
      }>[];
    }>;
    const { createHash } = await import("node:crypto");
    expect(manifest.files.map((file) => file.path).sort()).toEqual(
      Object.keys(contents).sort(),
    );
    for (const file of manifest.files) {
      const published = await readFile(
        join(result.artifactDirectory, "data", file.path),
      );
      expect(published.byteLength, file.path).toBe(file.size);
      expect(
        createHash("sha256").update(published).digest("hex"),
        file.path,
      ).toBe(file.sha256);
      expect(
        createHash("sha256").update(contents[file.path]!).digest("hex"),
        file.path,
      ).toBe(file.sha256);
    }
  });

  it("rejects symbolic links instead of following them", async () => {
    const root = await mkdtemp(join(tmpdir(), "atlas-backup-link-test-"));
    sandboxes.push(root);
    const source = join(root, "source");
    await (await import("node:fs/promises")).mkdir(source);
    await writeFile(join(root, "outside.txt"), "outside");
    await (
      await import("node:fs/promises")
    ).symlink(join(root, "outside.txt"), join(source, "link"));
    await expect(
      new FilesystemTreeBackupAdapter(join(root, "destination")).run({
        target: makeTarget(source),
        runId: "6f5d6f49-6d3b-4f73-8f07-0f1b5ec9d1b2",
        startedAt: "2026-08-02T12:00:00.000Z",
      }),
    ).rejects.toThrow();
  });
});
