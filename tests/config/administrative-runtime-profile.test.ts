import { describe, expect, it } from "vitest";
import {
  createMockAdministrativeEnvironment,
  parseMockAdministrativeInput,
} from "../../src/config/administrative-runtime-profile.js";

const input = JSON.stringify({
  schemaVersion: 1,
  cloudflareTeamName: "example-team",
  cloudflareAudience: "example-audience",
  roleAssignments: [
    {
      principalId: "00000000-0000-4000-8000-000000000001",
      roles: ["administrator"],
    },
  ],
  registeredServices: [],
});

describe("mock administrative runtime profile", () => {
  it("validates the input and the generated environment through application parsers", () => {
    const parsed = parseMockAdministrativeInput(input);
    const environment = createMockAdministrativeEnvironment(parsed);

    expect(environment.HOST).toBe("127.0.0.1");
    expect(environment.POWER_MANAGEMENT_BACKEND).toBe("mock");
    expect(environment.MACHINE_POWER_SCHEDULER_ENABLED).toBe("false");
    expect(environment.ADMINISTRATIVE_DASHBOARD_ENABLED).toBe("true");
    expect(environment.ADMINISTRATIVE_WAKE_ALARM_HTTP_ENABLED).toBe("false");
    expect(environment.ADMINISTRATIVE_SHUTDOWN_HTTP_ENABLED).toBe("false");
  });

  it.each(["unknown", "administrator", "service_operator"])(
    "keeps role validation bounded for %s",
    (role) => {
      const value = JSON.parse(input) as Record<string, unknown>;
      value.roleAssignments = [
        {
          principalId: "00000000-0000-4000-8000-000000000001",
          roles: [role],
        },
      ];
      if (role === "unknown")
        expect(() =>
          createMockAdministrativeEnvironment(
            parseMockAdministrativeInput(JSON.stringify(value)),
          ),
        ).toThrow();
      else
        expect(() =>
          parseMockAdministrativeInput(JSON.stringify(value)),
        ).not.toThrow();
    },
  );
});
