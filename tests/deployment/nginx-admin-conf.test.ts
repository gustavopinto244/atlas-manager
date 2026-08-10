import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const NGINX_TEMPLATE_PATH = resolve(
  __dirname,
  "../../deployment/nginx/atlas-manager-admin.conf",
);

describe("Nginx administrative server block invariants", () => {
  const configContent = readFileSync(NGINX_TEMPLATE_PATH, "utf8");

  it("contains the assertion forwarding header", () => {
    expect(configContent).toContain(
      "proxy_set_header Cf-Access-Jwt-Assertion $http_cf_access_jwt_assertion;",
    );
  });

  it("contains the health endpoint denial block", () => {
    expect(configContent).toMatch(
      /location\s+\/health\/\s*\{[\s\S]*?deny\s+all;/,
    );
  });

  it("does not allow public access to health metrics", () => {
    const healthBlock = configContent.match(
      /location\s+\/health\/\s*\{[\s\S]*?\}/,
    );
    expect(healthBlock).toBeTruthy();
    expect(healthBlock?.[0]).toContain("deny all");
  });

  it("references the documented 2026-08-09 incident", () => {
    expect(configContent).toContain("2026-08-09");
  });
});
