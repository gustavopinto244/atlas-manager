import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import process from "node:process";
import { getAdministrativeDashboardAssetSnapshot } from "../src/http/administrative-dashboard-route.ts";

const root = process.cwd();
const output = join(root, "dist/dashboard-assets");
const manifestPath = join(root, "dist/dashboard-assets.manifest.json");
const snapshot = { ...getAdministrativeDashboardAssetSnapshot() };
let compiledApp;
try {
  compiledApp = await readFile(join(root, "dist/dashboard/main.js"), "utf8");
} catch {
  execFileSync(
    process.execPath,
    ["node_modules/typescript/bin/tsc", "-p", "tsconfig.build.json"],
    {
      cwd: root,
      stdio: "inherit",
    },
  );
  compiledApp = await readFile(join(root, "dist/dashboard/main.js"), "utf8");
}
const sourceStyles = await readFile(
  join(root, "src/dashboard/styles.css"),
  "utf8",
);
await mkdir(join(root, "dist/dashboard"), { recursive: true });
await writeFile(join(root, "dist/dashboard/styles.css"), sourceStyles, "utf8");
snapshot["app.js"] = { ...snapshot["app.js"], body: compiledApp };
snapshot["styles.css"] = { ...snapshot["styles.css"], body: sourceStyles };
const names = Object.keys(snapshot).sort();
if (
  names.join("\n") !==
  "app.js\nevent-history.js\nindex.html\nstyles.css\nbackup.js"
    .split("\n")
    .sort()
    .join("\n")
)
  throw new Error("dashboard_asset_inventory_invalid");

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const files = [];
for (const name of names) {
  const body = snapshot[name]?.body;
  if (typeof body !== "string" || body.length === 0)
    throw new Error("dashboard_asset_empty");
  const bytes = Buffer.from(body, "utf8");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  await writeFile(join(output, name), bytes, { mode: 0o644 });
  files.push({ path: name, bytes: bytes.length, sha256 });
}
await writeFile(
  manifestPath,
  `${JSON.stringify({ schemaVersion: 1, files }, null, 2)}\n`,
  "utf8",
);
