import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import process from "node:process";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index];
  const value = process.argv[index + 1];
  if (!key?.startsWith("--") || !value || args.has(key))
    throw new Error("dashboard_arguments_invalid");
  args.set(key, resolve(value));
}
const sourceRoot = args.get("--source-root");
const bundleRoot = args.get("--bundle-root");
const manifestPath = args.get("--manifest");
if (!sourceRoot || !bundleRoot || !manifestPath || args.size !== 3)
  throw new Error("dashboard_arguments_invalid");

const expected = JSON.parse(await readFile(manifestPath, "utf8"));
if (expected.schemaVersion !== 1 || !Array.isArray(expected.files))
  throw new Error("dashboard_manifest_invalid");
const names = expected.files.map((file) => file.path);
if (
  names.length !== 5 ||
  new Set(names).size !== names.length ||
  names.some(
    (name) =>
      !/^(?:app|backup|event-history)\.js$|^(?:index\.html|styles\.css)$/u.test(
        name,
      ),
  )
)
  throw new Error("dashboard_manifest_inventory_invalid");

const sourceEntries = (await readdir(sourceRoot)).sort();
if (sourceEntries.join("\n") !== [...names].sort().join("\n"))
  throw new Error("dashboard_source_inventory_invalid");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
for (const file of expected.files) {
  const sourcePath = join(sourceRoot, file.path);
  const bundlePath = join(bundleRoot, "dashboard", file.path);
  const [sourceInfo, bundleInfo, sourceBytes, bundleBytes] = await Promise.all([
    stat(sourcePath),
    stat(bundlePath),
    readFile(sourcePath),
    readFile(bundlePath),
  ]);
  if (!sourceInfo.isFile() || !bundleInfo.isFile())
    throw new Error("dashboard_asset_type_invalid");
  if (sourceBytes.length !== file.bytes || sha256(sourceBytes) !== file.sha256)
    throw new Error(`dashboard_source_digest_invalid:${file.path}`);
  if (!sourceBytes.equals(bundleBytes))
    throw new Error(`dashboard_bundle_bytes_invalid:${file.path}`);
}
const bundleManifest = await readFile(
  join(bundleRoot, "MANIFEST.json"),
  "utf8",
);
const checksums = await readFile(join(bundleRoot, "SHA256SUMS"), "utf8");
for (const file of names) {
  if (
    !bundleManifest.includes(`dashboard/${file}`) ||
    !checksums.includes(`dashboard/${file}`)
  )
    throw new Error(`dashboard_bundle_inventory_invalid:${file}`);
}
process.stdout.write(JSON.stringify({ result: "passed", fileCount: 5 }) + "\n");
