import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const execFileAsync = promisify(execFile);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const packageJson = JSON.parse(
  await readFile(join(root, "package.json"), "utf8"),
);
const version = packageJson.version;
if (
  typeof version !== "string" ||
  !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version)
)
  throw new Error("operator_package_version_invalid");

const cliEntry = join(root, "dist", "cli", "main.js");
const outputRoot = join(root, "dist", "operator-package");
const stagingRoot = join(outputRoot, "package");
const packageName = "@atlas-manager/operator-cli";
const packageFile = join(
  outputRoot,
  `atlas-manager-operator-cli-${version}.tgz`,
);
const MIT_LICENSE = `MIT License

Copyright (c) Gustavo Pinto

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

await readFile(cliEntry);
await rm(outputRoot, { recursive: true, force: true });
await mkdir(join(stagingRoot, "dist", "cli"), { recursive: true });
await cp(join(root, "dist", "cli"), join(stagingRoot, "dist", "cli"), {
  recursive: true,
});
await writeFile(join(stagingRoot, "LICENSE"), MIT_LICENSE, "utf8");
await writeFile(
  join(stagingRoot, "package.json"),
  `${JSON.stringify(
    {
      name: packageName,
      version,
      description: "Atlas Manager operator CLI",
      private: true,
      type: "module",
      bin: { atlas: "dist/cli/main.js" },
      files: ["dist/cli", "README.md", "LICENSE"],
      engines: { node: ">=24 <25" },
    },
    null,
    2,
  )}\n`,
  "utf8",
);
await writeFile(
  join(stagingRoot, "README.md"),
  `# Atlas operator CLI\n\nInstall locally or globally from the generated archive:\n\n    npm install --global ./atlas-manager-operator-cli-${version}.tgz\n\nThe command is named "atlas". It uses the authenticated administrative HTTP boundary and does not fabricate Cloudflare Access headers.\n\nRead-only commands in this release include "status", "health", "doctor", service listing/status/logs, schedule inspection/preview, backup inspection, event history, and machine-plan inspection. Use "atlas --help" for the exact command tree.\n\nTo reinstall, install the new archive over the previous version. To remove it, run "npm uninstall --global ${packageName}".\n`,
  "utf8",
);
await execFileAsync(
  "npm",
  ["pack", "--ignore-scripts", "--pack-destination", outputRoot],
  {
    cwd: stagingRoot,
    env: { ...process.env, npm_config_update_notifier: "false" },
  },
);
try {
  await readFile(packageFile);
} catch {
  throw new Error("operator_package_output_invalid");
}
await rm(stagingRoot, { recursive: true, force: true });
const digest = createHash("sha256")
  .update(await readFile(packageFile))
  .digest("hex");
await writeFile(
  join(outputRoot, "SHA256SUMS"),
  `${digest}  ${packageFile.split("/").pop()}\n`,
  "utf8",
);
process.stdout.write(
  `${JSON.stringify({ result: "passed", package: packageFile, sha256: digest })}\n`,
);
