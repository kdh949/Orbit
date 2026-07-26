import type { SemanticCue } from "@orbit/shared/deck";
import type { SemanticCapabilityEvent } from "@orbit/shared/rehearsals";
import { describe, expect, it, vi } from "vitest";

import { LiveSttError, type LiveSttPort, type LiveSttResult } from "../../../runtime/speech/stt/liveSttPort";
import {
  defaultAutoAdvanceConfig,
  defaultAutoAdvancePolicy,
  defaultPauseDetectorConfig
} from "../../../runtime/presentation/advance/autoAdvanceConfig";
import {
  createInitialAdvanceControllerState,
  evaluateAdvanceController
} from "../../../runtime/presentation/advance/advanceController";
import { createP3RehearsalSession, type P3RehearsalSessionSlide } from "./p3RehearsalSession";
import { createPauseDetector } from "./pauseDetector";
import type { SemanticCueDebugEvent } from "../../../runtime/speech/semantic/cue/semanticCueDebugEvents";
import { createSemanticCueEmbeddingIndex } from "../../../runtime/speech/semantic/cue/semanticCueEmbeddingIndex";
import { createSemanticCueRuntime } from "../../../runtime/speech/semantic/cue/semanticCueRuntime";
import { createMockSemanticCueNliProvider } from "../../../runtime/speech/semantic/nli/mockSemanticCueNliProvider";
import type { SemanticUtteranceDebugState } from "../../../runtime/speech/semantic/semanticSpeechDebug";
import type { SemanticUtteranceDecision } from "../../../runtime/speech/semantic/semanticUtteranceDecision";
import type { SemanticUtteranceMatcher, SemanticUtteranceMatch } from "../../../runtime/speech/semantic/semanticUtteranceMatcher";
import type { SpeechTrackingEvent } from "../../../runtime/speech/tracking/speechTrackingEvents";

describe("p3RehearsalSession", () => {
  it("does not commit timer, tracker, or log state when STT start fails", async () => {
    const port = createMockLiveSttPort({
      start: vi.fn(async () => {
        throw new LiveSttError("start_failed", "start failed");
      })
    });
    const session = createP3RehearsalSession({
      slides,
      port,
      now: () => 1_000
    });

    await expect(
      session.start({
        audioSource: {} as MediaStream,
        slideIndex: 0
      })
    ).rejects.toThrow("start failed");

    expect(session.getState()).toEqual({
      status: "failed",
      slideIndex: 0,
      startedAtMs: null,
      slideEnteredAtMs: null,
      snapshot: null,
      finalSegments: [],
      runMeta: null,
      semanticCueProgress: [],
      capabilityStatuses: expect.objectContaining({
        stt: "unavailable",
        transcript_evidence: "unavailable"
      })
    });
  });

  it("capability 상태 변경만 callback과 run meta에 기록한다", async () => {
    const port = createMockLiveSttPort();
    const capabilityEvents: SemanticCapabilityEvent[] = [];
    const session = createP3RehearsalSession({
      slides,
      port,
      now: createNow([1_000, 2_000, 3_000]),
      onSemanticCapabilityEvent: (event) => capabilityEvents.push(event)
    });

    await session.start({ audioSource: {} as MediaStream, slideIndex: 0 });
    port.emitError(new LiveSttError("permission_denied", "permission denied"));

    expect(capabilityEvents).toMatchObject([
      {
        capability: "stt",
        fromState: "unavailable",
        toState: "degraded",
        reason: "model_not_ready",
        measurementMode: "none"
      },
      {
        capability: "stt",
        fromState: "degraded",
        toState: "available",
        measurementMode: "full"
      },
      {
        capability: "stt",
        fromState: "available",
        toState: "unavailable",
        reason: "permission_denied",
        measurementMode: "none"
      }
    ]);
    expect(capabilityEvents).toHaveLength(3);
  });

  it("starts Live STT with current slide bias phrases before exposing running state", async () => {
    const port = createMockLiveSttPort();
    const session = createP3RehearsalSession({
      slides,
      port,
      now: () => 2_000
    });

    await session.start({
      audioSource: {} as MediaStream,
      slideIndex: 0
    });

    expect(port.start).toHaveBeenCalledWith({
      language: "ko",
      audioSource: {},
      biasPhrases: expect.arrayContaining([
        expect.objectContaining({
          text: "다음 슬라이드",
          weight: 1,
          source: "control-phrase"
        }),
        expect.objectContaining({
          text: "생성형 AI",
          weight: 0.94,
          source: "keyword",
          keywordId: "kw_ai",
          canonicalText: "생성형 AI"
        })
      ])
    });
    expect(session.getState()).toMatchObject({
      status: "running",
      slideIndex: 0,
      startedAtMs: 2_000,
      slideEnteredAtMs: 2_000
    });
    expect(session.getState().runMeta?.slideTimeline).toBeUndefined();
  });

  it("cue-only slide의 current와 adjacent approved core 용어로 STT bias를 갱신한다", async () => {
    const port = createMockLiveSttPort();
    const session = createP3RehearsalSession({
      slides: [
        {
          slideId: "slide_1",
          speakerNotes: "",
          keywords: [],
          semanticCues: [
            semanticCue({
              cueId: "scue_rsp",
              aliases: { RSP: ["알에스피"] }
            }),
            semanticCue({
              cueId: "scue_unreviewed",
              reviewStatus: "suggested",
              aliases: { SECRET: ["시크릿"] }
            })
          ]
        },
        {
          slideId: "slide_2",
          speakerNotes: "",
          keywords: [],
          semanticCues: [
            semanticCue({
              cueId: "scue_rox",
              slideId: "slide_2",
              aliases: { ROX: ["알오엑스"] }
            })
          ]
        },
        {
          slideId: "slide_3",
          speakerNotes: "",
          keywords: [],
          semanticCues: [
            semanticCue({
              cueId: "scue_far",
              slideId: "slide_3",
              aliases: { FAR_CODE: ["파 코드"] }
            })
          ]
        }
      ],
      port,
      now: createNow([2_000, 3_000])
    });

    await session.start({
      audioSource: {} as MediaStream,
      slideIndex: 0
    });

    expect(port.start).toHaveBeenCalledWith(
      expect.objectContaining({
        biasPhrases: expect.arrayContaining([
          expect.objectContaining({
            text: "RSP",
            source: "semantic-cue-term",
            weight: 0.93
          }),
          expect.objectContaining({
            text: "ROX",
            source: "semantic-cue-term",
            weight: 0.85
          })
        ])
      })
    );
    const startConfig = (port.start as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    const startBiasTexts = startConfig.biasPhrases.map((phrase: { text: string }) => phrase.text);
    expect(startBiasTexts).not.toContain("SECRET");
    expect(startBiasTexts).not.toContain("FAR_CODE");

    session.enterSlide(1);

    expect(port.updateBiasPhrases).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ text: "ROX", weight: 0.93 }),
        expect.objectContaining({ text: "RSP", weight: 0.85 })
      ])
    );
  });

  it("tracks final transcript events and finalizes meta without transcript text", async () => {
    const port = createMockLiveSttPort();
    const events: SpeechTrackingEvent[] = [];
    const session = createP3RehearsalSession({
      slides,
      port,
      now: createNow([10_000, 12_000, 20_000]),
      onEvents: (nextEvents) => events.push(...nextEvents)
    });

    await session.start({
      audioSource: {} as MediaStream,
      slideIndex: 0
    });

    port.emit({
      text: "생성형 AI 초안을 안정적으로 추적합니다.",
      isFinal: false,
      timestampMs: [100, 900]
    });
    port.emit({
      text: "생성형 AI 초안을 안정적으로 추적합니다. 마지막으로 개인정보를 보호합니다.",
      isFinal: true,
      timestampMs: [1_000, 2_000]
    });

    expect(events.map((event) => event.type)).toEqual([
      "sentence-covered",
      "keyword-hit",
      "coverage-updated",
      "sentence-covered",
      "last-sentence-spoken",
      "coverage-updated"
    ]);
    expect(session.getState().snapshot).toMatchObject({
      slideId: "slide_1",
      finalSentenceSpoken: true,
      hitKeywordIds: ["kw_ai"]
    });

    const meta = await session.stop();

    expect(meta).toEqual({
      recordingDurationSeconds: 2,
      slideTimeline: [
        {
          slideId: "slide_1",
          enteredAt: new Date(10_000).toISOString()
        }
      ],
      missedKeywords: [
        {
          slideId: "slide_2",
          keywordId: "kw_privacy"
        }
      ],
      adviceEvents: [],
      utteranceOutcomes: [
        {
          kind: "covered",
          slideId: "slide_1",
          sentenceId: "sentence_1",
          at: new Date(10_000).toISOString()
        },
        {
          kind: "covered",
          slideId: "slide_1",
          sentenceId: "sentence_2",
          at: new Date(10_000).toISOString()
        },
        {
          kind: "missed",
          slideId: "slide_2",
          sentenceId: "sentence_1"
        }
      ],
      semanticCueDecisions: [],
      semanticCapabilityEvents: [
        expect.objectContaining({
          capability: "stt",
          fromState: "unavailable",
          toState: "degraded",
          reason: "model_not_ready",
          measurementMode: "none"
        }),
        expect.objectContaining({
          capability: "stt",
          fromState: "degraded",
          toState: "available",
          measurementMode: "full"
        }),
        expect.objectContaining({
          capability: "transcript_evidence",
          fromState: "unavailable",
          toState: "available",
          measurementMode: "full"
        })
      ]
    });
    expect(JSON.stringify(meta)).not.toContain("생성형 AI 초안");
    expect(JSON.stringify(meta)).not.toContain("speakerNotes");
  });

  it("records provisional missing on slide exit and keeps slide keyword hits across revisit", async () => {
    const port = createMockLiveSttPort();
    const events: SpeechTrackingEvent[] = [];
    const session = createP3RehearsalSession({
      slides,
      port,
      now: createNow([30_000, 31_000, 32_000, 33_000]),
      onEvents: (nextEvents) => events.push(...nextEvents)
    });

    await session.start({
      audioSource: {} as MediaStream,
      slideIndex: 0
    });
    port.emit({
      text: "생성형 AI",
      isFinal: true,
      timestampMs: [1_000, 1_500]
    });
    session.enterSlide(1);
    session.enterSlide(0);

    expect(events.filter((event) => event.type === "keyword-missing")).toMatchObject([
      {
        type: "keyword-missing",
        slideId: "slide_2",
        keywordId: "kw_privacy",
        provisional: true
      }
    ]);
    expect(session.getState().snapshot?.hitKeywordIds).toEqual(["kw_ai"]);
    expect(port.updateBiasPhrases).toHaveBeenCalled();
  });

  it("passes slide control phrases to the tracker extraction path", async () => {
    const port = createMockLiveSttPort();
    const session = createP3RehearsalSession({
      slides: [
        {
          slideId: "slide_control",
          speakerNotes: "다음 슬라이드. 제품 가치를 설명합니다.",
          keywords: [],
          controlPhrases: ["다음 슬라이드"]
        }
      ],
      port,
      now: () => 40_000
    });

    await session.start({
      audioSource: {} as MediaStream,
      slideIndex: 0
    });

    port.emit({
      text: "다음 슬라이드",
      isFinal: true,
      timestampMs: [0, 500]
    });

    expect(session.getState().snapshot).toMatchObject({
      matchableSentenceCount: 1,
      sentenceCoverage: 0,
      effectiveCoverage: 0
    });
  });

  it("pauses and resumes the same slide tracking state with monotonic STT timestamps", async () => {
    const port = createMockLiveSttPort();
    const session = createP3RehearsalSession({
      slides,
      port,
      now: createNow([45_000])
    });

    await session.start({
      audioSource: { id: "stream-1" } as unknown as MediaStream,
      slideIndex: 0
    });

    port.emit({
      text: "생성형 AI 초안을 안정적으로 추적합니다.",
      isFinal: true,
      timestampMs: [0, 1_000]
    });
    expect(session.getState().snapshot?.coveredSentenceIds).toEqual(["sentence_1"]);

    await session.pause();
    expect(session.getState().status).toBe("paused");
    expect(port.stop).toHaveBeenCalledTimes(1);
    expect(session.enterSlide(1)).toEqual([]);

    port.emit({
      text: "마지막으로 개인정보를 보호합니다.",
      isFinal: true,
      timestampMs: [0, 500]
    });
    expect(session.getState().snapshot?.coveredSentenceIds).toEqual(["sentence_1"]);

    await session.resume({
      audioSource: { id: "stream-1" } as unknown as MediaStream
    });
    expect(session.getState().status).toBe("running");
    expect(port.start).toHaveBeenCalledTimes(2);
    expect(port.onResult).toHaveBeenCalledTimes(2);
    expect(port.onError).toHaveBeenCalledTimes(2);

    port.emit({
      text: "마지막으로 개인정보를 보호합니다.",
      isFinal: true,
      timestampMs: [0, 500]
    });

    const finalSegments = session.getState().finalSegments;
    expect(session.getState().snapshot).toMatchObject({
      slideId: "slide_1",
      coveredSentenceIds: ["sentence_1", "sentence_2"],
      finalSentenceSpoken: true
    });
    expect(finalSegments.map((segment) => segment.timestampMs)).toEqual([
      [0, 1_000],
      [1_000, 1_500]
    ]);

    await expect(session.stop()).resolves.toMatchObject({
      slideTimeline: [
        {
          slideId: "slide_1"
        }
      ]
    });
  });

  it("무음 경계를 STT 상대 시간으로 변환해 프롬프터를 commit한다", async () => {
    const port = createMockLiveSttPort();
    const session = createP3RehearsalSession({
      slides,
      port,
      now: () => 100_000
    });

    await session.start({ audioSource: {} as MediaStream, slideIndex: 0 });
    port.emit({
      text: "생성형 AI 초안을 안정적으로 추적합니다",
      isFinal: false,
      timestampMs: [0, 800]
    });

    expect(session.acceptPrompterPauseBoundary(600)).toBe(true);
    expect(session.getState().snapshot?.prompterProgress).toMatchObject({
      currentSentenceId: "sentence_2",
      committedSentenceIds: ["sentence_1"]
    });
  });

  it("다문장 final 뒤 실제 pause detector 경계로 다음 문장까지 commit한다", async () => {
    const port = createMockLiveSttPort();
    const session = createP3RehearsalSession({
      slides,
      port,
      now: () => 100_000
    });
    const detector = createPauseDetector({
      config: defaultPauseDetectorConfig,
      pauseMs: 600
    });

    await session.start({ audioSource: {} as MediaStream, slideIndex: 0 });
    detector.accept({ type: "audio-level", atMs: 0, rmsDb: -60 });
    port.emit(p3CombinedFinalResult());
    detector.accept({
      type: "transcript-activity",
      atMs: 1_000,
      isFinal: true
    });

    expect(session.getState().snapshot?.prompterProgress).toMatchObject({
      revision: 1,
      phase: "candidate",
      currentSentenceId: "sentence_2",
      candidateSentenceId: "sentence_2",
      committedSentenceIds: ["sentence_1"],
      finalSentenceCommitted: false
    });

    const pauseOutputs = detector.accept({ type: "tick", atMs: 1_600 });
    for (const output of pauseOutputs) {
      if (output.type === "pause-started") {
        session.acceptPrompterPauseBoundary(output.silenceDurationMs);
      }
    }

    expect(pauseOutputs).toEqual([{ type: "pause-started", atMs: 1_600, silenceDurationMs: 600 }]);
    expect(session.getState().snapshot).toMatchObject({
      finalSentenceCommitted: true,
      prompterProgress: {
        revision: 2,
        currentSentenceId: null,
        committedSentenceIds: ["sentence_1", "sentence_2"],
        finalSentenceCommitted: true
      }
    });
  });

  it("audio-level이 없는 Web Speech에서도 마지막 문장을 commit하고 자동 전환한다", async () => {
    const port = createMockLiveSttPort();
    const session = createP3RehearsalSession({
      slides,
      port,
      now: () => 100_000
    });
    const detector = createPauseDetector({
      config: defaultPauseDetectorConfig,
      pauseMs: 600
    });

    await session.start({ audioSource: {} as MediaStream, slideIndex: 0 });
    port.emit(p3CombinedFinalResult());
    detector.accept({
      type: "transcript-activity",
      atMs: 1_000,
      isFinal: true
    });

    const pauseOutputs = detector.accept({ type: "tick", atMs: 1_600 });
    for (const output of pauseOutputs) {
      if (output.type === "pause-started") {
        session.acceptPrompterPauseBoundary(output.silenceDurationMs);
      }
    }

    expect(pauseOutputs).toEqual([
      { type: "pause-started", atMs: 1_600, silenceDurationMs: 600 }
    ]);
    expect(session.getState().snapshot).toMatchObject({
      finalSentenceCommitted: true,
      prompterProgress: {
        currentSentenceId: null,
        committedSentenceIds: ["sentence_1", "sentence_2"],
        finalSentenceCommitted: true
      }
    });

    const speechSnapshot = session.getState().snapshot!;
    const controllerInput = {
      effectiveCoverage: speechSnapshot.effectiveCoverage,
      finalSentenceCommitted: speechSnapshot.finalSentenceCommitted === true,
      finalSentenceCommittedAtMs: 1_600,
      finalSentenceSpoken: speechSnapshot.finalSentenceSpoken,
      finalSentenceSpokenAtMs: 1_000,
      isLastSlide: false,
      mode: "rehearsal" as const,
      nowMs: 1_600,
      pause: detector.snapshot(1_600),
      policy: defaultAutoAdvancePolicy,
      remainingTriggerSteps: 0,
      slideId: "slide_1"
    };
    const countdown = evaluateAdvanceController(
      createInitialAdvanceControllerState(),
      controllerInput,
      defaultAutoAdvanceConfig
    );
    const advanced = evaluateAdvanceController(
      countdown.state,
      {
        ...controllerInput,
        nowMs: 3_600,
        pause: detector.snapshot(3_600)
      },
      defaultAutoAdvanceConfig
    );

    expect(countdown.state.status).toBe("countdown");
    expect(advanced.commands).toEqual([
      { type: "advance-slide", slideId: "slide_1" }
    ]);
  });

  it("동일 final dedupe 뒤에도 별도 pause boundary는 승계 candidate를 commit한다", async () => {
    const port = createMockLiveSttPort();
    const session = createP3RehearsalSession({
      slides,
      port,
      now: () => 100_000
    });
    const finalResult = p3CombinedFinalResult();

    await session.start({ audioSource: {} as MediaStream, slideIndex: 0 });
    port.emit(finalResult);
    port.emit({
      ...finalResult,
      timestampMs: [1_000, 1_000],
      resultRevision: 2
    });

    expect(session.getState().snapshot?.prompterProgress).toMatchObject({
      phase: "candidate",
      currentSentenceId: "sentence_2",
      committedSentenceIds: ["sentence_1"]
    });
    expect(session.acceptPrompterPauseBoundary(600)).toBe(true);
    expect(session.getState().snapshot?.prompterProgress).toMatchObject({
      currentSentenceId: null,
      committedSentenceIds: ["sentence_1", "sentence_2"],
      finalSentenceCommitted: true
    });
  });

  it("pause 없이 동일 final만 반복하면 다음 문장을 추가 commit하지 않는다", async () => {
    const port = createMockLiveSttPort();
    const session = createP3RehearsalSession({
      slides,
      port,
      now: () => 100_000
    });
    const finalResult = p3CombinedFinalResult();

    await session.start({ audioSource: {} as MediaStream, slideIndex: 0 });
    port.emit(finalResult);
    port.emit({ ...finalResult, resultRevision: 2 });
    port.emit({ ...finalResult, resultRevision: 3 });

    expect(session.getState().snapshot).toMatchObject({
      finalSentenceCommitted: false,
      prompterProgress: {
        revision: 1,
        phase: "candidate",
        currentSentenceId: "sentence_2",
        candidateSentenceId: "sentence_2",
        committedSentenceIds: ["sentence_1"],
        finalSentenceCommitted: false
      }
    });
  });

  it("다문장 final의 E5 결과를 같은 boundary로 재사용하지 않는다", async () => {
    const port = createMockLiveSttPort();
    const semanticMatcher = createMockSemanticMatcher({
      accepted: true,
      topMatches: [semanticMatch({ rank: 1, sentenceId: "sentence_2", sentenceIndex: 1 })]
    });
    const session = createP3RehearsalSession({
      slides,
      port,
      semanticMatcher,
      isSemanticMatchingEnabled: () => true,
      now: () => 100_000
    });

    await session.start({ audioSource: {} as MediaStream, slideIndex: 0 });
    port.emit(p3CombinedFinalResult());
    await flushSemanticQueue();

    expect(session.getState().snapshot?.prompterProgress).toMatchObject({
      revision: 1,
      phase: "candidate",
      currentSentenceId: "sentence_2",
      candidateSentenceId: "sentence_2",
      committedSentenceIds: ["sentence_1"],
      finalSentenceCommitted: false
    });
  });

  it("슬라이드 전환 후 도착한 이전 pause boundary를 새 슬라이드에 적용하지 않는다", async () => {
    const port = createMockLiveSttPort();
    const session = createP3RehearsalSession({
      slides,
      port,
      now: () => 100_000
    });

    await session.start({ audioSource: {} as MediaStream, slideIndex: 0 });
    port.emit({
      text: "생성형 AI 초안을 안정적으로 추적합니다",
      isFinal: false,
      timestampMs: [0, 800]
    });
    session.enterSlide(1);

    expect(session.acceptPrompterPauseBoundary(600)).toBe(false);
    expect(session.getState().snapshot).toMatchObject({
      slideId: "slide_2",
      prompterProgress: {
        revision: 1,
        currentSentenceId: "sentence_1",
        committedSentenceIds: []
      }
    });
  });

  it("사용자 일시정지를 제외한 활성 시간으로 녹음 길이와 슬라이드 타임라인을 기록한다", async () => {
    let nowMs = 1_000;
    const session = createP3RehearsalSession({
      slides,
      port: createMockLiveSttPort(),
      now: () => nowMs
    });

    await session.start({ audioSource: {} as MediaStream, slideIndex: 0 });
    nowMs = 11_000;
    await session.pause();
    nowMs = 21_000;
    await session.resume({ audioSource: {} as MediaStream });
    nowMs = 31_000;
    session.enterSlide(1);
    nowMs = 41_000;
    const meta = await session.stop();

    expect(meta.recordingDurationSeconds).toBe(30);
    expect(meta.slideTimeline).toEqual([
      { slideId: "slide_1", enteredAt: new Date(1_000).toISOString() },
      { slideId: "slide_2", enteredAt: new Date(21_000).toISOString() }
    ]);
  });

  it("finalizes active advice state into local run meta", async () => {
    const port = createMockLiveSttPort();
    const session = createP3RehearsalSession({
      slides,
      port,
      now: createNow([50_000, 51_000])
    });

    await session.start({
      audioSource: {} as MediaStream,
      slideIndex: 0
    });

    session.setAdviceState("pace-too-fast", true);
    session.setAdviceState("slide-overtime", true);

    const meta = await session.stop();

    expect(meta.adviceEvents.map((event) => event.type)).toEqual([
      "pace-too-fast",
      "slide-overtime"
    ]);
  });

  it("start와 slide enter에서 semantic slide index를 준비한다", async () => {
    const port = createMockLiveSttPort();
    const semanticMatcher = createMockSemanticMatcher({ accepted: false });
    const session = createP3RehearsalSession({
      slides,
      port,
      semanticMatcher,
      now: createNow([60_000, 61_000])
    });

    await session.start({
      audioSource: {} as MediaStream,
      slideIndex: 0
    });
    session.enterSlide(1);
    await flushSemanticQueue();

    expect(semanticMatcher.prepareSlide).toHaveBeenCalledWith({
      slideId: "slide_1",
      speakerNotes: slides[0].speakerNotes
    });
    expect(semanticMatcher.prepareSlide).toHaveBeenCalledWith({
      slideId: "slide_2",
      speakerNotes: slides[1].speakerNotes
    });
  });

  it("partial STT는 semantic matcher에 넣지 않고 final STT top 3만 debug에 반영한다", async () => {
    const port = createMockLiveSttPort();
    const debugStates: SemanticUtteranceDebugState[] = [];
    const semanticMatcher = createMockSemanticMatcher({
      accepted: true,
      topMatches: [semanticMatch({ rank: 1, sentenceId: "sentence_1" })]
    });
    const session = createP3RehearsalSession({
      slides,
      port,
      semanticMatcher,
      isSemanticMatchingEnabled: () => false,
      now: () => 70_000,
      onSemanticDebugState: (state) => debugStates.push(state)
    });

    await session.start({
      audioSource: {} as MediaStream,
      slideIndex: 0
    });
    port.emit({ text: "partial text", isFinal: false, timestampMs: [0, 500] });
    port.emit({
      text: "semantic final text",
      isFinal: true,
      timestampMs: [500, 1000]
    });
    await flushSemanticQueue();

    expect(semanticMatcher.matchFinalTranscript).toHaveBeenCalledTimes(1);
    expect(semanticMatcher.matchFinalTranscript).toHaveBeenCalledWith({
      slideId: "slide_1",
      transcript: "semantic final text",
      coveredSentenceIds: expect.any(Set)
    });
    expect(debugStates.at(-1)).toMatchObject({
      status: "ready",
      slideId: "slide_1",
      transcript: "semantic final text",
      isFinal: true,
      topMatches: [expect.objectContaining({ rank: 1, sentenceId: "sentence_1" })],
      error: null
    });
    expect(session.getState().snapshot).toMatchObject({
      sentenceCoverage: 0,
      finalSentenceSpoken: false
    });
  });

  it("semantic toggle on일 때 accepted final transcript를 coverage에 반영한다", async () => {
    const port = createMockLiveSttPort();
    const events: SpeechTrackingEvent[] = [];
    const semanticMatcher = createMockSemanticMatcher({
      accepted: true,
      topMatches: [semanticMatch({ rank: 1, sentenceId: "sentence_1" })]
    });
    const session = createP3RehearsalSession({
      slides,
      port,
      semanticMatcher,
      isSemanticMatchingEnabled: () => true,
      now: () => 80_000,
      onEvents: (nextEvents) => events.push(...nextEvents)
    });

    await session.start({
      audioSource: {} as MediaStream,
      slideIndex: 0
    });
    port.emit({
      text: "semantic final text",
      isFinal: true,
      timestampMs: [500, 1000]
    });
    await flushSemanticQueue();

    expect(events).toContainEqual({
      type: "sentence-covered",
      slideId: "slide_1",
      sentenceId: "sentence_1",
      matchKind: "paraphrased",
      similarity: 0.82,
      lexicalOverlap: 0.2,
      atMs: 1000
    });
    expect(session.getState().snapshot).toMatchObject({
      sentenceCoverage: 0.5,
      finalSentenceSpoken: false
    });
  });

  it("슬라이드 전환 후 완료된 이전 의미 판정을 새 슬라이드에 적용하지 않는다", async () => {
    const port = createMockLiveSttPort();
    const semanticMatcher = createMockSemanticMatcher({
      accepted: true,
      topMatches: [semanticMatch({ rank: 1, sentenceId: "sentence_1" })]
    });
    const originalMatchFinalTranscript = semanticMatcher.matchFinalTranscript;
    let releaseMatch!: () => void;
    semanticMatcher.matchFinalTranscript = vi.fn(async (input) => {
      await new Promise<void>((resolve) => {
        releaseMatch = resolve;
      });
      return originalMatchFinalTranscript(input);
    });
    const session = createP3RehearsalSession({
      slides,
      port,
      semanticMatcher,
      isSemanticMatchingEnabled: () => true,
      now: () => 80_000
    });

    await session.start({ audioSource: {} as MediaStream, slideIndex: 0 });
    port.emit({
      text: "semantic final text",
      isFinal: true,
      timestampMs: [500, 1_000]
    });
    await vi.waitFor(() => expect(releaseMatch).toBeTypeOf("function"));
    session.enterSlide(1);
    releaseMatch();
    await flushSemanticQueue();

    expect(session.getState().snapshot).toMatchObject({
      slideId: "slide_2",
      sentenceCoverage: 0,
      prompterProgress: {
        currentSentenceId: "sentence_1",
        committedSentenceIds: []
      }
    });
  });

  it("semantic rejected ad-lib final transcript is recorded without changing coverage", async () => {
    const port = createMockLiveSttPort();
    const events: SpeechTrackingEvent[] = [];
    const semanticMatcher = createMockSemanticMatcher({
      accepted: false,
      topMatches: [semanticMatch({ rank: 1, sentenceId: "sentence_1", similarity: 0.87 })],
      decision: semanticDecision({
        transcript: "고객 사례를 하나 더 말씀드리겠습니다.",
        reason: "ad-lib",
        outcome: "ad-lib",
        accepted: false,
        acceptedMatch: null
      })
    });
    const session = createP3RehearsalSession({
      slides,
      port,
      semanticMatcher,
      isSemanticMatchingEnabled: () => true,
      now: createNow([85_000, 86_000]),
      onEvents: (nextEvents) => events.push(...nextEvents)
    });

    await session.start({
      audioSource: {} as MediaStream,
      slideIndex: 0
    });
    port.emit({
      text: "고객 사례를 하나 더 말씀드리겠습니다.",
      isFinal: true,
      timestampMs: [500, 1000]
    });
    await flushSemanticQueue();

    expect(events).toContainEqual({
      type: "ad-lib-detected",
      slideId: "slide_1",
      text: "고객 사례를 하나 더 말씀드리겠습니다.",
      nearestSentenceId: "sentence_1",
      similarity: 0.87,
      atMs: 1000
    });
    expect(session.getState().snapshot).toMatchObject({
      sentenceCoverage: 0
    });

    const meta = await session.stop();
    expect(meta.utteranceOutcomes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slideId: "slide_1",
          kind: "ad-lib",
          text: "고객 사례를 하나 더 말씀드리겠습니다.",
          sentenceId: "sentence_1",
          similarity: 0.87
        }),
        expect.objectContaining({
          slideId: "slide_1",
          kind: "missed",
          sentenceId: "sentence_1"
        })
      ])
    );
  });

  it("semantic matcher 실패 시 기존 substring 기반 tracking은 계속 동작한다", async () => {
    const port = createMockLiveSttPort();
    const events: SpeechTrackingEvent[] = [];
    const debugStates: SemanticUtteranceDebugState[] = [];
    const semanticMatcher = createMockSemanticMatcher({ accepted: false });
    semanticMatcher.matchFinalTranscript = vi.fn(async () => {
      throw new Error("semantic unavailable");
    });
    const session = createP3RehearsalSession({
      slides,
      port,
      semanticMatcher,
      isSemanticMatchingEnabled: () => true,
      now: () => 90_000,
      onEvents: (nextEvents) => events.push(...nextEvents),
      onSemanticDebugState: (state) => debugStates.push(state)
    });

    await session.start({
      audioSource: {} as MediaStream,
      slideIndex: 0
    });
    port.emit({
      text: "생성형 AI 초안을 안정적으로 추적합니다.",
      isFinal: true,
      timestampMs: [500, 1000]
    });
    await flushSemanticQueue();

    expect(events).toContainEqual({
      type: "sentence-covered",
      slideId: "slide_1",
      sentenceId: "sentence_1",
      matchKind: "covered",
      atMs: 1000
    });
    expect(debugStates.at(-1)).toMatchObject({
      status: "error",
      slideId: "slide_1",
      transcript: "생성형 AI 초안을 안정적으로 추적합니다.",
      error: "semantic unavailable"
    });
    expect(session.getState().snapshot).toMatchObject({
      sentenceCoverage: 0.5
    });
  });

  it("exact phrase final transcript는 NLI 없이 basic cue decision을 기록한다", async () => {
    const port = createMockLiveSttPort();
    const provider = createMockSemanticCueNliProvider({
      scoresByCueId: {
        scue_cac_reason: {
          entailmentScore: 0.94,
          neutralScore: 0.05,
          contradictionScore: 0.01
        }
      }
    });
    const evaluate = vi.spyOn(provider, "evaluate");
    const session = createP3RehearsalSession({
      slides: semanticCueSlides,
      port,
      semanticMatcher: createMockSemanticMatcher({
        accepted: true,
        topMatches: [semanticMatch({ sentenceId: "sentence_1" })],
        decision: semanticDecision({
          accepted: true,
          acceptedMatch: semanticMatch({ sentenceId: "sentence_1" }),
          reason: "accepted-exact",
          outcome: "covered"
        })
      }),
      semanticCueRuntime: createSemanticCueRuntime({
        provider,
        enabled: true,
        now: () => 95_000
      }),
      isSemanticMatchingEnabled: () => true,
      now: createNow([95_000, 96_000])
    });

    await session.start({
      audioSource: {} as MediaStream,
      slideIndex: 0
    });
    port.emit({
      text: "CAC가 높은 원인은 초기 영업 비용입니다.",
      isFinal: true,
      timestampMs: [500, 1000]
    });
    await flushSemanticQueue();

    expect(evaluate).not.toHaveBeenCalled();
    expect(session.getState().semanticCueProgress).toEqual([
      expect.objectContaining({
        cueId: "scue_cac_reason",
        status: "covered",
        measurementMode: "basic",
        matchedBy: "lexical"
      })
    ]);
    expect((await session.stop()).semanticCueDecisions).toEqual([
      expect.objectContaining({
        cueId: "scue_cac_reason",
        label: "covered",
        matchedBy: "lexical",
        measurementMode: "basic",
        fallbackUsed: false
      })
    ]);
  });

  it("ad-lib final transcript는 mock NLI evidence를 meta와 debug event에만 기록한다", async () => {
    const port = createMockLiveSttPort();
    const debugEvents: SemanticCueDebugEvent[] = [];
    const session = createP3RehearsalSession({
      slides: semanticCueSlides,
      port,
      semanticMatcher: createMockSemanticMatcher({
        accepted: false,
        topMatches: [semanticMatch({ similarity: 0.87 })],
        decision: semanticDecision({
          transcript: "처음엔 세일즈에 돈이 많이 들어 고객 한 명 데려오는 비용이 컸습니다",
          reason: "ad-lib",
          outcome: "ad-lib",
          accepted: false,
          acceptedMatch: null
        })
      }),
      semanticCueRuntime: createSemanticCueRuntime({
        provider: createMockSemanticCueNliProvider({
          scoresByCueId: {
            scue_cac_reason: {
              entailmentScore: 0.94,
              neutralScore: 0.05,
              contradictionScore: 0.01
            }
          }
        }),
        enabled: true,
        now: () => 97_000
      }),
      isSemanticMatchingEnabled: () => true,
      now: createNow([97_000, 98_000]),
      onSemanticCueDebugEvent: (event) => debugEvents.push(event)
    });

    await session.start({
      audioSource: {} as MediaStream,
      slideIndex: 0
    });
    port.emit({
      text: "처음엔 세일즈에 돈이 많이 들어 고객 한 명 데려오는 비용이 컸습니다",
      isFinal: true,
      timestampMs: [500, 1000]
    });
    const meta = await session.stop();

    expect(session.getState().snapshot).toMatchObject({
      sentenceCoverage: 0
    });
    expect(debugEvents.at(-1)).toMatchObject({
      slideId: "slide_1",
      decision: {
        cueId: "scue_cac_reason",
        label: "covered",
        reasonCodes: expect.arrayContaining(["nli-entailment"])
      },
      actionGate: {
        allowed: false,
        blockedReasons: ["nli-cannot-advance-slide-alone"]
      }
    });

    expect(meta.semanticCueDecisions).toEqual([
      expect.objectContaining({
        slideId: "slide_1",
        cueId: "scue_cac_reason",
        label: "covered",
        provider: "mock",
        premise: "처음엔 세일즈에 돈이 많이 들어 고객 한 명 데려오는 비용이 컸습니다"
      })
    ]);
  });

  it("두 final segment를 같은 의미 근거 window로 결합한다", async () => {
    const port = createMockLiveSttPort();
    const runtime = createSemanticCueRuntime({
      provider: createMockSemanticCueNliProvider(),
      enabled: true
    });
    const evaluate = vi.spyOn(runtime, "evaluateFinalResult");
    const session = createP3RehearsalSession({
      slides: semanticCueSlides,
      port,
      semanticCueRuntime: runtime,
      isSemanticMatchingEnabled: () => true,
      now: () => 99_000
    });

    await session.start({ audioSource: {} as MediaStream, slideIndex: 0 });
    port.emit({
      text: "CAC가 높은 원인은",
      isFinal: true,
      timestampMs: [0, 2_000]
    });
    port.emit({
      text: "초기 영업 비용입니다.",
      isFinal: true,
      timestampMs: [2_100, 4_000]
    });
    await session.stop();

    expect(evaluate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        transcript: "CAC가 높은 원인은 초기 영업 비용입니다.",
        evidenceStartMs: 0,
        evidenceEndMs: 4_000
      })
    );
  });

  it("슬라이드 전환 직전 대기 중인 의미 판정 근거를 보존한다", async () => {
    const port = createMockLiveSttPort();
    const session = createP3RehearsalSession({
      slides: [semanticCueSlides[0]!, slides[1]!],
      port,
      semanticCueRuntime: createSemanticCueRuntime({
        provider: createMockSemanticCueNliProvider({
          scoresByCueId: {
            scue_cac_reason: {
              entailmentScore: 0.94,
              neutralScore: 0.05,
              contradictionScore: 0.01
            }
          }
        }),
        enabled: true,
        embeddingIndex: {
          prepareSlide: vi.fn(async (input) => ({
            slideId: input.slideId,
            signature: "test",
            cueCount: input.cues.length,
            vectorCount: input.cues.length
          })),
          retrieveScores: vi.fn(async () => new Map([["scue_cac_reason", 0.9]]))
        }
      }),
      isSemanticMatchingEnabled: () => true,
      now: () => 100_000
    });

    await session.start({ audioSource: {} as MediaStream, slideIndex: 0 });
    port.emit({
      text: "처음엔 세일즈에 돈이 많이 들어 고객 한 명 데려오는 비용이 컸습니다",
      isFinal: true,
      timestampMs: [500, 1_000]
    });
    session.enterSlide(1);
    await flushSemanticQueue();

    expect((await session.stop()).semanticCueDecisions).toEqual([
      expect.objectContaining({
        slideId: "slide_1",
        cueId: "scue_cac_reason",
        label: "covered"
      })
    ]);
  });

  it("의미 판정 queue timeout을 affected cue와 함께 구분해 기록한다", async () => {
    const port = createMockLiveSttPort();
    const session = createP3RehearsalSession({
      slides: semanticCueSlides,
      port,
      semanticCueRuntime: {
        prepareSlide: vi.fn(async () => undefined),
        evaluateFinalResult: vi.fn(async () => await new Promise<never>(() => undefined))
      },
      isSemanticMatchingEnabled: () => true,
      semanticQueueFlushTimeoutMs: 5,
      now: () => 101_000
    });

    await session.start({ audioSource: {} as MediaStream, slideIndex: 0 });
    port.emit({
      text: "대기 중인 의미 근거",
      isFinal: true,
      timestampMs: [0, 1_000]
    });
    const meta = await session.stop();

    expect(session.getState().semanticCueProgress).toEqual([
      expect.objectContaining({
        cueId: "scue_cac_reason",
        status: "unmeasured",
        measurementMode: "none"
      })
    ]);

    expect(meta.semanticCapabilityEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capability: "semantic_runtime",
          toState: "degraded",
          reason: "queue_dropped",
          slideId: "slide_1",
          cueIds: ["scue_cac_reason"]
        })
      ])
    );
    expect(JSON.stringify(meta.semanticCapabilityEvents)).not.toContain("대기 중인 의미 근거");
  });

  it("semantic runtime 예외를 STT 실패와 다른 capability reason으로 기록한다", async () => {
    const port = createMockLiveSttPort();
    const session = createP3RehearsalSession({
      slides: semanticCueSlides,
      port,
      semanticCueRuntime: {
        prepareSlide: vi.fn(async () => undefined),
        evaluateFinalResult: vi.fn(async () => {
          throw new Error("unexpected runtime failure");
        })
      },
      isSemanticMatchingEnabled: () => true,
      now: () => 101_500
    });

    await session.start({ audioSource: {} as MediaStream, slideIndex: 0 });
    port.emit({
      text: "의미 판정 입력",
      isFinal: true,
      timestampMs: [0, 1_000]
    });
    const meta = await session.stop();

    expect(meta.semanticCapabilityEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capability: "semantic_runtime",
          fromState: "available",
          toState: "unavailable",
          reason: "runtime_error",
          measurementMode: "none"
        })
      ])
    );
  });

  it("approved stale cue를 판정에서 제외하고 freshness capability에 남긴다", async () => {
    const port = createMockLiveSttPort();
    const session = createP3RehearsalSession({
      slides: [
        {
          slideId: "slide_1",
          speakerNotes: "",
          keywords: [],
          semanticCues: [semanticCue({ freshness: "stale" })]
        }
      ],
      port,
      semanticCueRuntime: createSemanticCueRuntime({ enabled: false }),
      isSemanticMatchingEnabled: () => true,
      now: () => 101_750
    });

    await session.start({ audioSource: {} as MediaStream, slideIndex: 0 });
    const meta = await session.stop();

    expect(meta.semanticCueDecisions).toEqual([]);
    expect(session.getState().semanticCueProgress).toEqual([]);
    expect(meta.semanticCapabilityEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capability: "cue_freshness",
          fromState: "available",
          toState: "degraded",
          reason: "stale_cue",
          measurementMode: "none",
          cueIds: ["scue_1"]
        })
      ])
    );
  });

  it("notes와 keyword와 sentence matcher 없이 cue E5 top-k를 준비해 NLI 후보를 만든다", async () => {
    const port = createMockLiveSttPort();
    const debugEvents: SemanticCueDebugEvent[] = [];
    const provider = createMockSemanticCueNliProvider({
      scoresByCueId: {
        scue_rsp: {
          entailmentScore: 0.93,
          neutralScore: 0.05,
          contradictionScore: 0.02
        }
      }
    });
    const evaluate = vi.spyOn(provider, "evaluate");
    const embedPassages = vi.fn(async (texts: readonly string[]) =>
      texts.map(() => new Float32Array([1, 0]))
    );
    const embeddingIndex = createSemanticCueEmbeddingIndex({
      embeddingService: {
        embedQuery: vi.fn(async () => new Float32Array([1, 0])),
        embedPassages
      }
    });
    const session = createP3RehearsalSession({
      slides: [
        {
          slideId: "slide_1",
          speakerNotes: "",
          keywords: [],
          semanticCues: [
            semanticCue({
              cueId: "scue_rsp",
              meaning: "RSP가 런타임에서 파일 쓰기를 차단합니다",
              requiredConcepts: ["RSP", "파일 쓰기 차단"]
            })
          ]
        }
      ],
      port,
      semanticCueRuntime: createSemanticCueRuntime({
        provider,
        enabled: true,
        embeddingIndex,
        now: () => 100_000
      }),
      isSemanticMatchingEnabled: () => true,
      now: createNow([100_000, 101_000]),
      onSemanticCueDebugEvent: (event) => debugEvents.push(event)
    });

    await session.start({
      audioSource: {} as MediaStream,
      slideIndex: 0
    });
    expect(embedPassages.mock.invocationCallOrder[0]).toBeLessThan(
      (port.start as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0] ?? 0
    );
    port.emit({
      text: "실행 중에는 파일을 쓰지 못하도록 막는 정책입니다",
      isFinal: true,
      timestampMs: [500, 1_000]
    });
    await flushSemanticQueue();

    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(debugEvents.at(-1)).toMatchObject({
      candidates: [
        expect.objectContaining({
          cueId: "scue_rsp",
          embeddingScore: 1,
          selectedForNli: true
        })
      ],
      decision: {
        cueId: "scue_rsp",
        label: "covered"
      }
    });
  });

  it("NLI provider가 없어도 cue E5 후보를 계산하되 provisional decision은 만들지 않는다", async () => {
    const port = createMockLiveSttPort();
    const debugEvents: SemanticCueDebugEvent[] = [];
    const embeddingIndex = createSemanticCueEmbeddingIndex({
      embeddingService: {
        embedQuery: vi.fn(async () => new Float32Array([1, 0])),
        embedPassages: vi.fn(async (texts: readonly string[]) =>
          texts.map(() => new Float32Array([1, 0]))
        )
      }
    });
    const session = createP3RehearsalSession({
      slides: [
        {
          slideId: "slide_1",
          speakerNotes: "",
          keywords: [],
          semanticCues: [semanticCue({ cueId: "scue_basic_rsp" })]
        }
      ],
      port,
      semanticCueRuntime: createSemanticCueRuntime({
        enabled: false,
        embeddingIndex
      }),
      isSemanticMatchingEnabled: () => true,
      now: createNow([101_000, 102_000]),
      onSemanticCueDebugEvent: (event) => debugEvents.push(event)
    });

    await session.start({
      audioSource: {} as MediaStream,
      slideIndex: 0
    });
    port.emit({
      text: "파일 쓰기 차단 정책을 설명합니다",
      isFinal: true,
      timestampMs: [500, 1_000]
    });
    await flushSemanticQueue();

    expect(debugEvents.at(-1)).toMatchObject({
      candidates: [
        expect.objectContaining({
          cueId: "scue_basic_rsp",
          embeddingScore: 1
        })
      ],
      decision: {
        label: "no_candidate",
        reasonCodes: ["user_disabled"]
      }
    });
    const meta = await session.stop();
    expect(meta.semanticCueDecisions).toEqual([]);
    expect(meta.semanticCapabilityEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capability: "nli",
          fromState: "available",
          toState: "unavailable",
          reason: "user_disabled",
          measurementMode: "none"
        })
      ])
    );
  });

  it("semantic matching이 꺼져 있으면 cue embedding index를 prewarm하지 않는다", async () => {
    const prepareSlide = vi.fn(async () => ({
      slideId: "slide_1",
      signature: "disabled",
      cueCount: 1,
      vectorCount: 1
    }));
    const session = createP3RehearsalSession({
      slides: [
        {
          slideId: "slide_1",
          speakerNotes: "",
          keywords: [],
          semanticCues: [semanticCue({ cueId: "scue_disabled" })]
        }
      ],
      port: createMockLiveSttPort(),
      semanticCueRuntime: createSemanticCueRuntime({
        enabled: false,
        embeddingIndex: {
          prepareSlide,
          retrieveScores: vi.fn(async () => new Map())
        }
      }),
      isSemanticMatchingEnabled: () => false,
      now: () => 102_000
    });

    await session.start({
      audioSource: {} as MediaStream,
      slideIndex: 0
    });

    expect(prepareSlide).not.toHaveBeenCalled();
  });
});

const slides: P3RehearsalSessionSlide[] = [
  {
    slideId: "slide_1",
    speakerNotes: "생성형 AI 초안을 안정적으로 추적합니다. 마지막으로 개인정보를 보호합니다.",
    keywords: [
      {
        keywordId: "kw_ai",
        text: "생성형 AI",
        synonyms: [],
        abbreviations: ["AI"]
      }
    ],
    controlPhrases: ["다음 슬라이드"],
    legacyPhrases: ["레거시 본문"]
  },
  {
    slideId: "slide_2",
    speakerNotes: "프라이버시 기준을 설명합니다.",
    keywords: [
      {
        keywordId: "kw_privacy",
        text: "프라이버시",
        synonyms: ["개인정보"],
        abbreviations: []
      }
    ],
    controlPhrases: ["다음 슬라이드"]
  }
];

function p3CombinedFinalResult(): LiveSttResult {
  return {
    text: "생성형 AI 초안을 안정적으로 추적합니다 마지막으로 개인정보를 보호합니다",
    isFinal: true,
    timestampMs: [0, 1_000],
    utteranceId: "utterance_1",
    resultRevision: 1
  };
}

const semanticCueSlides: P3RehearsalSessionSlide[] = [
  {
    slideId: "slide_1",
    speakerNotes: "CAC가 높은 원인은 초기 영업 비용입니다.",
    keywords: [
      {
        keywordId: "kw_cac",
        text: "CAC",
        synonyms: ["고객 획득 비용"],
        abbreviations: []
      }
    ],
    semanticCues: [
      {
        cueId: "scue_cac_reason",
        slideId: "slide_1",
        meaning: "CAC가 높은 원인은 초기 영업 비용입니다",
        importance: "supporting",
        reviewStatus: "approved",
        freshness: "current",
        origin: "imported",
        revision: 1,
        sourceRefs: [],
        qualityWarnings: [],
        required: true,
        priority: 1,
        candidateKeywords: ["CAC", "세일즈"],
        aliases: {
          CAC: ["고객 획득 비용"]
        },
        requiredConcepts: ["영업 비용", "고객 획득 비용"],
        nliHypotheses: ["고객 획득 비용이 초기 영업 비용 때문에 높다"],
        negativeHints: [],
        targetElementIds: [],
        triggerActionIds: []
      }
    ]
  }
];

function semanticCue(overrides: Partial<SemanticCue> = {}): SemanticCue {
  return {
    cueId: "scue_1",
    slideId: "slide_1",
    meaning: "기술 정책을 설명합니다",
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
    nliHypotheses: ["발표자는 기술 정책을 설명했다"],
    negativeHints: [],
    targetElementIds: [],
    triggerActionIds: [],
    ...overrides
  };
}

function createMockLiveSttPort(overrides: Partial<LiveSttPort> = {}) {
  const resultSubscribers = new Set<(result: LiveSttResult) => void>();
  const errorSubscribers = new Set<(error: LiveSttError) => void>();
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
    onError: vi.fn((cb: (error: LiveSttError) => void) => {
      errorSubscribers.add(cb);
      return () => errorSubscribers.delete(cb);
    }),
    dispose: vi.fn(),
    emit(result: LiveSttResult) {
      for (const subscriber of resultSubscribers) {
        subscriber(result);
      }
    },
    emitError(error: LiveSttError) {
      for (const subscriber of errorSubscribers) {
        subscriber(error);
      }
    },
    ...overrides
  };

  return port as LiveSttPort & {
    emit: (result: LiveSttResult) => void;
    emitError: (error: LiveSttError) => void;
  };
}

function createNow(values: number[]) {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)] ?? 0;
}

function createMockSemanticMatcher(options: {
  accepted: boolean;
  topMatches?: SemanticUtteranceMatch[];
  decision?: SemanticUtteranceDecision | null;
}): SemanticUtteranceMatcher {
  return {
    prepareSlide: vi.fn(async (input) => ({
      slideId: input.slideId,
      speakerNotesHash: input.speakerNotes,
      modelId: "Xenova/multilingual-e5-small" as const,
      dimensions: 384 as const,
      sentences: [],
      builtAtMs: 0
    })),
    matchFinalTranscript: vi.fn(async () => ({
      accepted: options.accepted,
      topMatches: options.topMatches ?? [],
      decision:
        options.decision ??
        (options.accepted
          ? semanticDecision({
              accepted: true,
              acceptedMatch: options.topMatches?.[0] ?? semanticMatch({}),
              reason: "accepted-paraphrase",
              outcome: "paraphrased"
            })
          : null)
    }))
  };
}

function semanticMatch(override: Partial<SemanticUtteranceMatch>): SemanticUtteranceMatch {
  return {
    rank: 1,
    sentenceId: "sentence_1",
    sentenceIndex: 0,
    text: "Semantic sentence.",
    similarity: 0.82,
    covered: false,
    ...override
  };
}

function semanticDecision(override: Partial<SemanticUtteranceDecision>): SemanticUtteranceDecision {
  const topMatches = [semanticMatch({ similarity: 0.87 })];
  return {
    accepted: false,
    slideId: "slide_1",
    transcript: "semantic final text",
    isFinal: true,
    topMatches,
    acceptedMatch: null,
    reason: "ad-lib",
    outcome: "ad-lib",
    scoreThreshold: 0.89,
    ambiguousMargin: 0.04,
    lexicalOverlap: 0.2,
    ...override
  };
}

async function flushSemanticQueue() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}
