import type { SemanticCue } from "@orbit/shared";
import { describe, expect, it } from "vitest";

import { selectSemanticCueCandidates } from "./semanticCueCandidateSelector";

describe("selectSemanticCueCandidates", () => {
  it("canonical concept와 여러 alias를 any-of 한 그룹으로 계산한다", () => {
    const baseCue = semanticCue({
      cueId: "scue_rsp",
      candidateKeywords: ["RSP"],
      requiredConcepts: ["RSP", "쓰기 차단"],
      aliases: {
        RSP: ["알에스피", "런타임 보안 정책"]
      }
    });
    const transcript = "알에스피가 파일 쓰기를 차단하는 정책입니다";

    const base = selectSemanticCueCandidates({
      slideId: "slide_1",
      transcript,
      cues: [baseCue],
      coveredCueIds: new Set()
    })[0];
    const withMoreAliases = selectSemanticCueCandidates({
      slideId: "slide_1",
      transcript,
      cues: [
        {
          ...baseCue,
          aliases: {
            RSP: [
              "알에스피",
              "런타임 보안 정책",
              "런타임 시큐리티 폴리시",
              "보안 실행 정책"
            ]
          }
        }
      ],
      coveredCueIds: new Set()
    })[0];

    expect(base?.conceptCoverage).toBe(1);
    expect(withMoreAliases?.conceptCoverage).toBe(base?.conceptCoverage);
  });

  it("prefers uncovered required and high-priority cues from the current slide", () => {
    const candidates = selectSemanticCueCandidates({
      slideId: "slide_1",
      transcript:
        "처음엔 세일즈에 돈이 많이 들어 고객 한 명 데려오는 비용이 컸습니다",
      cues: [
        semanticCue({
          cueId: "scue_required",
          meaning: "CAC가 높은 원인은 초기 영업 비용입니다",
          priority: 1,
          required: true,
          candidateKeywords: ["CAC", "세일즈"],
          requiredConcepts: ["영업 비용", "고객 획득 비용"]
        }),
        semanticCue({
          cueId: "scue_optional",
          meaning: "CAC는 중요한 지표입니다",
          priority: 3,
          required: false,
          candidateKeywords: ["CAC"],
          requiredConcepts: ["중요한 지표"]
        }),
        semanticCue({
          cueId: "scue_other_slide",
          slideId: "slide_2",
          meaning: "다른 슬라이드",
          priority: 1,
          required: true,
          candidateKeywords: ["세일즈"],
          requiredConcepts: ["영업 비용"]
        })
      ],
      coveredCueIds: new Set(["scue_optional"])
    });

    expect(candidates.map((candidate) => candidate.cue.cueId)).toEqual([
      "scue_required"
    ]);
    expect(candidates[0]).toMatchObject({
      lexicalScore: expect.any(Number),
      conceptCoverage: expect.any(Number),
      selectedForNli: true
    });
  });

  it("returns skipped reasons when no cue is eligible for NLI", () => {
    const candidates = selectSemanticCueCandidates({
      slideId: "slide_1",
      transcript: "전혀 관련 없는 발화",
      cues: [
        semanticCue({
          cueId: "scue_covered",
          candidateKeywords: ["CAC"],
          requiredConcepts: ["영업 비용"]
        })
      ],
      coveredCueIds: new Set(["scue_covered"])
    });

    expect(candidates).toEqual([
      expect.objectContaining({
        selectedForNli: false,
        nliSkippedReason: "already-covered"
      })
    ]);
  });

  it("priority만 높은 unrelated cue를 NLI 후보로 선택하지 않는다", () => {
    const candidates = selectSemanticCueCandidates({
      slideId: "slide_1",
      transcript: "오늘 점심 메뉴를 소개합니다",
      cues: [
        semanticCue({
          cueId: "scue_priority_only",
          importance: "core",
          reviewStatus: "approved",
          required: true,
          priority: 1,
          candidateKeywords: ["RSP"],
          requiredConcepts: ["런타임 보안 정책"]
        })
      ],
      coveredCueIds: new Set()
    });

    expect(candidates[0]).toMatchObject({
      cue: { cueId: "scue_priority_only" },
      selectedForNli: false
    });
  });

  it("cue retrieval threshold를 넘는 후보만 lexical evidence 없이 선택한다", () => {
    const cue = semanticCue({
      cueId: "scue_retrieval",
      candidateKeywords: [],
      aliases: {},
      requiredConcepts: []
    });
    const related = selectSemanticCueCandidates({
      slideId: "slide_1",
      transcript: "표현이 완전히 다른 관련 발화",
      cues: [cue],
      coveredCueIds: new Set(),
      retrievalScoresByCueId: new Map([[cue.cueId, 0.8]])
    });
    const unrelated = selectSemanticCueCandidates({
      slideId: "slide_1",
      transcript: "전혀 관련 없는 발화",
      cues: [cue],
      coveredCueIds: new Set(),
      retrievalScoresByCueId: new Map([[cue.cueId, 0.54]])
    });

    expect(related[0]).toMatchObject({
      retrievalScore: 0.8,
      selectedForNli: true
    });
    expect(unrelated[0]).toMatchObject({
      retrievalScore: 0.54,
      selectedForNli: false,
      nliSkippedReason: "no-meaningful-candidate"
    });
  });
});

function semanticCue(overrides: Partial<SemanticCue> = {}): SemanticCue {
  return {
    cueId: "scue_1",
    slideId: "slide_1",
    meaning: "CAC 원인 설명",
    importance: "supporting",
    reviewStatus: "approved",
    freshness: "current",
    origin: "imported",
    revision: 1,
    sourceRefs: [],
    qualityWarnings: [],
    required: true,
    priority: 1,
    candidateKeywords: [],
    aliases: {},
    requiredConcepts: [],
    nliHypotheses: ["CAC가 초기 영업 비용 때문에 높다"],
    negativeHints: [],
    targetElementIds: [],
    triggerActionIds: [],
    ...overrides
  };
}
