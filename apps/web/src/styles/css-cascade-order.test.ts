import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readCssBundle } from "./readCssBundle.test-utils";

const webRoot = process.cwd();
const globalStylesPath = path.join(webRoot, "src/styles.css");
const editorStylesPath = path.join(
  webRoot,
  "src/features/editor/editor-shell.css",
);

function sha256(source: string): string {
  return createHash("sha256").update(source).digest("hex");
}

describe("CSS cascade order", () => {
  it("keeps the global owner styles in their original byte order", () => {
    expect(fs.readFileSync(globalStylesPath, "utf8")).toBe(
      [
        '@import "./styles/app-shell.css";',
        '@import "./features/rehearsal/styles/rehearsal.css";',
        '@import "./features/reports/styles/reports.css";',
        '@import "./features/presenter-shell/styles/presenter-shell.css";',
        "",
      ].join("\n"),
    );
    expect(sha256(readCssBundle(globalStylesPath))).toBe(
      "33d1acfe0fd657a2a80ad16ac2572eb3dc6ec77ea301ffc7f420c0d2e9a8804e",
    );
  });

  it("keeps the editor layers in their original byte order", () => {
    expect(fs.readFileSync(editorStylesPath, "utf8")).toBe(
      [
        '@import "./styles/editor-foundation.css";',
        '@import "./styles/editor-panels.css";',
        '@import "./styles/editor-responsive.css";',
        '@import "./styles/editor-design-system.css";',
        '@import "./styles/editor-workbench.css";',
        '@import "./styles/editor-dark-workspace.css";',
        '@import "./styles/editor-reference-workbench.css";',
        '@import "./styles/editor-preparation.css";',
        '@import "./styles/editor-rehearsal.css";',
        "",
      ].join("\n"),
    );
    expect(sha256(readCssBundle(editorStylesPath))).toBe(
      "b4635073f405b66024cb182e72fb9db292b3125d061c9771963d2899f906f242",
    );
  });

  it("keeps the public entry stylesheets below their size targets", () => {
    expect(
      fs.readFileSync(globalStylesPath, "utf8").split("\n").length,
    ).toBeLessThanOrEqual(2_000);
    expect(
      fs.readFileSync(editorStylesPath, "utf8").split("\n").length,
    ).toBeLessThanOrEqual(3_000);
  });
});
