import { describe, expect, it } from "vitest";

import { deckSchema, type Deck } from "../deck/deck.schema";
import {
  extractScriptEnglishTerms,
  generatePronunciationLexicon,
  matchPronunciationAliases,
  normalizePronunciationText,
} from "./index";

describe("extractScriptEnglishTerms", () => {
  it("extracts product, acronym, and symbol expressions with UTF-16 offsets", () => {
    const notes = "OpenAI API와 Next.js, UI/UX를 소개합니다.";

    expect(
      extractScriptEnglishTerms([{ slideId: "slide_1", speakerNotes: notes }]),
    ).toEqual([
      occurrence("OpenAI", notes, "product"),
      occurrence("API", notes, "acronym"),
      occurrence("Next.js", notes, "product"),
      occurrence("UI/UX", notes, "mixed"),
    ]);
  });

  it("does not produce terms for a Korean-only script", () => {
    expect(
      extractScriptEnglishTerms([
        { slideId: "slide_1", speakerNotes: "순수 한국어 발표 대본입니다." },
      ]),
    ).toEqual([]);
  });
});

describe("generatePronunciationLexicon", () => {
  it("generates deterministic product and acronym aliases", () => {
    const lexicon = generatePronunciationLexicon(
      deckWithNotes("OpenAI API와 React, GitHub, LLM, STT를 활용했습니다."),
    );

    expect(
      entry(lexicon, "OpenAI")?.aliases.map((alias) => alias.text),
    ).toEqual(expect.arrayContaining(["오픈에이아이"]));
    expect(entry(lexicon, "API")?.aliases.map((alias) => alias.text)).toEqual(
      expect.arrayContaining(["에이피아이"]),
    );
    expect(entry(lexicon, "React")?.aliases.map((alias) => alias.text)).toEqual(
      expect.arrayContaining(["리액트"]),
    );
    expect(
      entry(lexicon, "GitHub")?.aliases.map((alias) => alias.text),
    ).toEqual(expect.arrayContaining(["깃허브", "깃헙"]));
    expect(entry(lexicon, "LLM")?.aliases.map((alias) => alias.text)).toEqual(
      expect.arrayContaining(["엘엘엠"]),
    );
    expect(entry(lexicon, "STT")?.aliases.map((alias) => alias.text)).toEqual(
      expect.arrayContaining(["에스티티"]),
    );
    expect(lexicon.sourceHash).toMatch(/^[a-f0-9]{16}$/);
    expect(generatePronunciationLexicon(deckWithNotes("OpenAI API"))).toEqual(
      generatePronunciationLexicon(deckWithNotes("OpenAI API")),
    );
  });

  it("merges existing keyword aliases without generating arbitrary word aliases", () => {
    const deck = deckWithNotes("OrbitSQL과 MysteryProduct를 소개합니다.");
    deck.slides[0]!.keywords = [
      {
        keywordId: "kw_1",
        text: "OrbitSQL",
        synonyms: ["오빗 에스큐엘"],
        abbreviations: [],
        required: true,
      },
    ];

    const lexicon = generatePronunciationLexicon(deck);

    expect(entry(lexicon, "OrbitSQL")?.aliases).toContainEqual(
      expect.objectContaining({
        text: "오빗 에스큐엘",
        origin: "existing-keyword",
      }),
    );
    expect(entry(lexicon, "MysteryProduct")?.aliases).toEqual([]);
    expect(entry(lexicon, "MysteryProduct")?.status).toBe("needs-review");
  });

  it("records every occurrence while deduplicating entries", () => {
    const deck = deckWithNotes("OpenAI를 소개하고 OpenAI API를 사용합니다.");

    const lexicon = generatePronunciationLexicon(deck);

    expect(entry(lexicon, "OpenAI")?.scriptOccurrences).toHaveLength(2);
    expect(
      lexicon.entries.filter((item) => item.sourceText === "OpenAI"),
    ).toHaveLength(1);
  });
});

describe("normalizePronunciationText", () => {
  it("normalizes Unicode, case, whitespace, and supported separators", () => {
    expect(normalizePronunciationText("Ｎｅｘｔ．ＪＳ")).toEqual({
      boundaryText: "next js",
      compactText: "nextjs",
    });
    expect(normalizePronunciationText("오픈  에이-아이").compactText).toBe(
      "오픈에이아이",
    );
  });
});

describe("matchPronunciationAliases", () => {
  it("creates canonical evidence without changing the transcript", () => {
    const transcript = "오픈 에이아이 에이피아이를 활용했습니다.";
    const lexicon = generatePronunciationLexicon(
      deckWithNotes("OpenAI API를 활용했습니다."),
    );

    const result = matchPronunciationAliases(transcript, lexicon, {
      slideIds: ["slide_1"],
    });

    expect(result.originalText).toBe(transcript);
    expect(result.evidence.map((item) => item.canonicalKey)).toEqual([
      "openai",
      "api",
    ]);
    expect(
      result.evidence.map((item) =>
        transcript.slice(item.originalStart, item.originalEnd),
      ),
    ).toEqual(["오픈 에이아이", "에이피아이"]);
  });

  it("matches the longest alias first and preserves repeated occurrences", () => {
    const transcript = "깃허브와 깃헙에서 GitHub를 확인했습니다.";
    const lexicon = generatePronunciationLexicon(
      deckWithNotes("GitHub와 GitHub를 확인했습니다."),
    );

    const result = matchPronunciationAliases(transcript, lexicon);

    expect(result.evidence.map((item) => item.canonicalKey)).toEqual([
      "github",
      "github",
      "github",
    ]);
  });

  it("abstains when an alias maps to more than one canonical term", () => {
    const lexicon = generatePronunciationLexicon(deckWithNotes("Alpha Beta"));
    lexicon.entries[0]!.aliases = [alias("공통발음")];
    lexicon.entries[1]!.aliases = [alias("공통발음")];
    lexicon.entries[0]!.status = "active";
    lexicon.entries[1]!.status = "active";

    const result = matchPronunciationAliases("공통발음을 말했습니다.", lexicon);

    expect(result.evidence).toEqual([]);
    expect(result.ambiguities).toEqual([
      expect.objectContaining({ matchedText: "공통발음" }),
    ]);
  });

  it("does not match an alias from an inactive slide", () => {
    const deck = deckWithNotes("OpenAI");
    deck.slides.push({
      ...deck.slides[0]!,
      slideId: "slide_2",
      order: 2,
      speakerNotes: "GitHub",
      keywords: [],
    });
    const lexicon = generatePronunciationLexicon(deck);

    const result = matchPronunciationAliases("깃허브", lexicon, {
      slideIds: ["slide_1"],
    });

    expect(result.evidence).toEqual([]);
  });

  it("leaves Korean-only transcripts unchanged with an empty lexicon", () => {
    const transcript = "순수 한국어 발표입니다.";
    const lexicon = generatePronunciationLexicon(deckWithNotes(transcript));

    expect(matchPronunciationAliases(transcript, lexicon)).toEqual({
      originalText: transcript,
      evidence: [],
      ambiguities: [],
    });
  });
});

function occurrence(
  sourceText: string,
  notes: string,
  category: "acronym" | "word" | "product" | "numeric-symbol" | "mixed",
) {
  const start = notes.indexOf(sourceText);
  return {
    sourceText,
    normalizedSource: sourceText.normalize("NFKC").toLocaleLowerCase("en-US"),
    category,
    occurrence: {
      slideId: "slide_1",
      start,
      end: start + sourceText.length,
    },
  };
}

function entry(
  lexicon: ReturnType<typeof generatePronunciationLexicon>,
  sourceText: string,
) {
  return lexicon.entries.find((item) => item.sourceText === sourceText);
}

function alias(text: string) {
  return {
    text,
    normalizedText: text,
    origin: "user" as const,
    confidence: 1,
    enabled: true,
  };
}

function deckWithNotes(speakerNotes: string): Deck {
  return deckSchema.parse({
    deckId: "deck_1",
    projectId: "project_1",
    title: "Pronunciation",
    version: 1,
    targetDurationMinutes: 5,
    canvas: {
      preset: "wide-16-9",
      width: 1920,
      height: 1080,
      aspectRatio: "16:9",
    },
    slides: [
      {
        kind: "content",
        slideId: "slide_1",
        order: 1,
        title: "Terms",
        thumbnailUrl: "",
        style: {},
        speakerNotes,
        elements: [],
        keywords: [],
        semanticCues: [],
        animations: [],
        actions: [],
      },
    ],
  });
}
