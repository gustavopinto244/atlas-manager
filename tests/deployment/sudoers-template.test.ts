import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const SUDOERS_TEMPLATE_PATH = resolve(
  __dirname,
  "../../deployment/sudoers/atlas-manager-operator",
);

describe("Sudoers template for Atlas Manager operator", () => {
  const content = readFileSync(SUDOERS_TEMPLATE_PATH, "utf8");

  it("documents the required file permissions (440)", () => {
    const commentLine = content
      .split("\n")
      .find((line) => line.includes("install -m 440"));
    expect(commentLine).toBeTruthy();
    expect(commentLine).toContain("-o root -g root");
  });

  it("does not contain wildcard command arguments", () => {
    const lines = content.split("\n");
    const sudoRuleLines = lines.filter(
      (line) => line.includes("NOPASSWD:") && !line.startsWith("#"),
    );
    expect(sudoRuleLines.length).toBeGreaterThan(0);
    for (const line of sudoRuleLines) {
      expect(line).not.toContain(" * ");
    }
  });

  it("specifies absolute paths for all commands", () => {
    const lines = content.split("\n");
    const sudoRuleLines = lines.filter(
      (line) => line.includes("NOPASSWD:") && !line.startsWith("#"),
    );
    for (const line of sudoRuleLines) {
      const commandPart = line.split("NOPASSWD:")[1];
      expect(commandPart).toBeTruthy();
      expect(commandPart?.trim()).toMatch(/^\/[\w/-]+/);
    }
  });

  it("does not grant sudo access to docker", () => {
    const lines = content.split("\n");
    const sudoRuleLines = lines.filter(
      (line) => line.includes("NOPASSWD:") && !line.startsWith("#"),
    );
    for (const line of sudoRuleLines) {
      expect(line.toLowerCase()).not.toContain("docker");
    }
  });

  it("includes the required systemctl commands", () => {
    const systemctlCommands = [
      "systemctl start atlas-manager.service",
      "systemctl stop atlas-manager.service",
      "systemctl restart atlas-manager.service",
      "systemctl status atlas-manager.service",
      "systemctl is-enabled atlas-manager.service",
      "systemctl is-active atlas-manager.service",
    ];
    for (const cmd of systemctlCommands) {
      expect(content).toContain(cmd);
    }
  });

  it("includes journalctl for service logs", () => {
    expect(content).toContain("journalctl -u atlas-manager.service");
  });

  it("references the rollback procedure in comments", () => {
    expect(content).toContain("Remove this file");
  });
});
