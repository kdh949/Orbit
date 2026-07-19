import type { PronunciationLexiconEntry } from "@orbit/shared";
import { describe, expect, it } from "vitest";

import { toCanonicalPronunciationMatchingText } from "./pronunciationMatchingAdapter";

describe("toCanonicalPronunciationMatchingText", () => {
  it("returns canonical matching text while preserving the original input", () => {
    const original = "오픈 에이아이 에이피아이를 활용했습니다.";

    const result = toCanonicalPronunciationMatchingText(
      original,
      [
        entry("openai", "OpenAI", "오픈에이아이"),
        entry("api", "API", "에이피아이"),
      ],
      "slide_1",
    );

    expect(original).toBe("오픈 에이아이 에이피아이를 활용했습니다.");
    expect(result).toBe("OpenAI API를 활용했습니다.");
  });

  it("does not replace ambiguous aliases", () => {
    expect(
      toCanonicalPronunciationMatchingText(
        "공통발음을 말했습니다.",
        [
          entry("alpha", "Alpha", "공통발음"),
          entry("beta", "Beta", "공통발음"),
        ],
        "slide_1",
      ),
    ).toBe("공통발음을 말했습니다.");
  });
});

function entry(
  canonicalKey: string,
  sourceText: string,
  alias: string,
): PronunciationLexiconEntry {
  return {
    id: `pron_${canonicalKey}`,
    sourceText,
    normalizedSource: sourceText.toLocaleLowerCase("en-US"),
    canonicalText: sourceText,
    canonicalKey,
    category: "product",
    aliases: [
      {
        text: alias,
        normalizedText: alias,
        origin: "static",
        confidence: 1,
        enabled: true,
      },
    ],
    confidence: 1,
    status: "active",
    scriptOccurrences: [
      { slideId: "slide_1", start: 0, end: sourceText.length },
    ],
  };
}
