import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const appSource = read("../App.tsx");
const providersSource = read("./AppProviders.tsx");
const routesSource = read("./staticRoutes.ts");

describe("App shell architecture", () => {
  it("delegates provider composition to the provider shell", () => {
    expect(appSource).toContain("<AppProviders>");
    expect(appSource).not.toContain("<PptxImportProvider>");
    expect(providersSource).toContain("<PptxImportProvider>");
  });

  it("delegates fixed route lookup and query parsing", () => {
    expect(appSource).toContain("resolveStaticRoute(normalized, currentSearch");
    expect(appSource).toContain("parseRouteNonNegativeInteger");
    expect(routesSource).toContain("staticRouteTable");
    expect(routesSource).toContain("parseRouteNonNegativeInteger");
  });
});

function read(relativePath: string) {
  return fs.readFileSync(
    fileURLToPath(new URL(relativePath, import.meta.url)),
    "utf8",
  );
}
