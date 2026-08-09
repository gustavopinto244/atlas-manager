import express from "express";
import { describe, expect, it } from "vitest";
import {
  ADMINISTRATIVE_ROUTE_SECURITY_CATALOG,
  reconcileAdministrativeRouteRegistrations,
  registerAdministrativeRoute,
} from "../../src/http/administrative-route-security-catalog.js";

describe("administrative route security catalog registration", () => {
  it("keeps the explicit operator-experience route-count contract", () => {
    expect(ADMINISTRATIVE_ROUTE_SECURITY_CATALOG).toHaveLength(45);
  });

  it("records the implemented power endpoint body limits", () => {
    const wake = ADMINISTRATIVE_ROUTE_SECURITY_CATALOG.find(
      (descriptor) => descriptor.routeId === "power.wake.update",
    );
    const shutdown = ADMINISTRATIVE_ROUTE_SECURITY_CATALOG.find(
      (descriptor) => descriptor.routeId === "power.shutdown.prepare",
    );
    const wakeDelete = ADMINISTRATIVE_ROUTE_SECURITY_CATALOG.find(
      (descriptor) => descriptor.routeId === "power.wake.delete",
    );

    expect(wake?.requestPolicy.maxBodyBytes).toBe(512);
    expect(wakeDelete?.requestPolicy).toMatchObject({
      body: "none",
      maxBodyBytes: 0,
    });
    expect(shutdown?.requestPolicy.maxBodyBytes).toBe(1_024);
  });

  it("records the descriptor at the point the Express route is registered", () => {
    const app = express();
    registerAdministrativeRoute(
      app,
      ["dashboard.read"],
      (_request, response) => {
        response.status(200).end();
      },
    );

    expect(() =>
      reconcileAdministrativeRouteRegistrations(app, ["dashboard.read"]),
    ).not.toThrow();
  });

  it("fails closed when the runtime registration and expected catalog differ", () => {
    const app = express();
    registerAdministrativeRoute(
      app,
      ["dashboard.read"],
      (_request, response) => {
        response.status(200).end();
      },
    );

    expect(() => reconcileAdministrativeRouteRegistrations(app, [])).toThrow(
      "administrative_route_policy_invalid",
    );
  });

  it("fails closed when an administrative route bypasses the registration helper", () => {
    const app = express();
    app.get("/admin/unlisted", (_request, response) => {
      response.status(200).end();
    });

    expect(() => reconcileAdministrativeRouteRegistrations(app, [])).toThrow(
      "administrative_route_policy_invalid",
    );
  });
});
