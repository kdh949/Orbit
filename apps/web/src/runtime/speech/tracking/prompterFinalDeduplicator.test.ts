import { describe, expect, it } from "vitest";

import type { LiveSttResult } from "../stt/liveSttPort";
import { createPrompterFinalDeduplicator } from "./prompterFinalDeduplicator";

describe("createPrompterFinalDeduplicator", () => {
  it("provider identity가 없으면 timestamp와 무관하게 제한된 window에서 차단한다", () => {
    let nowMs = 1_000;
    const deduplicator = createPrompterFinalDeduplicator({ now: () => nowMs });

    expect(deduplicator.acceptFinal(finalResult(), scope())).toBe(true);
    expect(
      deduplicator.acceptFinal(finalResult({ timestampMs: [2_000, 2_100] }), scope())
    ).toBe(false);

    nowMs = 3_001;
    expect(
      deduplicator.acceptFinal(finalResult({ timestampMs: [3_000, 3_100] }), scope())
    ).toBe(true);
  });

  it("utterance revision 중복과 이미 commit된 utterance의 후속 revision을 차단한다", () => {
    const deduplicator = createPrompterFinalDeduplicator({ now: () => 1_000 });
    const firstRevision = finalResult({
      utteranceId: "utterance_1",
      resultRevision: 1
    });
    const secondRevision = finalResult({
      utteranceId: "utterance_1",
      resultRevision: 2,
      timestampMs: [1_000, 1_100]
    });

    expect(deduplicator.acceptFinal(firstRevision, scope())).toBe(true);
    expect(deduplicator.acceptFinal(firstRevision, scope())).toBe(false);
    expect(deduplicator.acceptFinal(secondRevision, scope())).toBe(true);
    deduplicator.markCommitted(secondRevision, scope({ revision: 1, currentSentenceId: "sentence_2" }));
    expect(
      deduplicator.acceptFinal(
        finalResult({
          utteranceId: "utterance_1",
          resultRevision: 3,
          timestampMs: [2_000, 2_100]
        }),
        scope({ revision: 1, currentSentenceId: "sentence_2" })
      )
    ).toBe(false);
  });

  it("identity 없는 final은 commit 이후 같은 scope에서만 제한된 window 동안 차단한다", () => {
    let nowMs = 1_000;
    const deduplicator = createPrompterFinalDeduplicator({ now: () => nowMs });
    const result = finalResult();
    const committedScope = scope({ revision: 1, currentSentenceId: "sentence_2" });

    expect(deduplicator.acceptFinal(result, scope())).toBe(true);
    deduplicator.markCommitted(result, committedScope);
    nowMs = 1_500;
    expect(deduplicator.acceptFinal(result, committedScope)).toBe(false);
    nowMs = 3_001;

    expect(deduplicator.acceptFinal(result, committedScope)).toBe(true);
  });

  it("manual previous로 revision과 현재 문장이 바뀌면 같은 fallback transcript를 허용한다", () => {
    const deduplicator = createPrompterFinalDeduplicator({ now: () => 1_000 });
    const result = finalResult();

    expect(deduplicator.acceptFinal(result, scope())).toBe(true);
    deduplicator.markCommitted(
      result,
      scope({ revision: 1, currentSentenceId: "sentence_2" })
    );

    expect(
      deduplicator.acceptFinal(
        result,
        scope({ revision: 2, currentSentenceId: "sentence_1" })
      )
    ).toBe(true);
  });

  it("reset하면 이전 세션의 identity와 fingerprint를 폐기한다", () => {
    const deduplicator = createPrompterFinalDeduplicator({ now: () => 1_000 });
    const result = finalResult();

    expect(deduplicator.acceptFinal(result, scope())).toBe(true);
    expect(deduplicator.acceptFinal(result, scope())).toBe(false);
    deduplicator.reset();
    expect(deduplicator.acceptFinal(result, scope())).toBe(true);
  });
});

function scope(
  override: Partial<{
    slideId: string;
    revision: number;
    currentSentenceId: string | null;
  }> = {}
) {
  return {
    slideId: "slide_1",
    revision: 0,
    currentSentenceId: "sentence_1",
    ...override
  };
}

function finalResult(override: Partial<LiveSttResult> = {}): LiveSttResult {
  return {
    text: "첫 문장을 설명합니다",
    isFinal: true,
    timestampMs: [0, 1_000],
    ...override
  };
}
