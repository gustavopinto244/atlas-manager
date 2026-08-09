import { readFile } from "node:fs/promises";
import process from "node:process";

const file = process.argv[2];
if (!file || process.argv.length !== 3)
  throw new Error("audit_report_required");
const [report, lock] = await Promise.all([
  readFile(file, "utf8").then(JSON.parse),
  readFile("package-lock.json", "utf8").then(JSON.parse),
]);
const vulnerabilities = report.vulnerabilities;
if (!vulnerabilities || typeof vulnerabilities !== "object")
  throw new Error("audit_report_invalid");

const allowedDevelopmentAdvisories = new Set(["brace-expansion"]);
const unclassified = [];
let allowedCount = 0;
for (const [name, value] of Object.entries(vulnerabilities)) {
  if (!value || typeof value !== "object")
    throw new Error("audit_entry_invalid");
  const severity = value.severity;
  if (severity !== "high" && severity !== "critical") continue;
  const nodes = Array.isArray(value.nodes) ? value.nodes : [];
  const developmentOnly =
    nodes.length > 0 &&
    nodes.every((node) => lock.packages?.[node]?.dev === true);
  if (developmentOnly && allowedDevelopmentAdvisories.has(name)) {
    allowedCount += 1;
    continue;
  }
  unclassified.push({ name, severity, dev: value.dev === true });
}
if (unclassified.length > 0) {
  throw new Error(
    `audit_high_or_critical_unclassified:${JSON.stringify(unclassified)}`,
  );
}
process.stdout.write(
  JSON.stringify({
    result:
      allowedCount > 0
        ? "known_dev_only_advisory"
        : "passed_no_high_or_critical",
    allowed: [...allowedDevelopmentAdvisories],
  }) + "\n",
);
