import { describe, expect, it } from "vitest";

import { createMockSemanticCueNliProvider } from "./mockSemanticCueNliProvider";

describe("createMockSemanticCueNliProvider", () => {
  it("returns deterministic NLI scores for tests", async () => {
    const provider = createMockSemanticCueNliProvider({
      scoresByCueId: {
        scue_1: {
          entailmentScore: 0.9,
          neutralScore: 0.08,
          contradictionScore: 0.02
        }
      }
    });

    await expect(provider.load()).resolves.toMatchObject({
      provider: "mock",
      status: "ready"
    });
    await expect(
      provider.evaluate({
        premise: "세일즈 비용 때문에 CAC가 높았습니다",
        hypotheses: [{ cueId: "scue_1", hypothesis: "CAC가 비용 때문에 높다" }]
      })
    ).resolves.toEqual([
      expect.objectContaining({
        cueId: "scue_1",
        provider: "mock",
        entailmentScore: 0.9
      })
    ]);
  });
});
