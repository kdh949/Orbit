import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const publicSource = read("./public.ts");
const workspaceSource = read("./PresentationWorkspace.tsx");
const controllerSource = read("./PresentationWorkspaceController.tsx");

describe("PresentationWorkspace architecture", () => {
  it("keeps the public component as a thin controller boundary", () => {
    expect(workspaceSource.split("\n").length).toBeLessThanOrEqual(20);
    expect(workspaceSource).toContain("<PresentationWorkspaceController");
    expect(workspaceSource).not.toContain("useEffect");
    expect(workspaceSource).not.toContain("useState");
  });

  it("exposes only the workspace and its props through the public API", () => {
    expect(publicSource).toContain("PresentationWorkspace");
    expect(publicSource).toContain("PresentationWorkspaceProps");
    expect(publicSource).not.toContain("PresentationWorkspaceController");
  });

  it("delegates rendering to the dedicated presentation screen", () => {
    expect(controllerSource).toContain("<PresentationScreen");
    expect(controllerSource).not.toContain(
      '<header className="rehearsal-presenter-topbar">',
    );
  });
});

function read(relativePath: string) {
  return fs.readFileSync(
    fileURLToPath(new URL(relativePath, import.meta.url)),
    "utf8",
  );
}
