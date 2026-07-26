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
      "32f46786b30cad11ce18175807f8864a3d824f9d9bd8be74a52eef1cf319b13f",
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
      "12c83327e53172c472eb91a178ba38482ebb449af43feea3ceac94f29fd894ea",
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
