import { readFile, writeFile } from "node:fs/promises";
import { URL } from "node:url";

const lock = JSON.parse(
  await readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
);
const root = lock.packages?.[""];
if (!root || typeof root !== "object") throw new Error("lockfile_root_missing");
const direct = new Set([...Object.keys(root.dependencies ?? {})]);
const production = [];
for (const [location, value] of Object.entries(lock.packages ?? {})) {
  if (location === "" || !value || typeof value !== "object" || value.dev)
    continue;
  const packageName =
    typeof value.name === "string"
      ? value.name
      : location.split("node_modules/").at(-1);
  if (typeof packageName !== "string" || typeof value.version !== "string")
    throw new Error("production_package_metadata_missing");
  if (typeof value.license !== "string" || value.license.length === 0)
    throw new Error(`production_license_missing:${location}`);
  if (typeof value.integrity !== "string" || value.integrity.length === 0)
    throw new Error(`production_integrity_missing:${location}`);
  production.push({
    name: packageName,
    version: value.version,
    license: value.license,
    integrity: value.integrity,
    direct: direct.has(packageName),
  });
}
production.sort(
  (left, right) =>
    left.name.localeCompare(right.name) ||
    left.version.localeCompare(right.version),
);
const output = {
  schemaVersion: 1,
  source: "package-lock.json",
  production,
  licensePolicy: "unknown metadata fails qualification",
};
await writeFile(
  new URL(
    "../docs/release/atlas-manager-production-dependencies.json",
    import.meta.url,
  ),
  `${JSON.stringify(output, null, 2)}\n`,
  "utf8",
);
