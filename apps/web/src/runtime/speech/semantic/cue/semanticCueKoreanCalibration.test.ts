import { describe, expect, it } from "vitest";
import { shouldRunSemanticCueNli } from "./semanticCueNliPolicy";
import { combineSemanticCueScore } from "./semanticCueScoreCombiner";

describe("semantic cue Korean threshold calibration", () => {
  it("keeps exact Korean keyword coverage out of NLI", () => {
    expect(
      shouldRunSemanticCueNli({
        nliFeatureEnabled: true,
        semanticMatchingEnabled: true,
        isFinal: true,
        phraseMatched: false,
        keywordCoverage: 0.98,
        semanticDecisionReason: "ad-lib",
        cuePriority: 1,
        isRequired: true,
        nowMs: 10_000,
        lastNliRunAtMs: null
      })
    ).toEqual({ run: false, reason: "exact_keyword_match" });
  });

  it("treats Korean paraphrase entailment as auxiliary covered evidence", () => {
    const decision = combineSemanticCueScore({
      lexicalScore: 0.18,
      conceptCoverage: 0.62,
      embeddingScore: 0.71,
      nli: {
        entailmentScore: 0.92,
        neutralScore: 0.06,
        contradictionScore: 0.02
      }
    });

    expect(decision).toMatchObject({
      label: "covered",
      reasonCodes: expect.arrayContaining([
        "nli-entailment",
        "concept-coverage",
        "embedding-support"
      ])
    });
    expect(decision.finalScore).toBeGreaterThanOrEqual(0.75);
  });

  it("lets Korean contradiction block otherwise strong semantic evidence", () => {
    expect(
      combineSemanticCueScore({
        lexicalScore: 0.52,
        conceptCoverage: 0.7,
        embeddingScore: 0.8,
        nli: {
          entailmentScore: 0.08,
          neutralScore: 0.12,
          contradictionScore: 0.8
        }
      })
    ).toMatchObject({
      label: "contradicted",
      reasonCodes: ["nli-contradiction"]
    });
  });
});
