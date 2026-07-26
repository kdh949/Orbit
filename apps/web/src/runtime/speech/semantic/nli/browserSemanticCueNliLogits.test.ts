import { describe, expect, it } from "vitest";

import {
  mapPairwiseNliLogits,
  resolvePairwiseNliLabelMapping,
} from "./browserSemanticCueNliLogits";

describe("pairwise NLI label mapping", () => {
  it("모델 config 순서의 실제 entailment/neutral/contradiction logits를 확률로 변환한다", () => {
    const mapping = resolvePairwiseNliLabelMapping({
      0: "entailment",
      1: "neutral",
      2: "contradiction",
    });

    const scores = mapPairwiseNliLogits([3, 1, -1], mapping);

    expect(mapping).toEqual({ entailment: 0, neutral: 1, contradiction: 2 });
    expect(scores.entailmentScore).toBeCloseTo(0.8668, 4);
    expect(scores.neutralScore).toBeCloseTo(0.1173, 4);
    expect(scores.contradictionScore).toBeCloseTo(0.0159, 4);
    expect(
      scores.entailmentScore + scores.neutralScore + scores.contradictionScore,
    ).toBeCloseTo(1, 8);
  });

  it("label 대소문자와 index 순서가 달라도 config를 기준으로 매핑한다", () => {
    const mapping = resolvePairwiseNliLabelMapping({
      0: "CONTRADICTION",
      1: "Entailment",
      2: "NEUTRAL",
    });

    expect(mapPairwiseNliLogits([-2, 4, 0], mapping)).toMatchObject({
      entailmentScore: expect.any(Number),
      neutralScore: expect.any(Number),
      contradictionScore: expect.any(Number),
    });
    expect(mapping).toEqual({ entailment: 1, neutral: 2, contradiction: 0 });
  });

  it("3-way label이 완전하지 않거나 logits가 유효하지 않으면 실패한다", () => {
    expect(() =>
      resolvePairwiseNliLabelMapping({ 0: "entailment", 1: "contradiction" }),
    ).toThrow("entailment, neutral, and contradiction");
    expect(() =>
      mapPairwiseNliLogits([1, Number.NaN, 0], {
        entailment: 0,
        neutral: 1,
        contradiction: 2,
      }),
    ).toThrow("finite");
  });
});
