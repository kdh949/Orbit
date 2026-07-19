import { describe, expect, it } from "vitest";

import { generateDeckFontCatalog, recommendGenerateDeckFonts } from "./font-catalog";

describe("recommendGenerateDeckFonts", () => {
  it("returns three font candidates matched to the requested mood", () => {
    const options = recommendGenerateDeckFonts("동글동글하고 친근한 한글 폰트");

    expect(options).toHaveLength(3);
    expect(options[0].moodTags).toEqual(
      expect.arrayContaining(["rounded", "friendly"])
    );
    expect(options[0].license).toBeTruthy();
    expect(options[0].sourceUrl).toContain("http");
  });

  it("marks wide display fonts with overflow safety metadata", () => {
    const gmarketSans = generateDeckFontCatalog.find(
      (font) => font.fontId === "gmarket-sans"
    );

    expect(gmarketSans).toMatchObject({
      recommendedBodySize: 20,
      widthFactor: 1.18,
      overflowRisk: "high"
    });
  });

  it("keeps the five existing AI recommendation fonts", () => {
    expect(
      generateDeckFontCatalog
        .filter((font) => font.recommendForAi)
        .map((font) => font.fontId)
    ).toEqual([
      "pretendard",
      "noto-sans-kr",
      "gowun-dodum",
      "nanum-square-round",
      "gmarket-sans"
    ]);
  });

  it("registers ten manual editor fonts without recommending them", () => {
    const manualFonts = generateDeckFontCatalog.filter(
      (font) => !font.recommendForAi
    );

    expect(generateDeckFontCatalog).toHaveLength(15);
    expect(manualFonts).toHaveLength(10);
    expect(manualFonts.filter((font) => font.supportsKorean)).toHaveLength(5);
    expect(recommendGenerateDeckFonts("premium editorial display", 20)).toHaveLength(5);
    expect(
      recommendGenerateDeckFonts("premium editorial display", 20).map(
        (font) => font.fontId
      )
    ).not.toContain("playfair-display");
  });
});
