import { describe, expect, it } from "vitest";
import type { PronunciationLexiconEntry, SemanticCue } from "@orbit/shared";

import { buildSpeechTrackingBiasPhrases } from "./speechBiasPhrases";

describe("buildSpeechTrackingBiasPhrases", () => {
  it("예산 압박에서도 컨트롤, 종결, 큐, 키워드 순서로 우선 보존한다", () => {
    const terms = buildSpeechTrackingBiasPhrases({
      budget: 6,
      controlPhrases: ["다음 슬라이드", "강조"],
      finalTriggerPhrases: ["마지막 결론"],
      cuePhrases: ["중요 지표"],
      keywords: [
        {
          keywordId: "kw_orbit",
          text: "오르빗",
          synonyms: ["리허설 도구"],
          abbreviations: ["Orbit"]
        }
      ],
      representativePhrases: ["발표 흐름 점검", "실시간 피드백"],
      legacyPhrases: ["레거시 제목", "레거시 본문"]
    });

    expect(terms.map((term) => term.text)).toEqual([
      "다음 슬라이드",
      "강조",
      "마지막 결론",
      "중요 지표",
      "오르빗",
      "리허설 도구"
    ]);
    expect(terms.map((term) => term.source)).toEqual([
      "control-phrase",
      "control-phrase",
      "final-trigger",
      "cue-trigger",
      "keyword",
      "synonym"
    ]);
  });

  it("상위 우선순위 문구와 중복되는 legacy 문구는 제거한다", () => {
    const terms = buildSpeechTrackingBiasPhrases({
      budget: 8,
      controlPhrases: ["다음 슬라이드"],
      finalTriggerPhrases: ["발표 마무리"],
      cuePhrases: [],
      keywords: [
        {
          keywordId: "kw_finish",
          text: "발표 마무리",
          synonyms: [],
          abbreviations: []
        }
      ],
      representativePhrases: ["발표 마무리"],
      legacyPhrases: ["발표 마무리", "레거시 제목"]
    });

    expect(terms.map((term) => term.text)).toEqual([
      "다음 슬라이드",
      "발표 마무리",
      "레거시 제목"
    ]);
    expect(terms[1].source).toBe("final-trigger");
    expect("keywordId" in terms[1]).toBe(false);
  });

  it("예산이 남을 때만 대표 구절과 legacy 문구를 포함한다", () => {
    const terms = buildSpeechTrackingBiasPhrases({
      budget: 10,
      controlPhrases: ["다음 슬라이드"],
      finalTriggerPhrases: ["마지막 결론"],
      cuePhrases: ["강조 지점"],
      keywords: [
        {
          keywordId: "kw_ai",
          text: "AI",
          synonyms: [],
          abbreviations: []
        }
      ],
      representativePhrases: ["발표 흐름 점검"],
      legacyPhrases: ["레거시 제목"]
    });

    expect(terms.map((term) => term.source)).toEqual([
      "control-phrase",
      "final-trigger",
      "cue-trigger",
      "keyword",
      "representative-phrase",
      "legacy"
    ]);
  });

  it("approved current core cue의 code term과 alias를 제한된 예산에 추가한다", () => {
    const terms = buildSpeechTrackingBiasPhrases({
      budget: 12,
      semanticCueTermBudget: 4,
      semanticCues: [
        semanticCue({
          cueId: "scue_rsp",
          aliases: {
            RSP: ["알에스피", "런타임 보안 정책"]
          },
          candidateKeywords: ["RSP", "일반 정책"]
        }),
        semanticCue({
          cueId: "scue_suggested",
          reviewStatus: "suggested",
          aliases: { ROX: ["알오엑스"] }
        }),
        semanticCue({
          cueId: "scue_stale",
          freshness: "stale",
          aliases: { file_deny_write: ["파일 쓰기 차단"] }
        })
      ]
    });

    expect(terms).toEqual([
      expect.objectContaining({
        text: "RSP",
        source: "semantic-cue-term",
        weight: 0.93,
        canonicalText: "RSP"
      }),
      expect.objectContaining({
        text: "알에스피",
        source: "semantic-cue-alias",
        weight: 0.91,
        canonicalText: "RSP"
      }),
      expect.objectContaining({
        text: "런타임 보안 정책",
        source: "semantic-cue-alias",
        weight: 0.91,
        canonicalText: "RSP"
      }),
    ]);
    expect(terms.map((term) => term.text)).not.toContain("일반 정책");
    expect(terms.map((term) => term.text)).not.toContain("ROX");
    expect(terms.map((term) => term.text)).not.toContain("file_deny_write");
  });

  it("current cue를 우선하고 인접 slide core cue를 낮은 가중치로 dedupe한다", () => {
    const terms = buildSpeechTrackingBiasPhrases({
      budget: 12,
      semanticCueTermBudget: 4,
      semanticCues: [
        semanticCue({
          cueId: "scue_current",
          aliases: { RSP: ["알에스피"] }
        })
      ],
      adjacentSemanticCues: [
        semanticCue({
          cueId: "scue_adjacent",
          slideId: "slide_2",
          aliases: { RSP: ["알에스피"], ROX: ["알오엑스"] }
        })
      ]
    });

    expect(terms.map((term) => term.text)).toEqual([
      "RSP",
      "알에스피",
      "ROX",
      "알오엑스"
    ]);
    expect(terms.map((term) => term.weight)).toEqual([0.93, 0.91, 0.85, 0.82]);
  });

  it("현재 slide 발음 alias를 인접 slide보다 먼저 STT bias에 포함한다", () => {
    const terms = buildSpeechTrackingBiasPhrases({
      budget: 6,
      controlPhrases: ["다음 슬라이드"],
      pronunciationEntries: [
        pronunciationEntry("openai", "OpenAI", "오픈에이아이"),
      ],
      adjacentPronunciationEntries: [
        pronunciationEntry("github", "GitHub", "깃허브", "slide_2"),
      ],
    });

    expect(terms.map((term) => term.text)).toEqual([
      "다음 슬라이드",
      "OpenAI",
      "오픈에이아이",
      "GitHub",
      "깃허브",
    ]);
    expect(terms.map((term) => term.source)).toEqual([
      "control-phrase",
      "pronunciation-source",
      "pronunciation-alias",
      "pronunciation-source",
      "pronunciation-alias",
    ]);
    expect(terms.map((term) => term.weight)).toEqual([
      1, 0.93, 0.9, 0.78, 0.74,
    ]);
  });
});

function semanticCue(overrides: Partial<SemanticCue> = {}): SemanticCue {
  return {
    cueId: "scue_1",
    slideId: "slide_1",
    meaning: "RSP가 쓰기 작업을 제한합니다",
    importance: "core",
    reviewStatus: "approved",
    freshness: "current",
    origin: "manual",
    revision: 1,
    sourceRefs: [],
    qualityWarnings: [],
    required: true,
    priority: 1,
    candidateKeywords: [],
    aliases: {},
    requiredConcepts: ["RSP"],
    nliHypotheses: ["발표자는 RSP 정책을 설명했다"],
    negativeHints: [],
    targetElementIds: [],
    triggerActionIds: [],
    ...overrides,
  };
}

function pronunciationEntry(
  canonicalKey: string,
  sourceText: string,
  alias: string,
  slideId = "slide_1",
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
    scriptOccurrences: [{ slideId, start: 0, end: sourceText.length }],
  };
}
