import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const DASHBOARD_SOURCE_DIR = resolve(__dirname, "../../src/dashboard");

const UNSAFE_PATTERNS: readonly RegExp[] = [
  /\.innerHTML\s*=/u,
  /\.outerHTML\s*=/u,
  /document\.write\(/u,
  /\beval\(/u,
  /new Function\(/u,
];

describe("dashboard source contains no unsafe HTML or dynamic script insertion", () => {
  const files = readdirSync(DASHBOARD_SOURCE_DIR).filter((name) =>
    name.endsWith(".ts"),
  );
  expect(files.length).toBeGreaterThan(0);

  for (const file of files) {
    it(`${file} builds DOM only through safe APIs`, () => {
      const content = readFileSync(resolve(DASHBOARD_SOURCE_DIR, file), "utf8");
      for (const pattern of UNSAFE_PATTERNS) {
        expect(content).not.toMatch(pattern);
      }
    });
  }
});
