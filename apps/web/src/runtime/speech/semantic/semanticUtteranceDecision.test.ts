import { describe, expect, it } from "vitest";

import {
  decideSemanticUtteranceOutcome,
  SEMANTIC_OUTCOME_POLICY
} from "./semanticUtteranceDecision";
import type { SemanticUtteranceMatch } from "./semanticUtteranceMatcher";

describe("SEMANTIC_OUTCOME_POLICY", () => {
  it("uses the completed E5 calibration spike constants", () => {
    expect(SEMANTIC_OUTCOME_POLICY).toEqual({
      adLibRejectThreshold: 0.89,
      ambiguousMargin: 0.04,
      exactLexicalThreshold: 0.55
    });
  });
});

describe("decideSemanticUtteranceOutcome", () => {
  it("rejects low-score top 1 candidates as ad-lib instead of coverage", () => {
    const decision = decideSemanticUtteranceOutcome({
      slideId: "slide_1",
      transcript: "오늘 점심 메뉴 이야기를 잠깐 하겠습니다.",
      topMatches: [
        semanticMatch({ similarity: 0.881916 }),
        semanticMatch({ rank: 2, sentenceId: "sentence_2", similarity: 0.82 })
      ],
      policy: SEMANTIC_OUTCOME_POLICY
    });

    expect(decision).toMatchObject({
      accepted: false,
      acceptedMatch: null,
      reason: "ad-lib",
      outcome: "ad-lib"
    });
  });

  it("rejects ambiguous candidates even when top 1 is above the similarity threshold", () => {
    const decision = decideSemanticUtteranceOutcome({
      slideId: "slide_1",
      transcript: "두 문장 어디에도 정확히 고정하기 어려운 말입니다.",
      topMatches: [
        semanticMatch({ similarity: 0.93 }),
        semanticMatch({ rank: 2, sentenceId: "sentence_2", similarity: 0.891 })
      ],
      policy: SEMANTIC_OUTCOME_POLICY
    });

    expect(decision).toMatchObject({
      accepted: false,
      acceptedMatch: null,
      reason: "rejected-ambiguous",
      outcome: null
    });
  });

  it("rejects already-covered repeat without creating a public outcome", () => {
    const decision = decideSemanticUtteranceOutcome({
      slideId: "slide_1",
      transcript: "이미 설명한 내용을 반복합니다.",
      topMatches: [
        semanticMatch({ similarity: 0.995275, covered: true }),
        semanticMatch({ rank: 2, sentenceId: "sentence_2", similarity: 0.82 })
      ],
      policy: SEMANTIC_OUTCOME_POLICY
    });

    expect(decision).toMatchObject({
      accepted: false,
      acceptedMatch: null,
      reason: "rejected-covered",
      outcome: null
    });
  });

  it("labels accepted high lexical-overlap utterances as covered", () => {
    const decision = decideSemanticUtteranceOutcome({
      slideId: "slide_1",
      transcript: "핵심 문제는 팀의 반복 업무가 너무 많다는 점입니다.",
      topMatches: [
        semanticMatch({
          text: "핵심 문제는 팀의 반복 업무가 너무 많다는 점입니다.",
          similarity: 0.996329
        }),
        semanticMatch({ rank: 2, sentenceId: "sentence_2", similarity: 0.87 })
      ],
      policy: SEMANTIC_OUTCOME_POLICY
    });

    expect(decision).toMatchObject({
      accepted: true,
      reason: "accepted-exact",
      outcome: "covered",
      lexicalOverlap: 1
    });
    expect(decision.acceptedMatch?.sentenceId).toBe("sentence_1");
  });

  it("labels accepted low lexical-overlap utterances as paraphrased", () => {
    const decision = decideSemanticUtteranceOutcome({
      slideId: "slide_1",
      transcript: "팀이 같은 일을 반복하느라 시간을 많이 쓰고 있습니다.",
      topMatches: [
        semanticMatch({
          text: "핵심 문제는 팀의 반복 업무가 너무 많다는 점입니다.",
          similarity: 0.938342
        }),
        semanticMatch({ rank: 2, sentenceId: "sentence_2", similarity: 0.898 })
      ],
      policy: SEMANTIC_OUTCOME_POLICY
    });

    expect(decision).toMatchObject({
      accepted: true,
      reason: "accepted-paraphrase",
      outcome: "paraphrased"
    });
    expect(decision.lexicalOverlap).toBeLessThan(0.55);
  });
});

function semanticMatch(
  override: Partial<SemanticUtteranceMatch> = {}
): SemanticUtteranceMatch {
  return {
    rank: override.rank ?? 1,
    sentenceId: override.sentenceId ?? "sentence_1",
    sentenceIndex: override.sentenceIndex ?? 0,
    text: override.text ?? "핵심 문제는 팀의 반복 업무가 너무 많다는 점입니다.",
    similarity: override.similarity ?? 0.95,
    covered: override.covered ?? false
  };
}
