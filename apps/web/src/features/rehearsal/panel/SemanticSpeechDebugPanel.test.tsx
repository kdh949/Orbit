import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  SemanticSpeechDebugPanel,
  semanticSpeechDebugPanelStorageKey,
  shouldShowSemanticSpeechDebugPanel
} from "./SemanticSpeechDebugPanel";
import { createSemanticDebugState } from "../speech/semanticSpeechDebug";

describe("SemanticSpeechDebugPanel", () => {
  it("latest final transcript와 decision 적용 상태를 표시한다", () => {
    const html = renderToStaticMarkup(
      <SemanticSpeechDebugPanel
        liveTranscript="첫 문장 두 번째 문장 현재 말하는 중"
        semanticMatchingEnabled
        state={createSemanticDebugState({
          status: "ready",
          slideId: "slide_1",
          transcript: "방금 final STT 문장",
          isFinal: true,
          topMatches: [
            match({ rank: 1, similarity: 0.842, sentenceIndex: 2 }),
            match({ rank: 2, similarity: 0.731, sentenceIndex: 0 }),
            match({ rank: 3, similarity: 0.61, sentenceIndex: 1, covered: true })
          ],
          decision: {
            accepted: true,
            acceptedMatch: match({ rank: 1, similarity: 0.842, sentenceIndex: 2 }),
            ambiguousMargin: 0.04,
            isFinal: true,
            lexicalOverlap: 0.18,
            outcome: "paraphrased",
            reason: "accepted-paraphrase",
            scoreThreshold: 0.89,
            slideId: "slide_1",
            topMatches: [],
            transcript: "방금 final STT 문장"
          }
        })}
      />
    );

    expect(html).toContain("Semantic STT");
    expect(html).toContain("실시간 전체 인식");
    expect(html).toContain("첫 문장 두 번째 문장 현재 말하는 중");
    expect(html).toContain("방금 인식");
    expect(html).toContain("방금 final STT 문장");
    expect(html).toContain("#1 · 0.842 · 문장 3");
    expect(html).toContain("#2 · 0.731 · 문장 1");
    expect(html).toContain("#3 · 0.610 · 문장 2");
    expect(html).toContain("paraphrased");
    expect(html).toContain("accepted-paraphrase");
    expect(html).toContain("threshold 0.890");
    expect(html).toContain("margin 0.040");
    expect(html).toContain("적용");
    expect(html).toContain("참고");
    expect(html).toContain("covered");
  });

  it("low-score top 1 후보를 decision 없이 적용으로 표시하지 않는다", () => {
    const html = renderToStaticMarkup(
      <SemanticSpeechDebugPanel
        semanticMatchingEnabled
        state={createSemanticDebugState({
          status: "ready",
          slideId: "slide_1",
          transcript: "대본과 무관한 애드리브",
          isFinal: true,
          topMatches: [match({ rank: 1, similarity: 0.64 })],
          decision: {
            accepted: false,
            acceptedMatch: null,
            ambiguousMargin: 0.04,
            isFinal: true,
            lexicalOverlap: 0,
            outcome: "ad-lib",
            reason: "ad-lib",
            scoreThreshold: 0.89,
            slideId: "slide_1",
            topMatches: [],
            transcript: "대본과 무관한 애드리브"
          }
        })}
      />
    );

    expect(html).toContain("ad-lib");
    expect(html).toContain("rejected");
    expect(html).not.toContain("적용");
  });

  it("transcript가 없으면 empty copy를 표시하고 error를 노출한다", () => {
    const html = renderToStaticMarkup(
      <SemanticSpeechDebugPanel
        semanticMatchingEnabled={false}
        state={createSemanticDebugState({
          status: "error",
          error: "model load failed"
        })}
      />
    );

    expect(html).toContain("아직 final STT 문장이 없습니다.");
    expect(html).toContain("model load failed");
  });
});

describe("shouldShowSemanticSpeechDebugPanel", () => {
  it("환경과 무관하게 명시적인 localStorage 설정이 있을 때만 표시한다", () => {
    expect(
      shouldShowSemanticSpeechDebugPanel({
        isDevelopment: true,
        storage: null
      })
    ).toBe(false);
    expect(
      shouldShowSemanticSpeechDebugPanel({
        isDevelopment: false,
        storage: createStorage(null)
      })
    ).toBe(false);
    expect(
      shouldShowSemanticSpeechDebugPanel({
        isDevelopment: false,
        storage: createStorage("1")
      })
    ).toBe(true);
  });

  it("blocked localStorage는 production에서 숨김으로 처리한다", () => {
    expect(
      shouldShowSemanticSpeechDebugPanel({
        isDevelopment: false,
        storage: {
          getItem: vi.fn(() => {
            throw new DOMException("blocked", "SecurityError");
          })
        }
      })
    ).toBe(false);
  });
});

function match(
  override: Partial<{
    rank: number;
    sentenceId: string;
    sentenceIndex: number;
    text: string;
    similarity: number;
    covered: boolean;
  }>
) {
  return {
    rank: 1,
    sentenceId: "sentence_1",
    sentenceIndex: 0,
    text: "후보 문장",
    similarity: 0.8,
    covered: false,
    ...override
  };
}

function createStorage(value: string | null): Pick<Storage, "getItem"> {
  return {
    getItem: (key) =>
      key === semanticSpeechDebugPanelStorageKey ? value : null
  };
}
