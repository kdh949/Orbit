import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const workspaceSourcePath = fileURLToPath(
  new URL("../RehearsalWorkspace.tsx", import.meta.url),
);

describe("RehearsalWorkspace public boundary", () => {
  it("exports only the workspace component and its props", () => {
    const source = readFileSync(workspaceSourcePath, "utf8");
    const declarations = [
      ...source.matchAll(
        /^export\s+(?:type|function|const|class)\s+([A-Za-z0-9_]+)/gm,
      ),
    ].map((match) => match[1]);

    expect(declarations).toEqual([
      "RehearsalWorkspaceProps",
      "RehearsalWorkspace",
    ]);
    expect(source).not.toMatch(/^export\s*\{/m);
  });

  it("keeps the public workspace as a small controller boundary", () => {
    const source = readFileSync(workspaceSourcePath, "utf8");
    const sourceLines = source.trimEnd().split("\n");
    const directDependencies = [
      ...source.matchAll(/from\s+["']([^"']+)["']/g),
    ].map((match) => match[1]);

    expect(sourceLines.length).toBeLessThanOrEqual(25);
    expect(directDependencies).toEqual(["./RehearsalWorkspaceController"]);
  });
});
