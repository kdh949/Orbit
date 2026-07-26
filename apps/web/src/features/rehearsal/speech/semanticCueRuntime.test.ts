import {
  rehearsalSemanticCueDecisionSchema,
  type SemanticCue
} from "@orbit/shared";
import { describe, expect, it, vi } from "vitest";

import { createSemanticCueRuntime } from "./semanticCueRuntime";
import {
  SemanticCueNliProviderError,
  type SemanticCueNliProvider
} from "../../../runtime/speech/semantic/nli/semanticCueNliProvider";

describe("semanticCueRuntime fallback", () => {
  it("semantic matching toggle이 꺼지면 기존 발표 추적에 decision을 추가하지 않는다", async () => {
    const evaluate = vi.fn(async () => []);
    const runtime = createSemanticCueRuntime({
      enabled: true,
      provider: {
        load: vi.fn(async () => ({ provider: "mock" as const, status: "ready" as const })),
        evaluate
      }
    });
    const result = await runtime.evaluateFinalResult(
      runtimeInput({
        semanticMatchingEnabled: false,
        transcript: "CAC는 초기 영업 비용입니다",
        cues: [
          cue({
            candidateKeywords: ["CAC"],
            requiredConcepts: ["초기 영업 비용"]
          })
        ]
      })
    );

    expect(result.decisions).toEqual([]);
    expect(evaluate).not.toHaveBeenCalled();
    expect(result.capabilityUpdates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capability: "nli",
          toState: "unavailable",
          reason: "user_disabled"
        })
      ])
    );
  });

  it("provider가 없어도 exact와 alias 근거를 동일 decision schema의 basic 판정으로 만든다", async () => {
    const runtime = createSemanticCueRuntime({ enabled: false });
    const result = await runtime.evaluateFinalResult(
      runtimeInput({
        transcript: "CAC는 고객 한 명을 얻는 데 드는 초기 영업 비용입니다.",
        cues: [
          cue({
            cueId: "scue_exact",
            meaning: "CAC는 초기 영업 비용입니다",
            candidateKeywords: ["CAC"],
            requiredConcepts: ["초기 영업 비용"]
          }),
          cue({
            cueId: "scue_alias",
            meaning: "고객 획득 비용을 설명합니다",
            aliases: { "고객 획득 비용": ["CAC"] },
            requiredConcepts: ["고객 획득 비용"]
          })
        ]
      })
    );

    expect(result.decisions.map((decision) => decision.cueId)).toEqual([
      "scue_exact",
      "scue_alias"
    ]);
    for (const decision of result.decisions) {
      expect(rehearsalSemanticCueDecisionSchema.safeParse(decision).success).toBe(true);
      expect(decision).toMatchObject({
        label: "covered",
        measurementMode: "basic",
        fallbackUsed: true,
        fallbackReason: "user_disabled"
      });
    }
  });

  it("E5 점수만으로는 basic covered를 만들지 않고 provider 부재를 명시한다", async () => {
    const runtime = createSemanticCueRuntime({
      enabled: true,
      embeddingIndex: embeddingIndex(new Map([["scue_1", 0.99]]))
    });
    const result = await runtime.evaluateFinalResult(runtimeInput());

    expect(result.decisions).toEqual([]);
    expect(result.capabilityUpdates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capability: "nli",
          toState: "unavailable",
          reason: "provider_unavailable",
          measurementMode: "none"
        })
      ])
    );
    expect(result.debugEvent.actionGate?.blockedReasons).toContain(
      "semantic-fallback-manual-only"
    );
  });

  it("NLI timeout을 basic fallback과 구분하고 ambiguous cue를 판정하지 않는다", async () => {
    const provider: SemanticCueNliProvider = {
      load: vi.fn(async () => ({ provider: "mock" as const, status: "ready" as const })),
      evaluate: vi.fn(async () => await new Promise<never>(() => undefined))
    };
    const runtime = createSemanticCueRuntime({
      enabled: true,
      provider,
      nliTimeoutMs: 5,
      embeddingIndex: embeddingIndex(new Map([["scue_1", 0.9]]))
    });
    const result = await runtime.evaluateFinalResult(runtimeInput());

    expect(result.decisions).toEqual([]);
    expect(result.capabilityUpdates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capability: "nli",
          toState: "degraded",
          reason: "timeout",
          measurementMode: "basic"
        })
      ])
    );
    expect(result.debugEvent.fallback).toMatchObject({
      used: true,
      reason: "timeout",
      measurementMode: "basic"
    });
  });

  it("provider가 abort에 즉시 반응해도 runtime timeout reason을 유지한다", async () => {
    const provider: SemanticCueNliProvider = {
      load: vi.fn(async () => ({ provider: "mock" as const, status: "ready" as const })),
      evaluate: vi.fn(
        async ({ signal }) =>
          await new Promise<never>((_resolve, reject) => {
            signal?.addEventListener(
              "abort",
              () => reject(new DOMException("aborted", "AbortError")),
              { once: true }
            );
          })
      )
    };
    const runtime = createSemanticCueRuntime({
      enabled: true,
      provider,
      nliTimeoutMs: 5,
      embeddingIndex: embeddingIndex(new Map([["scue_1", 0.9]]))
    });

    const result = await runtime.evaluateFinalResult(runtimeInput());

    expect(result.debugEvent.fallback?.reason).toBe("timeout");
  });

  it("NLI 입력은 ambiguous top 2 cue와 cue당 최대 2개 hypothesis로 제한한다", async () => {
    const evaluate = vi.fn(async (input: Parameters<SemanticCueNliProvider["evaluate"]>[0]) =>
      input.hypotheses.map((hypothesis) => ({
        ...hypothesis,
        entailmentScore: 0.9,
        neutralScore: 0.08,
        contradictionScore: 0.02,
        provider: "mock" as const
      }))
    );
    const provider: SemanticCueNliProvider = {
      load: vi.fn(async () => ({ provider: "mock" as const, status: "ready" as const })),
      evaluate
    };
    const cues = ["a", "b", "c"].map((suffix) =>
      cue({
        cueId: `scue_${suffix}`,
        nliHypotheses: ["가설 1", "가설 2", "가설 3"]
      })
    );
    const runtime = createSemanticCueRuntime({
      enabled: true,
      provider,
      embeddingIndex: embeddingIndex(
        new Map([
          ["scue_a", 0.9],
          ["scue_b", 0.8],
          ["scue_c", 0.7]
        ])
      )
    });
    await runtime.evaluateFinalResult(
      runtimeInput({ transcript: Array.from({ length: 140 }, (_, i) => `단어${i}`).join(" "), cues })
    );

    const call = evaluate.mock.calls[0]?.[0];
    expect(new Set(call?.hypotheses.map((item) => item.cueId)).size).toBe(2);
    expect(call?.hypotheses).toHaveLength(4);
    expect(call?.premise.split(/\s+/)).toHaveLength(96);
  });

  it("empty result와 runtime error를 서로 다른 capability reason으로 남긴다", async () => {
    const emptyRuntime = createSemanticCueRuntime({
      enabled: true,
      provider: {
        load: vi.fn(async () => ({ provider: "mock" as const, status: "ready" as const })),
        evaluate: vi.fn(async () => [])
      },
      embeddingIndex: embeddingIndex(new Map([["scue_1", 0.9]]))
    });
    const errorRuntime = createSemanticCueRuntime({
      enabled: true,
      provider: {
        load: vi.fn(async () => ({ provider: "mock" as const, status: "ready" as const })),
        evaluate: vi.fn(async () => {
          throw new Error("provider failed");
        })
      },
      embeddingIndex: embeddingIndex(new Map([["scue_1", 0.9]]))
    });

    const empty = await emptyRuntime.evaluateFinalResult(runtimeInput());
    const error = await errorRuntime.evaluateFinalResult(runtimeInput());

    expect(empty.capabilityUpdates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: "provider_unavailable" })
      ])
    );
    expect(error.capabilityUpdates).toEqual(
      expect.arrayContaining([expect.objectContaining({ reason: "runtime_error" })])
    );
  });

  it("hard-negative 문장이 발화에 부합하면 positive hypothesis가 높아도 covered로 판정하지 않는다", async () => {
    const evaluate = vi.fn(
      async (input: Parameters<SemanticCueNliProvider["evaluate"]>[0]) =>
        input.hypotheses.map((hypothesis) => ({
          ...hypothesis,
          entailmentScore: hypothesis.hypothesis.includes("실제 CALL")
            ? 0.93
            : 0.91,
          neutralScore: 0.05,
          contradictionScore: 0.04,
          provider: "mock" as const
        }))
    );
    const runtime = createSemanticCueRuntime({
      enabled: true,
      provider: {
        load: vi.fn(async () => ({ provider: "mock" as const, status: "ready" as const })),
        evaluate
      },
      embeddingIndex: embeddingIndex(new Map([["scue_1", 0.9]]))
    });

    const result = await runtime.evaluateFinalResult(
      runtimeInput({
        cues: [
          cue({
            candidateKeywords: ["Fake Return Address"],
            requiredConcepts: ["Fake Return Address"],
            nliHypotheses: [
              "발표자는 가짜 복귀 주소가 스택 프레임 규격을 유지한다고 설명했다"
            ],
            negativeHints: [
              "발표자는 가짜 복귀 주소가 실제 CALL 명령이 저장한 주소라고 설명했다"
            ]
          })
        ]
      })
    );

    expect(evaluate.mock.calls[0]?.[0].hypotheses).toHaveLength(2);
    expect(result.decisions).toEqual([
      expect.objectContaining({
        cueId: "scue_1",
        label: "contradicted",
        reasonCodes: ["nli-contradiction"]
      })
    ]);
  });

  it("관계가 뒤집힌 발화는 핵심 용어를 모두 포함해도 basic covered로 단정하지 않고 NLI로 검증한다", async () => {
    const evaluate = vi.fn(
      async (input: Parameters<SemanticCueNliProvider["evaluate"]>[0]) =>
        input.hypotheses.map((hypothesis) => ({
          ...hypothesis,
          entailmentScore: hypothesis.cueId.includes("::negative::") ? 0.94 : 0.08,
          neutralScore: 0.04,
          contradictionScore: hypothesis.cueId.includes("::negative::") ? 0.02 : 0.88,
          provider: "mock" as const
        }))
    );
    const runtime = createSemanticCueRuntime({
      enabled: true,
      provider: {
        load: vi.fn(async () => ({ provider: "mock" as const, status: "ready" as const })),
        evaluate
      },
      embeddingIndex: embeddingIndex(new Map([["scue_1", 0.94]]))
    });

    const result = await runtime.evaluateFinalResult(
      runtimeInput({
        transcript:
          "데이터 복사 순서는 데이터를 먼저 복사한 다음 rsp 감소로 메모리 공간 확보를 하는 것입니다.",
        cues: [
          cue({
            meaning:
              "스택에 데이터를 넣을 때 먼저 rsp 값을 감소시켜 공간을 확보한 후 데이터를 복사한다",
            candidateKeywords: ["rsp 감소", "데이터 복사 순서"],
            requiredConcepts: ["rsp 감소", "메모리 공간 확보", "데이터 복사 순서"],
            nliHypotheses: [
              "발표자는 먼저 rsp를 감소시켜 공간을 확보한 후 데이터를 복사한다고 설명한다"
            ],
            negativeHints: [
              "발표자는 데이터를 먼저 복사한 다음 rsp를 감소시킨다고 설명한다"
            ]
          })
        ]
      })
    );

    expect(evaluate).toHaveBeenCalledOnce();
    expect(result.decisions).toEqual([
      expect.objectContaining({
        cueId: "scue_1",
        label: "contradicted",
        measurementMode: "full",
        reasonCodes: ["nli-contradiction"]
      })
    ]);
  });

  it("큐 고유 개념과 겹치지 않는 약한 negative hint는 NLI contradiction 근거로 보내지 않는다", async () => {
    const evaluate = vi.fn(
      async (input: Parameters<SemanticCueNliProvider["evaluate"]>[0]) =>
        input.hypotheses.map((hypothesis) => ({
          ...hypothesis,
          entailmentScore: 0.92,
          neutralScore: 0.06,
          contradictionScore: 0.02,
          provider: "mock" as const
        }))
    );
    const runtime = createSemanticCueRuntime({
      enabled: true,
      provider: {
        load: vi.fn(async () => ({ provider: "mock" as const, status: "ready" as const })),
        evaluate
      },
      embeddingIndex: embeddingIndex(new Map([["scue_1", 0.9]]))
    });

    const result = await runtime.evaluateFinalResult(
      runtimeInput({
        transcript:
          "User Programs 과제를 수행하며 겪은 고민과 트러블슈팅 과정을 공유합니다.",
        cues: [
          cue({
            meaning:
              "팀이 User Programs 과제를 진행하며 겪은 고민과 트러블슈팅 과정을 공유한다",
            candidateKeywords: ["User Programs 과제", "트러블슈팅 과정"],
            requiredConcepts: ["User Programs 과제", "트러블슈팅 과정"],
            nliHypotheses: [
              "발표자는 User Programs 과제의 고민과 트러블슈팅 과정을 공유한다"
            ],
            negativeHints: ["발표자는 다른 주제나 과제에 대해 이야기한다"]
          })
        ]
      })
    );

    expect(evaluate).not.toHaveBeenCalled();
    expect(result.decisions).toEqual([
      expect.objectContaining({
        cueId: "scue_1",
        label: "covered",
        measurementMode: "basic"
      })
    ]);
  });

  it("shadow NLI 결과는 debug에만 남기고 cue decision이나 action 근거로 사용하지 않는다", async () => {
    const provider: SemanticCueNliProvider = {
      load: vi.fn(async () => ({ provider: "mock" as const, status: "ready" as const })),
      evaluate: vi.fn(
        async (input: Parameters<SemanticCueNliProvider["evaluate"]>[0]) =>
          input.hypotheses.map((hypothesis) => ({
            ...hypothesis,
            entailmentScore: 0.98,
            neutralScore: 0.01,
            contradictionScore: 0.01,
            provider: "mock" as const,
            latencyMs: 40
          }))
      )
    };
    const runtime = createSemanticCueRuntime({
      enabled: true,
      nliMode: "shadow",
      provider,
      embeddingIndex: embeddingIndex(new Map([["scue_1", 0.9]]))
    });

    const result = await runtime.evaluateFinalResult(runtimeInput());

    expect(result.decisions).toEqual([]);
    expect(result.debugEvent.nli?.hypotheses[0]).toMatchObject({
      entailmentScore: 0.98
    });
    expect(result.debugEvent.decision.reasonCodes).toContain("nli-shadow-only");
    expect(result.debugEvent.actionGate).toMatchObject({
      allowed: false,
      blockedReasons: expect.arrayContaining(["nli-cannot-advance-slide-alone"])
    });
    expect(result.capabilityUpdates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capability: "semantic_runtime",
          measurementMode: "none"
        })
      ])
    );
  });

  it("provider의 model_not_ready reason을 visible capability fallback으로 유지한다", async () => {
    const runtime = createSemanticCueRuntime({
      enabled: true,
      provider: {
        load: vi.fn(async () => ({ provider: "mock" as const, status: "ready" as const })),
        evaluate: vi.fn(async () => {
          throw new SemanticCueNliProviderError(
            "model_not_ready",
            "Semantic cue NLI model is not prewarmed."
          );
        })
      },
      embeddingIndex: embeddingIndex(new Map([["scue_1", 0.9]]))
    });

    const result = await runtime.evaluateFinalResult(runtimeInput());

    expect(result.capabilityUpdates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capability: "nli",
          toState: "unavailable",
          reason: "model_not_ready"
        })
      ])
    );
    expect(result.debugEvent.fallback?.reason).toBe("model_not_ready");
  });
});

function runtimeInput(overrides: Record<string, unknown> = {}) {
  return {
    deckId: "deck_1",
    slideId: "slide_1",
    transcript: "서로 다른 표현으로 정책의 취지를 설명합니다",
    isFinal: true,
    cues: [cue()],
    coveredCueIds: new Set<string>(),
    phraseMatched: false,
    keywordCoverage: 0,
    semanticDecisionReason: "no_match" as const,
    semanticMatchingEnabled: true,
    generation: 1,
    nowMs: 10_000,
    ...overrides
  };
}

function cue(overrides: Partial<SemanticCue> = {}): SemanticCue {
  return {
    cueId: "scue_1",
    slideId: "slide_1",
    meaning: "정책의 핵심 취지를 설명합니다",
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
    requiredConcepts: [],
    nliHypotheses: ["발표자는 정책의 핵심 취지를 설명했다"],
    negativeHints: [],
    targetElementIds: [],
    triggerActionIds: [],
    ...overrides
  };
}

function embeddingIndex(scores: ReadonlyMap<string, number>) {
  return {
    prepareSlide: vi.fn(async (input: { slideId: string; cues: readonly SemanticCue[] }) => ({
      slideId: input.slideId,
      signature: "test",
      cueCount: input.cues.length,
      vectorCount: input.cues.length
    })),
    retrieveScores: vi.fn(async () => scores)
  };
}
