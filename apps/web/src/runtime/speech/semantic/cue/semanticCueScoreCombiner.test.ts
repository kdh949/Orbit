import { describe, expect, it } from "vitest";

import { combineSemanticCueScore } from "./semanticCueScoreCombiner";

describe("combineSemanticCueScore", () => {
  it("uses entailment as auxiliary evidence for covered cues", () => {
    const decision = combineSemanticCueScore({
      lexicalScore: 0.2,
      conceptCoverage: 0.66,
      embeddingScore: 0.72,
      nli: {
        entailmentScore: 0.94,
        neutralScore: 0.05,
        contradictionScore: 0.01
      }
    });

    expect(decision).toMatchObject({
      label: "covered",
      finalScore: expect.any(Number),
      reasonCodes: expect.arrayContaining(["nli-entailment"])
    });
    expect(decision.finalScore).toBeGreaterThanOrEqual(0.75);
  });

  it("lets contradiction override high retrieval scores", () => {
    expect(
      combineSemanticCueScore({
        lexicalScore: 0.6,
        conceptCoverage: 0.8,
        embeddingScore: 0.86,
        nli: {
          entailmentScore: 0.1,
          neutralScore: 0.1,
          contradictionScore: 0.8
        }
      })
    ).toMatchObject({
      label: "contradicted",
      reasonCodes: expect.arrayContaining(["nli-contradiction"])
    });
  });
});
