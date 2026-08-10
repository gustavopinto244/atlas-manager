import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const CLI_ROOT = fileURLToPath(new URL("../../src/cli", import.meta.url));

/**
 * ADR-028 and ADR-031 forbid the CLI from reaching a host runtime directly.
 * The most dangerous version of that mistake is a *fallback*: running PM2 or
 * systemd because the authenticated administrative request was refused, which
 * would bypass authentication, RBAC, mutation admission and audit at exactly
 * the moment those controls said no.
 *
 * This guard makes that impossible to add by accident.
 */
const FORBIDDEN_PATTERNS: readonly Readonly<{
  label: string;
  pattern: RegExp;
}>[] = Object.freeze([
  { label: "node:child_process", pattern: /child_process/u },
  { label: "execFile", pattern: /\bexecFile\b/u },
  { label: "execSync", pattern: /\bexecSync\b/u },
  { label: "spawn", pattern: /\bspawn(?:Sync)?\b/u },
  { label: "pm2 invocation", pattern: /["'`]pm2\b/u },
  { label: "docker invocation", pattern: /["'`]docker\b/u },
  { label: "systemctl invocation", pattern: /["'`]systemctl\b/u },
  { label: "sudo invocation", pattern: /\bsudo\b/u },
  { label: "power helper invocation", pattern: /power-helper/u },
]);

/** Credential intake that would expose a secret to `ps` or shell history. */
const FORBIDDEN_CREDENTIAL_OPTIONS: readonly RegExp[] = Object.freeze([
  /--jwt\b/u,
  /--token\b/u,
  /--password\b/u,
  /--secret\b/u,
]);

/** Target selectors that would address a runtime object outside the catalog. */
const FORBIDDEN_TARGET_OPTIONS: readonly RegExp[] = Object.freeze([
  /"--pm2"/u,
  /"--container"/u,
  /"--unit"/u,
]);

async function cliSources(): Promise<readonly Readonly<[string, string]>[]> {
  const names = await readdir(CLI_ROOT);
  const sources: Array<Readonly<[string, string]>> = [];
  for (const name of names.filter((entry) => entry.endsWith(".ts")))
    sources.push([name, await readFile(join(CLI_ROOT, name), "utf8")]);
  return sources;
}

describe("CLI host-mutation guard", () => {
  it("finds CLI sources to scan", async () => {
    const sources = await cliSources();
    expect(sources.length).toBeGreaterThanOrEqual(7);
  });

  it("never executes a host process from any CLI module", async () => {
    for (const [name, source] of await cliSources())
      for (const forbidden of FORBIDDEN_PATTERNS)
        expect(
          forbidden.pattern.test(stripComments(source)),
          `${name} references ${forbidden.label}`,
        ).toBe(false);
  });

  it("never accepts a credential as a command-line option", async () => {
    for (const [name, source] of await cliSources())
      for (const pattern of FORBIDDEN_CREDENTIAL_OPTIONS)
        expect(pattern.test(stripComments(source)), name).toBe(false);
  });

  it("never accepts a runtime target that bypasses registered-service identity", async () => {
    for (const [name, source] of await cliSources())
      for (const pattern of FORBIDDEN_TARGET_OPTIONS)
        expect(pattern.test(stripComments(source)), name).toBe(false);
  });

  it("imports nothing outside the CLI directory and the Node standard library", async () => {
    for (const [name, source] of await cliSources()) {
      const imports = [...source.matchAll(/from\s+"([^"]+)"/gu)].map(
        (match) => match[1] as string,
      );
      for (const specifier of imports)
        expect(
          specifier.startsWith("node:") || specifier.startsWith("./"),
          `${name} imports ${specifier}`,
        ).toBe(true);
    }
  });
});

/**
 * The prohibitions above are also *described* in CLI comments and help text,
 * so the scan must ignore comments and only judge executable source.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^\s*\/\/.*$/gmu, "");
}
