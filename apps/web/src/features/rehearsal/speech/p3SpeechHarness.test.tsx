import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { RehearsalPanel } from "../panel/RehearsalPanel";
import type { RehearsalTimingSnapshot, TimingAdviceState } from "../panel/rehearsalTiming";
import type { LiveSttPort, LiveSttResult } from "../stt/liveSttPort";
import {
  p3AsrLikeFinalTranscript,
  p3CleanFinalTranscript,
  p3FalsePositiveTranscript,
  p3SpeechFixtureSlides
} from "./__fixtures__/p3SpeechFixture";
import {
  buildBiasPhrasesForSlide,
  createP3RehearsalSession
} from "./p3RehearsalSession";
import { createSpeechTracker } from "./speechTracker";

describe("P3 speech fixture harness", () => {
  it("drives sentence and keyword state from deterministic final transcripts", async () => {
    const port = createMockLiveSttPort();
    const session = createP3RehearsalSession({
      slides: p3SpeechFixtureSlides,
      port,
      now: () => 1_000
    });

    await session.start({
      audioSource: {} as MediaStream,
      slideIndex: 0
    });
    port.emit({
      text: p3CleanFinalTranscript,
      isFinal: true,
      timestampMs: [1_000, 3_000]
    });

    expect(session.getState().snapshot).toMatchObject({
      slideId: "slide_p3_intro",
      finalSentenceSpoken: true,
      hitKeywordIds: ["kw_gen_ai", "kw_privacy", "kw_orbit_ai"]
    });
    expect(session.getState().snapshot?.effectiveCoverage).toBeGreaterThanOrEqual(
      0.6
    );
  });

  it("keeps the current prompter sentence for partial and advances it after final", async () => {
    const port = createMockLiveSttPort();
    const session = createP3RehearsalSession({
      slides: [
        {
          slideId: "slide_prompter",
          speakerNotes:
            "업무 중 반복 작업은 생산성을 낮춥니다. AI 도구는 반복 업무를 자동화합니다.",
          keywords: []
        }
      ],
      port,
      now: () => 1_000
    });

    await session.start({
      audioSource: {} as MediaStream,
      slideIndex: 0
    });
    port.emit({
      text: "업무 중 반복 작업은 생산성을 낮춥니다",
      isFinal: false,
      timestampMs: [0, 800]
    });
    expect(session.getState().snapshot?.prompterProgress).toMatchObject({
      currentSentenceId: "sentence_1",
      committedSentenceIds: []
    });

    port.emit({
      text: "업무 중 반복 작업은 생산성을 낮춥니다",
      isFinal: true,
      timestampMs: [800, 1_200]
    });
    expect(session.getState().snapshot?.prompterProgress).toMatchObject({
      currentSentenceId: "sentence_2",
      committedSentenceIds: ["sentence_1"]
    });
    expect(session.getState().snapshot?.scriptProgress?.ratio).toBeGreaterThan(
      0
    );
  });

  it("keeps common phrases and command-like false positives from completing coverage", () => {
    const tracker = createSpeechTracker({
      slideId: p3SpeechFixtureSlides[0].slideId,
      speakerNotes: p3SpeechFixtureSlides[0].speakerNotes,
      keywords: p3SpeechFixtureSlides[0].keywords,
      config: {
        commonPhraseBlacklist: ["감사합니다", "안녕하세요"]
      }
    });

    tracker.acceptResult({
      text: p3FalsePositiveTranscript,
      isFinal: true,
      timestampMs: [1_000, 2_000]
    });

    expect(tracker.snapshot()).toMatchObject({
      sentenceCoverage: 0,
      finalSentenceSpoken: false,
      hitKeywordIds: []
    });
  });

  it("keeps ASR-like synonym and abbreviation hits without fuzzy keyword matching", () => {
    const tracker = createSpeechTracker({
      slideId: p3SpeechFixtureSlides[0].slideId,
      speakerNotes: p3SpeechFixtureSlides[0].speakerNotes,
      keywords: p3SpeechFixtureSlides[0].keywords
    });

    tracker.acceptResult({
      text: p3AsrLikeFinalTranscript,
      isFinal: true,
      timestampMs: [1_000, 2_000]
    });

    expect(tracker.snapshot().hitKeywordIds).toEqual([
      "kw_privacy",
      "kw_orbit_ai"
    ]);
  });

  it("keeps control, cue, keyword, and final trigger phrases ahead of legacy phrases under budget", () => {
    const phrases = buildBiasPhrasesForSlide(p3SpeechFixtureSlides[0], {
      biasPhraseBudget: 9
    });

    expect(phrases).toContainEqual(
      expect.objectContaining({
        text: "다음 슬라이드",
        weight: 1,
        source: "control-phrase"
      })
    );
    expect(phrases).toContainEqual(
      expect.objectContaining({
        text: "이전 슬라이드",
        source: "control-phrase"
      })
    );
    expect(phrases).toContainEqual(
      expect.objectContaining({
        text: "검토 로그",
        source: "cue-trigger"
      })
    );
    expect(phrases).toContainEqual(
      expect.objectContaining({
        text: "생성형 AI",
        weight: 0.94,
        source: "keyword"
      })
    );
    expect(phrases.map((phrase) => phrase.text)).not.toContain("레거시 제목");
    expect(phrases.map((phrase) => phrase.text)).not.toContain("감사합니다");
  });

  it("renders the default panel without fixture transcript text and hides advice in live mode", () => {
    const html = renderToStaticMarkup(
      <RehearsalPanel
        mode="live"
        timing={timing}
        wordsPerMinute={118}
        adviceState={adviceState}
        keywords={p3SpeechFixtureSlides[0].keywords}
        sentences={[]}
        snapshot={{
          slideId: "slide_p3_intro",
          coveredSentenceIds: [],
          coveredSentenceMatchKinds: {},
          matchableSentenceCount: 0,
          sentenceCoverage: 0,
          wordCoverage: 0,
          effectiveCoverage: 0,
          finalSentenceSpoken: false,
          hitKeywordIds: [],
          provisionalMissingKeywordIds: []
        }}
      />
    );

    expect(html).toContain("생성형 AI");
    expect(html).not.toContain(p3CleanFinalTranscript);
    expect(html).not.toContain("말 속도");
  });
});

const timing: RehearsalTimingSnapshot = {
  deckTargetSeconds: 600,
  elapsedSeconds: 120,
  remainingSeconds: 480,
  currentSlideElapsedSeconds: 35,
  currentSlideTargetSeconds: 60,
  currentSlideOvertime: false
};

const adviceState: TimingAdviceState = {
  pace: "normal",
  slideOvertime: false
};

function createMockLiveSttPort() {
  const resultSubscribers = new Set<(result: LiveSttResult) => void>();
  const port = {
    engineId: "sherpa",
    capabilities: {
      onDevice: true,
      streaming: true,
      keywordBiasing: true,
      languages: ["ko"]
    },
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    updateBiasPhrases: vi.fn(),
    onResult: vi.fn((cb: (result: LiveSttResult) => void) => {
      resultSubscribers.add(cb);
      return () => resultSubscribers.delete(cb);
    }),
    onError: vi.fn(() => () => undefined),
    dispose: vi.fn(),
    emit(result: LiveSttResult) {
      for (const subscriber of resultSubscribers) {
        subscriber(result);
      }
    }
  };

  return port as LiveSttPort & {
    emit: (result: LiveSttResult) => void;
  };
}
