import { createDemoDeck } from "@orbit/editor-core";
import {
  createRehearsalEvaluationSnapshot,
  legacyRehearsalReportMetricsDefaults,
  legacyRehearsalSilenceAnalysis,
  legacyRehearsalVolumeAnalysis,
  type RehearsalReport,
  type RehearsalRun,
} from "@orbit/shared/rehearsals";
import type { ReactNode } from "react";
import { forwardRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyLiveTranscriptBias,
  buildLiveSttBiasContext,
} from "./stt/liveSttBias";
import {
  applyLiveTranscriptEvent,
  confirmKeywordOccurrenceMatches,
  createKeywordOccurrenceAnimationCueEvent,
  createLiveKeywordOccurrenceState,
  createLiveTranscriptBuffer,
  evaluateLiveTranscript,
  getOccurrenceTriggerProgress,
  renderLiveTranscriptBuffer,
} from "../../runtime/speech/tracking/liveTranscriptAnalysis";
import {
  buildP3SessionSlides,
  getHighlightedKeywordOccurrencesForSlide,
  getRehearsalPrompterRows,
  getRehearsalTimingProgress,
  getRemainingTriggerStepsForSlide,
  resetRehearsalTimerState,
  shouldRenderRehearsalThumbnailImage,
} from "./rehearsalWorkspaceModel";
import { getRehearsalTeleprompterScrollBehavior } from "../presenter-shell/presenter/RehearsalScriptTeleprompter";
import {
  defaultAutoAdvanceConfig,
  defaultAutoAdvancePolicy,
} from "../../runtime/presentation/advance/autoAdvanceConfig";
import {
  cancelAdvanceCountdown,
  createInitialAdvanceControllerState,
  evaluateAdvanceController,
} from "../../runtime/presentation/advance/advanceController";
import { p0AnimationDeck } from "../../runtime/presentation/slideshow/__fixtures__/animationDeck";
import { getNextPresenterStepState } from "../../runtime/presentation/slideshow/presenterStepNavigation";
import { normalizeLiveTranscriptText } from "../../runtime/speech/stt/liveTranscriptText";
import { createPauseDetector } from "./speech/pauseDetector";
import { resolveEditorAssetUrl } from "../editor/shared/editorAssetUrl";

vi.mock("react-konva", () => {
  const Group = forwardRef<HTMLDivElement, { children?: ReactNode }>(
    ({ children }, ref) => <div ref={ref}>{children}</div>,
  );
  const Stage = forwardRef<HTMLDivElement, { children?: ReactNode }>(
    ({ children }, ref) => <div ref={ref}>{children}</div>,
  );
  const Text = ({ text }: { text?: string }) => <span>{text}</span>;

  return {
    Arrow: () => <span data-konva-arrow="true" />,
    Circle: () => <span data-konva-circle="true" />,
    Group,
    Image: () => <span data-konva-image="true" />,
    Layer: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    Line: () => <span data-konva-line="true" />,
    Rect: () => <span data-konva-rect="true" />,
    RegularPolygon: () => <span data-konva-polygon="true" />,
    Shape: () => <span data-konva-shape="true" />,
    Star: () => <span data-konva-star="true" />,
    Stage,
    Text,
  };
});

describe("RehearsalWorkspace tracking and presentation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("resets total and current-slide timer state together", () => {
    const setElapsedSeconds = vi.fn();
    const setSlideElapsedSeconds = vi.fn();
    const setIsTimerRunning = vi.fn();

    resetRehearsalTimerState({
      setElapsedSeconds,
      setSlideElapsedSeconds,
      setIsTimerRunning,
    });

    expect(setElapsedSeconds).toHaveBeenCalledWith(0);
    expect(setSlideElapsedSeconds).toHaveBeenCalledWith(0);
    expect(setIsTimerRunning).toHaveBeenCalledWith(false);
  });

  it("fills expected-time progress and applies the five-second warning window", () => {
    expect(getRehearsalTimingProgress(44, 50)).toEqual({
      percent: 88,
      tone: "default",
    });
    expect(getRehearsalTimingProgress(45, 50)).toEqual({
      percent: 90,
      tone: "warning",
    });
    expect(getRehearsalTimingProgress(55, 50)).toEqual({
      percent: 100,
      tone: "warning",
    });
    expect(getRehearsalTimingProgress(56, 50)).toEqual({
      percent: 100,
      tone: "danger",
    });
  });

  it("matches live STT keywords with normalized Korean aliases", () => {
    const slide = {
      ...createDemoDeck().slides[0]!,
      slideId: "slide_1",
      keywords: [
        {
          keywordId: "kw_1",
          text: "ORBIT",
          synonyms: ["오르빗"],
          abbreviations: [],
          required: true,
        },
        {
          keywordId: "kw_2",
          text: "Live STT",
          synonyms: ["실시간 음성 인식"],
          abbreviations: ["stt"],
          required: true,
        },
      ],
    };

    const analysis = evaluateLiveTranscript(
      slide,
      "오늘은 오르빗 실시간음성인식 흐름을 확인합니다",
    );

    expect(normalizeLiveTranscriptText("실시간 음성 인식")).toBe(
      "실시간음성인식",
    );
    expect(analysis.coverage).toBe(1);
    expect(
      analysis.detectedKeywords.map((keyword) => keyword.keywordId),
    ).toEqual(["kw_1", "kw_2"]);
    expect(analysis.missingKeywordIds).toEqual([]);
  });

  it("matches generated Korean pronunciations and exposes them to live STT bias", () => {
    const deck = createDemoDeck();
    deck.slides[0]!.speakerNotes = "OpenAI API를 활용했습니다.";
    deck.slides[0]!.keywords = [
      {
        keywordId: "kw_openai",
        text: "OpenAI",
        synonyms: [],
        abbreviations: [],
        required: true,
      },
      {
        keywordId: "kw_api",
        text: "API",
        synonyms: [],
        abbreviations: [],
        required: true,
      },
    ];
    const snapshot = createRehearsalEvaluationSnapshot(deck);
    const lexicon = snapshot.pronunciationLexicon;

    const analysis = evaluateLiveTranscript(
      deck.slides[0]!,
      "오픈 에이아이 에이피아이를 활용했습니다.",
      lexicon,
    );
    const biasContext = buildLiveSttBiasContext(deck.slides[0]!, {
      pronunciationLexicon: lexicon,
    });
    const sessionSlide = buildP3SessionSlides(deck, snapshot)[0];

    expect(analysis.coverage).toBe(1);
    expect(
      analysis.detectedKeywords.map((keyword) => keyword.matchedText),
    ).toEqual(["오픈 에이아이", "에이피아이"]);
    expect(biasContext.terms).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: "오픈에이아이",
          source: "pronunciation-alias",
        }),
        expect.objectContaining({
          text: "에이피아이",
          source: "pronunciation-alias",
        }),
      ]),
    );
    expect(
      sessionSlide?.pronunciationEntries?.map((entry) => entry.canonicalKey),
    ).toEqual(["openai", "api"]);
  });

  it("builds current-slide live STT bias terms from keywords and slide context", () => {
    const deck = createDemoDeck();
    const slide = {
      ...deck.slides[0]!,
      slideId: "slide_1",
      title: "ORBIT Live STT",
      speakerNotes: "오프닝, 브라우저 온디바이스 인식",
      keywords: [
        {
          keywordId: "kw_orbit",
          text: "ORBIT",
          synonyms: ["오르빗"],
          abbreviations: ["OBT"],
          required: true,
        },
      ],
      elements: [
        ...deck.slides[0]!.elements,
        {
          elementId: "el_body",
          type: "text" as const,
          role: "body" as const,
          x: 0,
          y: 0,
          width: 320,
          height: 80,
          rotation: 0,
          opacity: 1,
          zIndex: 1,
          locked: false,
          visible: true,
          props: {
            text: "온디바이스 STT와 키워드 진행률",
            fontSize: 24,
            fontWeight: 400,
            align: "left" as const,
            verticalAlign: "top" as const,
            lineHeight: 1.2,
          },
        },
      ],
    };

    const nearbySlide = {
      ...deck.slides[1]!,
      slideId: "slide_nearby",
      title: "다음 장표 요약",
      elements: [
        {
          elementId: "el_nearby",
          type: "text" as const,
          role: "body" as const,
          x: 0,
          y: 0,
          width: 320,
          height: 80,
          rotation: 0,
          opacity: 1,
          zIndex: 1,
          locked: false,
          visible: true,
          props: {
            text: "후속 액션 플랜",
            fontSize: 24,
            fontWeight: 400,
            align: "left" as const,
            verticalAlign: "top" as const,
            lineHeight: 1.2,
          },
        },
      ],
    };

    const biasContext = buildLiveSttBiasContext(slide, {
      nearbySlides: [nearbySlide],
    });

    expect(biasContext.slideId).toBe("slide_1");
    expect(biasContext.terms.slice(0, 3).map((term) => term.text)).toEqual([
      "ORBIT",
      "오르빗",
      "OBT",
    ]);
    expect(biasContext.terms).toContainEqual(
      expect.objectContaining({
        text: "ORBIT Live STT",
        source: "title",
      }),
    );
    expect(biasContext.terms).toContainEqual(
      expect.objectContaining({
        text: "브라우저 온디바이스 인식",
        source: "speaker-notes",
      }),
    );
    expect(biasContext.terms).toContainEqual(
      expect.objectContaining({
        text: "다음 슬라이드",
        source: "control-phrase",
      }),
    );
    expect(biasContext.terms).toContainEqual(
      expect.objectContaining({
        text: "후속 액션 플랜",
        source: "nearby-slide-text",
      }),
    );
  });

  it("uses fuzzy live STT bias only for keyword matching transcripts", () => {
    const slide = {
      ...createDemoDeck().slides[0]!,
      slideId: "slide_1",
      keywords: [
        {
          keywordId: "kw_orbit",
          text: "오르빗",
          synonyms: [],
          abbreviations: [],
          required: true,
        },
      ],
    };
    const biasContext = buildLiveSttBiasContext(slide);
    const rawTranscript = "오늘은 오르비트 리허설을 시작합니다";
    const rawAnalysis = evaluateLiveTranscript(slide, rawTranscript);
    const biasedTranscript = applyLiveTranscriptBias(
      rawTranscript,
      biasContext,
    );
    const biasedAnalysis = evaluateLiveTranscript(slide, biasedTranscript);

    expect(rawAnalysis.coverage).toBe(0);
    expect(biasedTranscript).toBe(`${rawTranscript} 오르빗`);
    expect(biasedAnalysis.coverage).toBe(1);
  });

  it("does not fuzzy-correct Korean prefix-only keyword fragments into coverage", () => {
    const slide = {
      ...createDemoDeck().slides[0]!,
      slideId: "slide_1",
      keywords: [
        {
          keywordId: "kw_orbit",
          text: "오르빗",
          synonyms: [],
          abbreviations: [],
          required: true,
        },
      ],
    };
    const biasContext = buildLiveSttBiasContext(slide);

    for (const rawTranscript of [
      "오늘은 오르 리허설을 시작합니다",
      "오늘은 오르비 리허설을 시작합니다",
    ]) {
      const biasedTranscript = applyLiveTranscriptBias(
        rawTranscript,
        biasContext,
      );
      const biasedAnalysis = evaluateLiveTranscript(slide, biasedTranscript);

      expect(biasedTranscript).toBe(rawTranscript);
      expect(biasedAnalysis.coverage).toBe(0);
    }
  });

  it("does not fuzzy-correct short ascii abbreviations into coverage", () => {
    const slide = {
      ...createDemoDeck().slides[0]!,
      slideId: "slide_1",
      keywords: [
        {
          keywordId: "kw_stt",
          text: "음성 인식",
          synonyms: [],
          abbreviations: ["STT"],
          required: true,
        },
      ],
    };
    const biasContext = buildLiveSttBiasContext(slide);
    const rawTranscript = "오늘은 start 단계를 진행합니다";
    const biasedTranscript = applyLiveTranscriptBias(
      rawTranscript,
      biasContext,
    );
    const biasedAnalysis = evaluateLiveTranscript(slide, biasedTranscript);

    expect(biasedTranscript).toBe(rawTranscript);
    expect(biasedAnalysis.coverage).toBe(0);
  });

  it("reserves control-phrase slots when keyword aliases exceed the cap", () => {
    const keywords = Array.from({ length: 12 }, (_, index) => ({
      keywordId: `kw_${index}`,
      text: `키워드${index}`,
      synonyms: [`동의어${index}`],
      abbreviations: [`약어${index}`],
      required: true,
    }));
    const slide = {
      ...createDemoDeck().slides[0]!,
      slideId: "slide_dense",
      keywords,
    };
    const biasContext = buildLiveSttBiasContext(slide);

    expect(biasContext.terms.length).toBeLessThanOrEqual(32);
    expect(
      biasContext.terms.some((term) => term.source === "control-phrase"),
    ).toBe(true);
  });

  it("resolves slide thumbnails to same-origin asset URLs", () => {
    vi.stubGlobal("window", {
      location: {
        origin: "http://localhost:5173",
      },
    });

    expect(
      resolveEditorAssetUrl("/api/v1/projects/p1/assets/file_1/content"),
    ).toBe("http://localhost:5173/api/v1/projects/p1/assets/file_1/content");
    expect(
      resolveEditorAssetUrl(
        "http://localhost:9000/orbit-local/projects/project_real_1/assets/file_real_1/slide_1.png",
      ),
    ).toBe(
      "http://localhost:5173/api/v1/projects/project_real_1/assets/file_real_1/content",
    );
    expect(resolveEditorAssetUrl("https://cdn.example.com/thumb.png")).toBe(
      "https://cdn.example.com/thumb.png",
    );
  });

  it("composes committed live STT finals with the current draft", () => {
    let buffer = createLiveTranscriptBuffer();

    buffer = applyLiveTranscriptEvent(buffer, {
      transcript: "오늘은",
      isFinal: false,
    });
    expect(renderLiveTranscriptBuffer(buffer)).toBe("오늘은");

    buffer = applyLiveTranscriptEvent(buffer, {
      transcript: "오늘은",
      isFinal: true,
    });
    expect(renderLiveTranscriptBuffer(buffer)).toBe("오늘은");

    buffer = applyLiveTranscriptEvent(buffer, {
      transcript: "오르빗",
      isFinal: false,
    });

    expect(renderLiveTranscriptBuffer(buffer)).toBe("오늘은 오르빗");
    expect(renderLiveTranscriptBuffer(buffer)).not.toContain("오늘은 오늘은");
  });

  it("evaluates keywords across multiple committed live STT utterances", () => {
    const slide = {
      ...createDemoDeck().slides[0]!,
      slideId: "slide_1",
      keywords: [
        {
          keywordId: "kw_1",
          text: "ORBIT",
          synonyms: ["오르빗"],
          abbreviations: [],
          required: true,
        },
        {
          keywordId: "kw_2",
          text: "Live STT",
          synonyms: ["실시간 음성 인식"],
          abbreviations: ["stt"],
          required: true,
        },
      ],
    };
    let buffer = createLiveTranscriptBuffer();

    buffer = applyLiveTranscriptEvent(buffer, {
      transcript: "오늘은 오르빗을 소개합니다",
      isFinal: true,
    });
    buffer = applyLiveTranscriptEvent(buffer, {
      transcript: "실시간 음성 인식 흐름입니다",
      isFinal: true,
    });

    const transcript = renderLiveTranscriptBuffer(buffer);
    const analysis = evaluateLiveTranscript(slide, transcript);

    expect(transcript).toBe(
      "오늘은 오르빗을 소개합니다 실시간 음성 인식 흐름입니다",
    );
    expect(analysis.coverage).toBe(1);
    expect(
      analysis.detectedKeywords.map((keyword) => keyword.keywordId),
    ).toEqual(["kw_1", "kw_2"]);
  });

  it("starts a fresh live STT transcript buffer after reset", () => {
    let buffer = createLiveTranscriptBuffer();
    buffer = applyLiveTranscriptEvent(buffer, {
      transcript: "이전 슬라이드 오르빗",
      isFinal: true,
    });

    buffer = createLiveTranscriptBuffer();
    expect(renderLiveTranscriptBuffer(buffer)).toBe("");

    buffer = applyLiveTranscriptEvent(buffer, {
      transcript: "새 슬라이드",
      isFinal: false,
    });
    expect(renderLiveTranscriptBuffer(buffer)).toBe("새 슬라이드");
  });

  it("keeps the current prompter sentence when coaching coverage comes from a partial transcript", () => {
    const rows = getRehearsalPrompterRows(
      [
        {
          sentenceId: "sentence_1",
          text: "첫 문장은 아직 끝까지 읽지 않았습니다.",
          index: 0,
          isFinalTrigger: false,
          matchable: true,
          candidates: [],
        },
        {
          sentenceId: "sentence_2",
          text: "다음 문장입니다.",
          index: 1,
          isFinalTrigger: true,
          matchable: true,
          candidates: [],
        },
      ],
      ["sentence_1"],
      "",
      {
        slideId: "slide_1",
        revision: 0,
        phase: "candidate",
        currentSentenceId: "sentence_1",
        candidateSentenceId: "sentence_1",
        candidateSinceMs: 1_000,
        committedSentenceIds: [],
        lastCommittedSentenceId: null,
        lastCommitSource: null,
        finalSentenceCommitted: false,
      },
    );

    expect(rows.current).toBe("첫 문장은 아직 끝까지 읽지 않았습니다.");
    expect(rows.previous).toBe("");
    expect(rows.next).toBe("다음 문장입니다.");
  });

  it("moves the prompter after the current sentence is committed", () => {
    const rows = getRehearsalPrompterRows(
      [
        {
          sentenceId: "sentence_1",
          text: "첫 문장입니다.",
          index: 0,
          isFinalTrigger: false,
          matchable: true,
          candidates: [],
        },
        {
          sentenceId: "sentence_2",
          text: "다음 문장입니다.",
          index: 1,
          isFinalTrigger: true,
          matchable: true,
          candidates: [],
        },
      ],
      [],
      "",
      {
        slideId: "slide_1",
        revision: 1,
        phase: "tracking",
        currentSentenceId: "sentence_2",
        candidateSentenceId: null,
        candidateSinceMs: null,
        committedSentenceIds: ["sentence_1"],
        lastCommittedSentenceId: "sentence_1",
        lastCommitSource: "lexical",
        finalSentenceCommitted: false,
      },
    );

    expect(rows.current).toBe("다음 문장입니다.");
    expect(rows.previous).toBe("첫 문장입니다.");
    expect(rows.next).toBe("");
  });

  it("recenters the lower prompter only when its focused sentence changes", () => {
    expect(
      getRehearsalTeleprompterScrollBehavior(undefined, "sentence_1"),
    ).toBe("auto");
    expect(
      getRehearsalTeleprompterScrollBehavior("sentence_1", "sentence_1"),
    ).toBeNull();
    expect(
      getRehearsalTeleprompterScrollBehavior("sentence_1", "sentence_2"),
    ).toBe("smooth");
    expect(
      getRehearsalTeleprompterScrollBehavior(
        "slide_1:sentence_1",
        "slide_2:sentence_1",
      ),
    ).toBe("smooth");
    expect(
      getRehearsalTeleprompterScrollBehavior("sentence_2", null),
    ).toBeNull();
  });

  it("returns current prompter sentence as a single sentence block", () => {
    const rows = getRehearsalPrompterRows(
      [
        {
          sentenceId: "sentence_1",
          text: "첫 문장입니다.",
          index: 0,
          isFinalTrigger: false,
          matchable: true,
          candidates: [],
        },
        {
          sentenceId: "sentence_2",
          text: "두 번째 문장입니다.",
          index: 1,
          isFinalTrigger: true,
          matchable: true,
          candidates: [],
        },
      ],
      [],
      "",
    );

    expect(rows).toMatchObject({
      previous: "",
      current: "첫 문장입니다.",
      next: "두 번째 문장입니다.",
      focusSentenceId: "sentence_1",
      items: [
        expect.objectContaining({
          sentenceId: "sentence_1",
          status: "current",
        }),
        expect.objectContaining({
          sentenceId: "sentence_2",
          status: "next",
        }),
      ],
    });
  });

  it("computes remaining trigger steps when P4 fixtures inject cue-referenced animations", () => {
    const slide = p0AnimationDeck.slides[0]!;
    const triggerAnimationIds = [
      "anim_image_zoom_in",
      "anim_group_fade_out",
      "anim_chart_zoom_out",
    ];

    expect(
      getRemainingTriggerStepsForSlide({
        slide,
        stepIndex: 0,
        triggerAnimationIds: [],
      }),
    ).toBe(0);
    expect(
      getRemainingTriggerStepsForSlide({
        slide,
        stepIndex: 0,
        triggerAnimationIds,
      }),
    ).toBe(2);
    expect(
      getRemainingTriggerStepsForSlide({
        slide,
        stepIndex: 1,
        triggerAnimationIds,
      }),
    ).toBe(1);
    expect(
      getRemainingTriggerStepsForSlide({
        slide,
        stepIndex: 2,
        triggerAnimationIds,
      }),
    ).toBe(0);
  });

  it("proves P4 auto-advance gates with fixture speech, pause, and build steps", () => {
    const slide = p0AnimationDeck.slides[0]!;
    const triggerAnimationIds = [
      "anim_image_zoom_in",
      "anim_group_fade_out",
      "anim_chart_zoom_out",
    ];
    const pauseDetector = createPauseDetector({
      config: { silenceThresholdDb: -55 },
      pauseMs: defaultAutoAdvancePolicy.pauseMs,
    });
    pauseDetector.accept({ type: "audio-level", atMs: 0, rmsDb: -60 });
    pauseDetector.accept({ type: "tick", atMs: 700 });
    const pause = pauseDetector.snapshot(700);

    const premature = evaluateAdvanceController(
      createInitialAdvanceControllerState(),
      {
        effectiveCoverage: 1,
        finalSentenceCommitted: false,
        finalSentenceCommittedAtMs: null,
        finalSentenceSpoken: true,
        finalSentenceSpokenAtMs: 100,
        isLastSlide: false,
        mode: "rehearsal",
        nowMs: 700,
        pause,
        policy: defaultAutoAdvancePolicy,
        remainingTriggerSteps: 0,
        slideId: slide.slideId,
      },
      defaultAutoAdvanceConfig,
    );

    expect(premature.commands).toEqual([]);
    expect(premature.state.status).toBe("tracking");

    const blocked = evaluateAdvanceController(
      createInitialAdvanceControllerState(),
      {
        effectiveCoverage: 0.7,
        finalSentenceCommitted: true,
        finalSentenceCommittedAtMs: 100,
        finalSentenceSpoken: true,
        finalSentenceSpokenAtMs: 100,
        isLastSlide: false,
        mode: "rehearsal",
        nowMs: 700,
        pause,
        policy: defaultAutoAdvancePolicy,
        remainingTriggerSteps: getRemainingTriggerStepsForSlide({
          slide,
          stepIndex: 0,
          triggerAnimationIds,
        }),
        slideId: slide.slideId,
      },
      defaultAutoAdvanceConfig,
    );

    expect(blocked.commands).toContainEqual({
      type: "show-builds-remaining",
      remainingTriggerSteps: 2,
    });
    expect(blocked.commands).not.toContainEqual({
      type: "advance-slide",
      slideId: slide.slideId,
    });
    expect(
      getNextPresenterStepState({
        currentSlideIndex: 0,
        currentStepIndex: 0,
        maxStepIndex: 2,
        slideCount: p0AnimationDeck.slides.length,
      }),
    ).toMatchObject({ slideIndex: 0, stepIndex: 1 });

    const countdown = evaluateAdvanceController(
      createInitialAdvanceControllerState(),
      {
        effectiveCoverage: 0.7,
        finalSentenceCommitted: true,
        finalSentenceCommittedAtMs: 100,
        finalSentenceSpoken: true,
        finalSentenceSpokenAtMs: 100,
        isLastSlide: false,
        mode: "rehearsal",
        nowMs: 700,
        pause,
        policy: defaultAutoAdvancePolicy,
        remainingTriggerSteps: getRemainingTriggerStepsForSlide({
          slide,
          stepIndex: 2,
          triggerAnimationIds,
        }),
        slideId: slide.slideId,
      },
      defaultAutoAdvanceConfig,
    );
    const advanced = evaluateAdvanceController(
      countdown.state,
      {
        effectiveCoverage: 0.7,
        finalSentenceCommitted: true,
        finalSentenceCommittedAtMs: 100,
        finalSentenceSpoken: true,
        finalSentenceSpokenAtMs: 100,
        isLastSlide: false,
        mode: "rehearsal",
        nowMs: 2700,
        pause: { isPaused: true, silenceDurationMs: 2700 },
        policy: defaultAutoAdvancePolicy,
        remainingTriggerSteps: 0,
        slideId: slide.slideId,
      },
      defaultAutoAdvanceConfig,
    );

    expect(countdown.state.status).toBe("countdown");
    expect(advanced.commands).toEqual([
      { type: "advance-slide", slideId: slide.slideId },
    ]);
    expect(
      evaluateAdvanceController(
        countdown.state,
        {
          effectiveCoverage: 0.7,
          finalSentenceCommitted: true,
          finalSentenceCommittedAtMs: 100,
          finalSentenceSpoken: true,
          finalSentenceSpokenAtMs: 100,
          isLastSlide: false,
          mode: "rehearsal",
          nowMs: 900,
          pause: { isPaused: false, silenceDurationMs: 0 },
          policy: defaultAutoAdvancePolicy,
          remainingTriggerSteps: 0,
          slideId: slide.slideId,
        },
        defaultAutoAdvanceConfig,
      ).commands,
    ).toEqual([{ type: "cancel-countdown", reason: "speech-resumed" }]);
    expect(cancelAdvanceCountdown(countdown.state, "manual").state.status).toBe(
      "tracking",
    );

    const finalSlide = p0AnimationDeck.slides[1]!;
    const finish = evaluateAdvanceController(
      createInitialAdvanceControllerState(),
      {
        effectiveCoverage: 1,
        finalSentenceCommitted: true,
        finalSentenceCommittedAtMs: 100,
        finalSentenceSpoken: true,
        finalSentenceSpokenAtMs: 100,
        isLastSlide: true,
        mode: "rehearsal",
        nowMs: 700,
        pause,
        policy: defaultAutoAdvancePolicy,
        remainingTriggerSteps: 0,
        slideId: finalSlide.slideId,
      },
      defaultAutoAdvanceConfig,
    );

    expect(finish.commands).toEqual([
      { type: "suggest-finish", slideId: finalSlide.slideId },
    ]);
    expect(finish.state.status).toBe("finish-suggested");
  });
});
