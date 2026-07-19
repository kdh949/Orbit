import { fontAssetCatalogByFamily } from "@orbit/font-assets";
import type { Deck, Slide } from "@orbit/shared";
import { describe, expect, it } from "vitest";

import {
  collectSlideFontRequests,
  ensureFontLoaded,
  resolveWebFontFamily,
  selectFontFaces,
} from "./fontRegistry";

describe("fontRegistry", () => {
  it("resolves canonical families without changing Deck values", () => {
    expect(resolveWebFontFamily("Playfair Display")).toBe(
      '"Playfair Display", "Pretendard", Arial, serif',
    );
    expect(resolveWebFontFamily("Imported Font")).toContain('"Imported Font"');
  });

  it("selects only unicode-range faces needed by the text", () => {
    const font = fontAssetCatalogByFamily.get("Noto Sans KR");
    expect(font).toBeDefined();
    const koreanFaces = selectFontFaces(font!, {
      style: "normal",
      text: "한글",
      weight: 600,
    });
    const latinFaces = selectFontFaces(font!, {
      style: "normal",
      text: "Orbit",
      weight: 600,
    });

    expect(koreanFaces.length).toBeGreaterThan(0);
    expect(koreanFaces.length).toBeLessThan(font!.faces.length);
    expect(latinFaces.length).toBeGreaterThan(0);
    expect(latinFaces.length).toBeLessThan(font!.faces.length);
    expect(latinFaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ subset: "latin", weight: "100 900" }),
      ]),
    );
  });

  it("collects theme and rich text run families", () => {
    const slide = {
      slideId: "slide-1",
      style: { fontFamily: "Noto Serif KR" },
      elements: [
        {
          type: "text",
          elementId: "text-1",
          props: {
            text: "Orbit",
            fontFamily: "Montserrat",
            fontWeight: 700,
          },
        },
      ],
    } as unknown as Slide;
    const deck = {
      theme: {
        typography: {
          headingFontFamily: "Pretendard",
          bodyFontFamily: "Noto Sans KR",
        },
      },
    } as Deck;

    expect(
      collectSlideFontRequests(deck, slide).map((request) => request.family),
    ).toEqual(
      expect.arrayContaining([
        "Pretendard",
        "Noto Sans KR",
        "Noto Serif KR",
        "Montserrat",
      ]),
    );
  });

  it("does not attempt to download unsupported imported fonts", async () => {
    await expect(ensureFontLoaded({ family: "Imported Font" })).resolves.toEqual({
      family: "Imported Font",
      status: "unsupported",
    });
  });
});
