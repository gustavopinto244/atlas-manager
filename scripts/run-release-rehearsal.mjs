import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import process from "node:process";

const parsed = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index];
  const value = process.argv[index + 1];
  if (!key?.startsWith("--") || !value || parsed.has(key))
    throw new Error("rehearsal_arguments_invalid");
  parsed.set(key, value);
}
const required = [
  "--sandbox-root",
  "--bundle-root",
  "--dashboard-manifest",
  "--bundle-sha256",
  "--output",
];
if (parsed.size !== required.length || required.some((key) => !parsed.has(key)))
  throw new Error("rehearsal_arguments_invalid");
const sandboxRoot = resolve(parsed.get("--sandbox-root"));
const bundleRoot = resolve(parsed.get("--bundle-root"));
const dashboardManifest = resolve(parsed.get("--dashboard-manifest"));
const output = resolve(parsed.get("--output"));
const sourceCommit = process.env.SOURCE_COMMIT;
const bundleSha256 = parsed.get("--bundle-sha256");
if (!sourceCommit || !/^[0-9a-f]{40}$/u.test(sourceCommit))
  throw new Error("source_commit_invalid");
if (!/^[0-9a-f]{64}$/u.test(bundleSha256))
  throw new Error("bundle_digest_invalid");
await mkdir(sandboxRoot, { recursive: true });

const run = (action, command, args) => {
  execFileSync(command, args, {
    cwd: command === "go" ? join(process.cwd(), "deployment") : process.cwd(),
    env: { ...process.env, ATLAS_RELEASE_REHEARSAL_ROOT: sandboxRoot },
    stdio: "ignore",
  });
  return {
    action,
    expectedResult: "passed",
    observedResult: "passed",
    mutationClassification: "sandbox_only",
  };
};

const steps = [
  run("configuration_install_disabled", "npm", [
    "test",
    "--",
    "--maxWorkers=1",
    "tests/config",
  ]),
  run("configuration_replacement_and_rollback", "go", [
    "test",
    "./internal/administrativeconfiguration",
    "./internal/installer",
    "./internal/servicelifecycle",
    "-count=1",
  ]),
  run("route_catalog_and_http_matrix", "npm", [
    "test",
    "--",
    "--maxWorkers=1",
    "tests/http",
  ]),
  run("identity_readiness_with_fake_jwks", "npm", [
    "test",
    "--",
    "--maxWorkers=1",
    "tests/access-control",
  ]),
  run("dashboard_asset_equivalence", "node", [
    "scripts/verify-dashboard-assets.mjs",
    "--source-root",
    "dist/dashboard-assets",
    "--bundle-root",
    bundleRoot,
    "--manifest",
    dashboardManifest,
  ]),
  run("backup_execution_reconstruction_retention", "npm", [
    "test",
    "--",
    "--maxWorkers=1",
    "tests/backup-management",
  ]),
  run("event_history_repeated_prune_and_export", "npm", [
    "test",
    "--",
    "--maxWorkers=1",
    "tests/event-history",
  ]),
  run("disabled_install_upgrade_rollback_deactivation", "go", [
    "test",
    "./internal/rehearsal",
    "-count=1",
  ]),
];

const digest = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const canonicalSteps = steps.map((step, index) => ({
  sequence: index + 1,
  ...step,
  reportSha256: digest(step),
}));
const evidence = {
  schemaVersion: 1,
  result: "passed",
  sourceCommit,
  bundleSha256,
  configurationMatrix: "passed",
  dashboardEquivalence: "passed",
  administrativeRehearsal: "passed",
  steps: canonicalSteps,
  finalState: "software_release_candidate_rehearsed",
};
await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
const bytes = await readFile(output);
process.stdout.write(
  JSON.stringify({
    result: "passed",
    evidenceSha256: createHash("sha256").update(bytes).digest("hex"),
  }) + "\n",
);
