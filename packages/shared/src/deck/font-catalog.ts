import type { GenerateDeckFontOverride } from "./generate-deck.schema";

export type GenerateDeckFontMood =
  | "professional"
  | "rounded"
  | "friendly"
  | "editorial"
  | "tech"
  | "formal"
  | "playful";

export type GenerateDeckFontOption = GenerateDeckFontOverride & {
  rationale: string;
  score: number;
};

export type GenerateDeckFontCatalogEntry = GenerateDeckFontOverride & {
  recommendForAi: boolean;
};

export const generateDeckFontCatalog: GenerateDeckFontCatalogEntry[] = [
  {
    fontId: "pretendard",
    name: "Pretendard",
    headingFontFamily: "Pretendard",
    bodyFontFamily: "Pretendard",
    fallbackFamily: "Arial",
    weights: [400, 500, 600, 700],
    supportsKorean: true,
    pptxEmbeddable: true,
    moodTags: ["professional", "modern", "clear", "tech"],
    license: "SIL Open Font License 1.1",
    sourceUrl: "https://github.com/orioncactus/pretendard",
    recommendedTitleSize: 48,
    recommendedBodySize: 22,
    lineHeight: 1.15,
    widthFactor: 1,
    overflowRisk: "low",
    recommendForAi: true
  },
  {
    fontId: "noto-sans-kr",
    name: "Noto Sans KR",
    headingFontFamily: "Noto Sans KR",
    bodyFontFamily: "Noto Sans KR",
    fallbackFamily: "Arial",
    weights: [400, 500, 700],
    supportsKorean: true,
    pptxEmbeddable: true,
    moodTags: ["professional", "formal", "clear"],
    license: "SIL Open Font License 1.1",
    sourceUrl: "https://fonts.google.com/noto/specimen/Noto+Sans+KR",
    recommendedTitleSize: 46,
    recommendedBodySize: 21,
    lineHeight: 1.18,
    widthFactor: 1.04,
    overflowRisk: "medium",
    recommendForAi: true
  },
  {
    fontId: "gowun-dodum",
    name: "Gowun Dodum",
    headingFontFamily: "Gowun Dodum",
    bodyFontFamily: "Gowun Dodum",
    fallbackFamily: "Arial",
    weights: [400],
    supportsKorean: true,
    pptxEmbeddable: true,
    moodTags: ["friendly", "rounded", "editorial"],
    license: "SIL Open Font License 1.1",
    sourceUrl: "https://github.com/yangheeryu/Gowun-Dodum",
    recommendedTitleSize: 45,
    recommendedBodySize: 21,
    lineHeight: 1.22,
    widthFactor: 1.08,
    overflowRisk: "medium",
    recommendForAi: true
  },
  {
    fontId: "nanum-square-round",
    name: "NanumSquareRound",
    headingFontFamily: "NanumSquareRound",
    bodyFontFamily: "NanumSquareRound",
    fallbackFamily: "Arial",
    weights: [400, 700],
    supportsKorean: true,
    pptxEmbeddable: true,
    moodTags: ["rounded", "friendly", "playful"],
    license: "Naver Nanum Font License",
    sourceUrl: "https://hangeul.naver.com/font",
    recommendedTitleSize: 44,
    recommendedBodySize: 21,
    lineHeight: 1.2,
    widthFactor: 1.1,
    overflowRisk: "medium",
    recommendForAi: true
  },
  {
    fontId: "gmarket-sans",
    name: "Gmarket Sans",
    headingFontFamily: "Gmarket Sans",
    bodyFontFamily: "Gmarket Sans",
    fallbackFamily: "Arial",
    weights: [400, 500, 700],
    supportsKorean: true,
    pptxEmbeddable: true,
    moodTags: ["modern", "playful", "bold", "friendly"],
    license: "Gmarket Sans License",
    sourceUrl: "https://corp.gmarket.com/fonts",
    recommendedTitleSize: 40,
    recommendedBodySize: 20,
    lineHeight: 1.18,
    widthFactor: 1.18,
    overflowRisk: "high",
    recommendForAi: true
  },
  {
    fontId: "noto-serif-kr",
    name: "Noto Serif KR",
    headingFontFamily: "Noto Serif KR",
    bodyFontFamily: "Noto Serif KR",
    fallbackFamily: "serif",
    weights: [400, 500, 600, 700, 800, 900],
    supportsKorean: true,
    pptxEmbeddable: true,
    moodTags: ["editorial", "formal", "premium"],
    license: "SIL Open Font License 1.1",
    sourceUrl: "https://fonts.google.com/noto/specimen/Noto+Serif+KR",
    recommendedTitleSize: 46,
    recommendedBodySize: 21,
    lineHeight: 1.22,
    widthFactor: 1.04,
    overflowRisk: "medium",
    recommendForAi: false
  },
  {
    fontId: "nanum-myeongjo",
    name: "Nanum Myeongjo",
    headingFontFamily: "Nanum Myeongjo",
    bodyFontFamily: "Nanum Myeongjo",
    fallbackFamily: "serif",
    weights: [400, 700, 800],
    supportsKorean: true,
    pptxEmbeddable: true,
    moodTags: ["editorial", "formal", "classic"],
    license: "SIL Open Font License 1.1",
    sourceUrl: "https://fonts.google.com/specimen/Nanum+Myeongjo",
    recommendedTitleSize: 46,
    recommendedBodySize: 21,
    lineHeight: 1.24,
    widthFactor: 1.04,
    overflowRisk: "medium",
    recommendForAi: false
  },
  {
    fontId: "black-han-sans",
    name: "Black Han Sans",
    headingFontFamily: "Black Han Sans",
    bodyFontFamily: "Black Han Sans",
    fallbackFamily: "sans-serif",
    weights: [400],
    supportsKorean: true,
    pptxEmbeddable: true,
    moodTags: ["bold", "playful", "display"],
    license: "SIL Open Font License 1.1",
    sourceUrl: "https://fonts.google.com/specimen/Black+Han+Sans",
    recommendedTitleSize: 42,
    recommendedBodySize: 20,
    lineHeight: 1.16,
    widthFactor: 1.12,
    overflowRisk: "high",
    recommendForAi: false
  },
  {
    fontId: "do-hyeon",
    name: "Do Hyeon",
    headingFontFamily: "Do Hyeon",
    bodyFontFamily: "Do Hyeon",
    fallbackFamily: "sans-serif",
    weights: [400],
    supportsKorean: true,
    pptxEmbeddable: true,
    moodTags: ["bold", "friendly", "display"],
    license: "SIL Open Font License 1.1",
    sourceUrl: "https://fonts.google.com/specimen/Do+Hyeon",
    recommendedTitleSize: 44,
    recommendedBodySize: 20,
    lineHeight: 1.18,
    widthFactor: 1.08,
    overflowRisk: "medium",
    recommendForAi: false
  },
  {
    fontId: "jua",
    name: "Jua",
    headingFontFamily: "Jua",
    bodyFontFamily: "Jua",
    fallbackFamily: "sans-serif",
    weights: [400],
    supportsKorean: true,
    pptxEmbeddable: true,
    moodTags: ["playful", "friendly", "display"],
    license: "SIL Open Font License 1.1",
    sourceUrl: "https://fonts.google.com/specimen/Jua",
    recommendedTitleSize: 44,
    recommendedBodySize: 20,
    lineHeight: 1.2,
    widthFactor: 1.08,
    overflowRisk: "medium",
    recommendForAi: false
  },
  {
    fontId: "montserrat",
    name: "Montserrat",
    headingFontFamily: "Montserrat",
    bodyFontFamily: "Montserrat",
    fallbackFamily: "sans-serif",
    weights: [400, 500, 600, 700, 800, 900],
    supportsKorean: false,
    pptxEmbeddable: true,
    moodTags: ["modern", "professional", "display"],
    license: "SIL Open Font License 1.1",
    sourceUrl: "https://fonts.google.com/specimen/Montserrat",
    recommendedTitleSize: 46,
    recommendedBodySize: 21,
    lineHeight: 1.16,
    widthFactor: 1.02,
    overflowRisk: "medium",
    recommendForAi: false
  },
  {
    fontId: "poppins",
    name: "Poppins",
    headingFontFamily: "Poppins",
    bodyFontFamily: "Poppins",
    fallbackFamily: "sans-serif",
    weights: [400, 500, 600, 700, 800, 900],
    supportsKorean: false,
    pptxEmbeddable: true,
    moodTags: ["modern", "rounded", "display"],
    license: "SIL Open Font License 1.1",
    sourceUrl: "https://fonts.google.com/specimen/Poppins",
    recommendedTitleSize: 46,
    recommendedBodySize: 21,
    lineHeight: 1.16,
    widthFactor: 1.04,
    overflowRisk: "medium",
    recommendForAi: false
  },
  {
    fontId: "playfair-display",
    name: "Playfair Display",
    headingFontFamily: "Playfair Display",
    bodyFontFamily: "Playfair Display",
    fallbackFamily: "serif",
    weights: [400, 500, 600, 700, 800, 900],
    supportsKorean: false,
    pptxEmbeddable: true,
    moodTags: ["editorial", "formal", "premium"],
    license: "SIL Open Font License 1.1",
    sourceUrl: "https://fonts.google.com/specimen/Playfair+Display",
    recommendedTitleSize: 48,
    recommendedBodySize: 21,
    lineHeight: 1.18,
    widthFactor: 1.02,
    overflowRisk: "medium",
    recommendForAi: false
  },
  {
    fontId: "merriweather",
    name: "Merriweather",
    headingFontFamily: "Merriweather",
    bodyFontFamily: "Merriweather",
    fallbackFamily: "serif",
    weights: [300, 400, 500, 600, 700, 800, 900],
    supportsKorean: false,
    pptxEmbeddable: true,
    moodTags: ["editorial", "formal", "professional"],
    license: "SIL Open Font License 1.1",
    sourceUrl: "https://fonts.google.com/specimen/Merriweather",
    recommendedTitleSize: 45,
    recommendedBodySize: 20,
    lineHeight: 1.22,
    widthFactor: 1.06,
    overflowRisk: "medium",
    recommendForAi: false
  },
  {
    fontId: "bebas-neue",
    name: "Bebas Neue",
    headingFontFamily: "Bebas Neue",
    bodyFontFamily: "Bebas Neue",
    fallbackFamily: "sans-serif",
    weights: [400],
    supportsKorean: false,
    pptxEmbeddable: true,
    moodTags: ["bold", "modern", "display"],
    license: "SIL Open Font License 1.1",
    sourceUrl: "https://fonts.google.com/specimen/Bebas+Neue",
    recommendedTitleSize: 50,
    recommendedBodySize: 22,
    lineHeight: 1.08,
    widthFactor: 0.82,
    overflowRisk: "low",
    recommendForAi: false
  }
];

const moodKeywords: Record<GenerateDeckFontMood, string[]> = {
  professional: ["professional", "expert", "trust", "business", "전문", "신뢰"],
  rounded: ["rounded", "round", "soft", "cute", "동글", "둥근"],
  friendly: ["friendly", "warm", "casual", "친근", "부드러운"],
  editorial: ["editorial", "essay", "book", "감성", "에디토리얼"],
  tech: ["tech", "ai", "data", "developer", "기술", "개발"],
  formal: ["formal", "executive", "official", "임원", "격식"],
  playful: ["playful", "fun", "bold", "kids", "재미", "귀여운"]
};

export function recommendGenerateDeckFonts(
  input: string,
  limit = 3
): GenerateDeckFontOption[] {
  const source = input.toLocaleLowerCase("ko-KR");
  return generateDeckFontCatalog
    .filter((font) => font.recommendForAi)
    .map((font) => {
      const matchedMoods = font.moodTags.filter((tag) =>
        matchesMood(source, tag as GenerateDeckFontMood)
      );
      return {
        ...font,
        score: matchedMoods.length * 10 + defaultFontScore(font.fontId),
        rationale: fontRationale(font, matchedMoods)
      };
    })
    .sort((first, second) => second.score - first.score)
    .slice(0, limit);
}

function matchesMood(source: string, mood: GenerateDeckFontMood) {
  return moodKeywords[mood]?.some((keyword) =>
    source.includes(keyword.toLocaleLowerCase("ko-KR"))
  );
}

function defaultFontScore(fontId: string) {
  return fontId === "pretendard" ? 3 : fontId === "noto-sans-kr" ? 2 : 1;
}

function fontRationale(
  font: GenerateDeckFontOverride,
  matchedMoods: string[]
) {
  const moods = matchedMoods.length ? matchedMoods : font.moodTags.slice(0, 2);
  return `${font.name} matches ${moods.join(", ")} presentation tone.`;
}
