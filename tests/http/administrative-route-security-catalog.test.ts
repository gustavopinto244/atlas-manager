import express from "express";
import { describe, expect, it } from "vitest";
import {
  reconcileAdministrativeRouteRegistrations,
  registerAdministrativeRoute,
} from "../../src/http/administrative-route-security-catalog.js";

describe("administrative route security catalog registration", () => {
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

    expect(() =>
      reconcileAdministrativeRouteRegistrations(app, ["dashboard.read.root"]),
    ).toThrow("administrative_route_policy_invalid");
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
