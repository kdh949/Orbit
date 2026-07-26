import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readCssBundle } from "./readCssBundle.test-utils";

const webRoot = process.cwd();
const systemFontPattern = /-apple-system|BlinkMacSystemFont|Apple SD Gothic Neo|SFMono-Regular|SF Mono|Menlo|SUIT Variable|ui-monospace|ui-sans-serif|system-ui/;

describe("ORBIT web fonts", () => {
  it("bundles Pretendard without a local-font dependency", () => {
    const fontCss = fs.readFileSync(path.join(webRoot, "src/fonts.css"), "utf8");
    expect(fontCss).toContain('font-family: "Pretendard"');
    expect(fontCss).toContain("PretendardVariable.woff2");
    expect(fontCss).toMatch(/font-weight:\s*45 920/);
    expect(fontCss).not.toContain("local(");
    expect(fs.existsSync(path.join(webRoot, "node_modules/pretendard/dist/web/variable/woff2/PretendardVariable.woff2"))).toBe(true);
  });

  it("does not fall back to platform-specific UI fonts", () => {
    const sources = [
      readCssBundle(path.join(webRoot, "src/styles.css")),
      fs.readFileSync(path.join(webRoot, "src/styles/tokens.css"), "utf8"),
      fs.readFileSync(path.join(webRoot, "src/styles/foundations.css"), "utf8"),
      readCssBundle(path.join(webRoot, "src/features/editor/editor-shell.css")),
      fs.readFileSync(path.join(webRoot, "semantic-cue-lab.html"), "utf8")
    ];
    for (const source of sources) expect(source).not.toMatch(systemFontPattern);
  });
});
