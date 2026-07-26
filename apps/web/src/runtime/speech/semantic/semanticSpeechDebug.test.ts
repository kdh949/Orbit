import { describe, expect, it } from "vitest";

import {
  createSemanticDebugState,
  markSemanticModelReady
} from "./semanticSpeechDebug";

describe("markSemanticModelReady", () => {
  it("모델 로드 완료 후 loading-model 상태를 model-ready로 전환한다", () => {
    expect(
      markSemanticModelReady(
        createSemanticDebugState({
          status: "loading-model",
          slideId: "slide_1",
          transcript: "latest final",
          isFinal: true,
          error: "previous error"
        })
      )
    ).toEqual(
      createSemanticDebugState({
        status: "model-ready",
        slideId: "slide_1",
        transcript: "latest final",
        isFinal: true,
        error: null
      })
    );
  });

  it("이미 indexing 또는 matching 중이면 session 상태를 덮어쓰지 않는다", () => {
    const indexingState = createSemanticDebugState({
      status: "indexing-script",
      slideId: "slide_1"
    });

    expect(markSemanticModelReady(indexingState)).toBe(indexingState);
  });
});
