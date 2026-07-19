import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const webRoot = process.cwd();
const systemFontPattern = /-apple-system|BlinkMacSystemFont|Apple SD Gothic Neo|SFMono-Regular|SF Mono|Menlo|SUIT Variable|ui-monospace|ui-sans-serif|system-ui/;

describe("ORBIT web fonts", () => {
  it("bundles Pretendard without a local-font dependency", () => {
    const fontCss = fs.readFileSync(path.join(webRoot, "src/fonts.css"), "utf8");
    expect(fontCss).toContain('font-family: "Pretendard"');
    expect(fontCss).toContain(
      "packages/font-assets/assets/web/pretendard-latin-400-normal.woff2",
    );
    expect(fontCss).toContain(
      "packages/font-assets/assets/web/pretendard-latin-700-normal.woff2",
    );
    expect(fontCss).not.toContain("local(");
    expect(
      fs.existsSync(
        path.join(
          webRoot,
          "../../packages/font-assets/assets/web/pretendard-latin-400-normal.woff2",
        ),
      ),
    ).toBe(true);
  });

  it("does not fall back to platform-specific UI fonts", () => {
    const sources = [
      "src/styles.css",
      "src/styles/tokens.css",
      "src/styles/foundations.css",
      "src/features/editor/editor-shell.css",
      "semantic-cue-lab.html"
    ].map((file) => fs.readFileSync(path.join(webRoot, file), "utf8"));
    for (const source of sources) expect(source).not.toMatch(systemFontPattern);
  });
});
