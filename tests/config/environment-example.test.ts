import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { ENVIRONMENT_VARIABLE_NAMES } from "../../src/config/environment.js";
import { REGISTERED_SERVICES_VARIABLE } from "../../src/service-management/infrastructure/environment-registered-service-catalog.js";

// The service catalog reads its own variable outside the central schema, so the
// inventory is the union of both.
const RUNTIME_VARIABLE_NAMES: readonly string[] = [
  ...ENVIRONMENT_VARIABLE_NAMES,
  REGISTERED_SERVICES_VARIABLE,
].sort();

const example = readFileSync(new URL("../../.env.example", import.meta.url), {
  encoding: "utf8",
});

function documentedNames(content: string): readonly string[] {
  const names = new Set<string>();
  for (const line of content.split("\n")) {
    const match = /^#?\s*([A-Z][A-Z0-9_]*)=/u.exec(line.trim());
    if (match?.[1] !== undefined) names.add(match[1]);
  }
  return [...names].sort();
}

describe(".env.example", () => {
  it("documents every environment variable the runtime reads", () => {
    const documented = new Set(documentedNames(example));
    const missing = RUNTIME_VARIABLE_NAMES.filter(
      (name) => !documented.has(name),
    );
    expect(missing).toEqual([]);
  });

  it("does not document variables the runtime ignores", () => {
    const known = new Set(RUNTIME_VARIABLE_NAMES);
    const unknown = documentedNames(example).filter((name) => !known.has(name));
    expect(unknown).toEqual([]);
  });

  it("documents the two variables that Linux power effects require together", () => {
    const documented = new Set(documentedNames(example));
    expect(documented.has("MACHINE_POWER_EFFECTS_CONFIRMATION")).toBe(true);
    expect(documented.has("LINUX_POWER_HELPER_EXPECTED_SHA256")).toBe(true);
  });

  it("keeps the mock-only safety baseline uncommented", () => {
    for (const line of [
      "POWER_MANAGEMENT_BACKEND=mock",
      "MACHINE_POWER_EFFECTS_ACTIVATION=disabled",
      "MACHINE_POWER_SCHEDULER_ENABLED=false",
    ])
      expect(example).toContain(`\n${line}`);
  });
});
