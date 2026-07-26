import {
  defaultAutoAdvancePolicy,
  type AutoAdvancePolicy
} from "../autoAdvanceConfig";
import type { AdvanceControllerSnapshot } from "../advanceController";

export const p4AutoAdvanceFixture = Object.freeze({
  slides: [
    {
      finalSentence: "오늘 설명은 여기서 마치겠습니다",
      remainingTriggerSteps: 0,
      slideId: "p4-slide-ready",
      speakerNotes:
        "첫 번째 근거를 설명합니다. 핵심 수치를 비교합니다. 오늘 설명은 여기서 마치겠습니다."
    },
    {
      finalSentence: "다음 장으로 넘어가겠습니다",
      remainingTriggerSteps: 2,
      slideId: "p4-slide-with-builds",
      speakerNotes:
        "제품 흐름을 단계별로 보여줍니다. 두 개의 빌드가 남아 있습니다. 다음 장으로 넘어가겠습니다."
    },
    {
      finalSentence: "발표를 마치겠습니다",
      remainingTriggerSteps: 0,
      slideId: "p4-slide-final",
      speakerNotes:
        "마지막으로 실행 계획을 요약합니다. 질문을 받기 전에 발표를 마치겠습니다."
    }
  ],
  transcriptActivities: [
    { isFinal: false, text: "첫 번째 근거를" },
    { isFinal: true, text: "오늘 설명은 여기서 마치겠습니다" }
  ]
});

export function createP4FixtureSnapshot(options: {
  effectiveCoverage?: number;
  finalSentenceCommitted?: boolean;
  finalSentenceCommittedAtMs?: number | null;
  finalSentenceSpoken?: boolean;
  finalSentenceSpokenAtMs?: number | null;
  isLastSlide?: boolean;
  nowMs?: number;
  pause?: AdvanceControllerSnapshot["pause"];
  policy?: AutoAdvancePolicy;
  slideIndex?: number;
} = {}): AdvanceControllerSnapshot {
  const slide = p4AutoAdvanceFixture.slides[options.slideIndex ?? 0]!;

  return {
    effectiveCoverage: options.effectiveCoverage ?? 0,
    finalSentenceCommitted: options.finalSentenceCommitted ?? false,
    finalSentenceCommittedAtMs: options.finalSentenceCommittedAtMs ?? null,
    finalSentenceSpoken: options.finalSentenceSpoken ?? false,
    finalSentenceSpokenAtMs: options.finalSentenceSpokenAtMs ?? null,
    isLastSlide: options.isLastSlide ?? false,
    mode: "rehearsal",
    nowMs: options.nowMs ?? 1000,
    pause: options.pause ?? {
      isPaused: false,
      silenceDurationMs: 0
    },
    policy: options.policy ?? defaultAutoAdvancePolicy,
    remainingTriggerSteps: slide.remainingTriggerSteps,
    slideId: slide.slideId
  };
}
