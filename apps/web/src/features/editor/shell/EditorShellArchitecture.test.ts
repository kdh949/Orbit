import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const publicSource = read("./public.ts");
const shellSource = read("./EditorShell.tsx");
const controllerSource = read("./EditorShellController.tsx");

describe("EditorShell architecture", () => {
  it("keeps the public shell as a thin controller boundary", () => {
    expect(shellSource.split("\n").length).toBeLessThanOrEqual(20);
    expect(shellSource).toContain("<EditorShellController");
    expect(shellSource).not.toContain("useEffect");
    expect(shellSource).not.toContain("useState");
  });

  it("preserves the compatibility exports behind the public module", () => {
    expect(publicSource).toContain('export * from "./EditorShell"');
    expect(shellSource).toContain('export * from "./EditorShellController"');
    expect(controllerSource).toContain("export function getEditorStatusLabel");
  });

  it("keeps the editor view composition inside the controller boundary", () => {
    expect(controllerSource).toContain("<EditorTopbar");
    expect(controllerSource).toContain("<EditorCanvasStage");
    expect(controllerSource).toContain("<EditorRightPanel");
  });
});

function read(relativePath: string) {
  return fs.readFileSync(
    fileURLToPath(new URL(relativePath, import.meta.url)),
    "utf8",
  );
}
