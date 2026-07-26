import { describe, expect, it } from "vitest";

import { defaultPresenterSettings } from "../settings/presenterSettings";
import type { LiveSttResult } from "../../../runtime/speech/stt/liveSttPort";
import {
  calculateFinalTranscriptWpm,
  createRehearsalTimingSnapshot,
  getDeckTargetSeconds,
  getSlideTargetSeconds,
  type RehearsalTimingDeck,
  type RehearsalTimingSlide,
  getTimingAdviceState,
  getTimingAdviceTransitions
} from "./rehearsalTiming";

describe("rehearsalTiming", () => {
  it("uses deck targetDurationMinutes for the total target", () => {
    expect(getDeckTargetSeconds(createDeck({ targetDurationMinutes: 12 }))).toBe(
      720
    );
  });

  it("uses slide estimatedSeconds before equal deck fallback", () => {
    const deck = createDeck({
      targetDurationMinutes: 9,
      slides: [
        createSlide({ slideId: "slide_1", estimatedSeconds: 45 }),
        createSlide({ slideId: "slide_2" }),
        createSlide({ slideId: "slide_3" })
      ]
    });

    expect(getSlideTargetSeconds(deck, deck.slides[0])).toBe(45);
    expect(getSlideTargetSeconds(deck, deck.slides[1])).toBe(180);
  });

  it("creates a timing snapshot with remaining time and slide overtime", () => {
    const deck = createDeck({
      targetDurationMinutes: 1,
      slides: [createSlide({ estimatedSeconds: 20 })]
    });

    expect(
      createRehearsalTimingSnapshot({
        deck,
        currentSlide: deck.slides[0],
        startedAtMs: 10_000,
        slideEnteredAtMs: 20_000,
        nowMs: 45_000
      })
    ).toEqual({
      deckTargetSeconds: 60,
      elapsedSeconds: 35,
      remainingSeconds: 25,
      currentSlideElapsedSeconds: 25,
      currentSlideTargetSeconds: 20,
      currentSlideOvertime: true
    });
  });

  it("computes whitespace-based WPM from final transcript segments only", () => {
    const segments: LiveSttResult[] = [
      {
        text: "부분 전사는 무시",
        isFinal: false,
        timestampMs: [1_000, 2_000]
      },
      {
        text: "오르빗 발표 흐름",
        isFinal: true,
        timestampMs: [5_000, 10_000]
      },
      {
        text: "경계 전사 포함",
        isFinal: true,
        timestampMs: [15_000, 20_000]
      },
      {
        text: "최종 전사만 계산",
        isFinal: true,
        timestampMs: [35_000, 40_000]
      }
    ];

    expect(
      calculateFinalTranscriptWpm({
        segments,
        nowMs: 40_000,
        startedAtMs: 20_000,
        windowMs: 30_000
      })
    ).toBe(18);
  });

  it("uses elapsed time instead of a fixed 30 seconds during warmup", () => {
    expect(
      calculateFinalTranscriptWpm({
        segments: [
          {
            text: "하나 둘 셋 넷",
            isFinal: true,
            timestampMs: [1_000, 5_000]
          }
        ],
        nowMs: 10_000,
        startedAtMs: 0,
        windowMs: 30_000
      })
    ).toBe(24);
  });

  it("compares STT segment timestamps against elapsed session time", () => {
    expect(
      calculateFinalTranscriptWpm({
        segments: [
          {
            text: "하나 둘 셋 넷 다섯 여섯",
            isFinal: true,
            timestampMs: [1_000, 6_000]
          }
        ],
        nowMs: 1_700_000_020_000,
        startedAtMs: 1_700_000_000_000,
        windowMs: 30_000
      })
    ).toBe(18);
  });

  it("maps WPM and overtime to advice state", () => {
    expect(
      getTimingAdviceState({
        wordsPerMinute: 140,
        currentSlideOvertime: true,
        paceAdvice: defaultPresenterSettings.paceAdvice
      })
    ).toEqual({
      pace: "too-fast",
      slideOvertime: true
    });

    expect(
      getTimingAdviceState({
        wordsPerMinute: 80,
        currentSlideOvertime: false,
        paceAdvice: defaultPresenterSettings.paceAdvice
      }).pace
    ).toBe("too-slow");
  });

  it("emits advice transitions only when entering an active state", () => {
    const normal = { pace: "normal", slideOvertime: false } as const;
    const overtime = { pace: "normal", slideOvertime: true } as const;
    const fast = { pace: "too-fast", slideOvertime: true } as const;

    expect(getTimingAdviceTransitions(normal, overtime)).toEqual([
      "slide-overtime"
    ]);
    expect(getTimingAdviceTransitions(overtime, overtime)).toEqual([]);
    expect(getTimingAdviceTransitions(overtime, fast)).toEqual(["pace-too-fast"]);
    expect(getTimingAdviceTransitions(fast, normal)).toEqual([]);
  });
});

function createDeck(overrides: Partial<RehearsalTimingDeck> = {}): RehearsalTimingDeck {
  return {
    targetDurationMinutes: 10,
    slides: [createSlide()],
    ...overrides
  };
}

function createSlide(
  overrides: Partial<RehearsalTimingSlide> & { slideId?: string } = {}
): RehearsalTimingSlide {
  return {
    ...("estimatedSeconds" in overrides
      ? { estimatedSeconds: overrides.estimatedSeconds }
      : {})
  };
}
