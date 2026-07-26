import { describe, expect, it } from "vitest";

import {
  parseRouteNonNegativeInteger,
  resolveStaticRoute,
  staticRouteTable,
} from "./staticRoutes";

describe("static app routes", () => {
  it("keeps fixed and mockup routes in one explicit table", () => {
    expect(staticRouteTable["/"]).toEqual({ name: "home" });
    expect(staticRouteTable["/mockup/live-presenter"]).toEqual({
      name: "mockup",
      screen: "live-presenter",
    });
  });

  it("resolves the project list intent without changing its query contract", () => {
    expect(
      resolveStaticRoute("/project", "?intent=rehearsal", {
        deckRenderEnabled: false,
      }),
    ).toEqual({ name: "rehearsal-project-list" });
    expect(
      resolveStaticRoute("/project", "", { deckRenderEnabled: false }),
    ).toEqual({ name: "project-list" });
  });

  it("keeps the deck render route behind its environment gate", () => {
    expect(
      resolveStaticRoute("/__deck-render", "", {
        deckRenderEnabled: false,
      }),
    ).toBeUndefined();
    expect(
      resolveStaticRoute("/__deck-render", "", { deckRenderEnabled: true }),
    ).toEqual({ name: "deck-render" });
  });

  it("accepts only non-negative integer route parameters", () => {
    expect(parseRouteNonNegativeInteger("0")).toBe(0);
    expect(parseRouteNonNegativeInteger("12")).toBe(12);
    expect(parseRouteNonNegativeInteger("-1")).toBeUndefined();
    expect(parseRouteNonNegativeInteger("1.5")).toBeUndefined();
    expect(parseRouteNonNegativeInteger("")).toBeUndefined();
  });
});
