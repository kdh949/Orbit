import type {
  RehearsalRunMeta,
  RehearsalSemanticCueDecision,
  SemanticCapabilityEvent,
  SemanticCue,
  SemanticCueImportance,
  SemanticMeasurementMode,
  PronunciationLexiconEntry,
} from "@orbit/shared";

import type {
  LiveSttBiasPhrase,
  LiveSttPort,
  LiveSttResult
} from "../stt/liveSttPort";
import { createDefaultPhraseExtractor } from "./phraseExtractor";
import { buildSpeechTrackingBiasPhrases } from "./speechBiasPhrases";
import {
  createRehearsalLogCollector,
  type RehearsalLogCollector
} from "./rehearsalLogCollector";
import {
  defaultSpeechTrackingConfig,
  type AdviceEventType,
  type SpeechTrackingConfigOverride
} from "./speechTrackingConfig";
import type { SpeechTrackerKeyword } from "./speechTracker";
import { createSpeechTracker, type SpeechTracker } from "./speechTracker";
import {
  createSemanticDebugState,
  semanticDebugErrorMessage,
  type SemanticUtteranceDebugState
} from "./semanticSpeechDebug";
import type { SemanticMatchDecisionReason } from "./semanticUtteranceDecision";
import type { SemanticUtteranceMatcher } from "./semanticUtteranceMatcher";
import type { SemanticCueDebugEvent } from "./semanticCueDebugEvents";
import type { SemanticCueRuntime } from "./semanticCueRuntime";
import { createSemanticEvidenceWindow } from "./semanticEvidenceWindow";
import {
  createSemanticCapabilityState,
  type SemanticCapabilityStatuses,
  type SemanticCapabilityTransition
} from "./semanticCapabilityState";
import type { SpeechTrackerSnapshot, SpeechTrackingEvent } from "./speechTrackingEvents";

export type P3RehearsalSessionSlide = {
  slideId: string;
  speakerNotes: string;
  keywords: readonly SpeechTrackerKeyword[];
  semanticCues?: readonly SemanticCue[];
  controlPhrases?: readonly string[];
  cuePhrases?: readonly string[];
  legacyPhrases?: readonly string[];
  pronunciationEntries?: readonly PronunciationLexiconEntry[];
};

export type P3RehearsalSessionState = {
  status: "idle" | "starting" | "running" | "paused" | "stopped" | "failed";
  slideIndex: number;
  startedAtMs: number | null;
  slideEnteredAtMs: number | null;
  snapshot: SpeechTrackerSnapshot | null;
  finalSegments: LiveSttResult[];
  runMeta: RehearsalRunMeta | null;
  capabilityStatuses: SemanticCapabilityStatuses;
  semanticCueProgress: P3SemanticCueProgressItem[];
};

export type P3SemanticCueProgressStatus =
  | "waiting"
  | "covered"
  | "needs-review"
  | "unmeasured";

export type P3SemanticCueProgressItem = {
  cueId: string;
  slideId: string;
  label: string;
  importance: SemanticCueImportance;
  status: P3SemanticCueProgressStatus;
  measurementMode: SemanticMeasurementMode;
  matchedBy?: RehearsalSemanticCueDecision["matchedBy"];
};

export type CreateP3RehearsalSessionInput = {
  slides: readonly P3RehearsalSessionSlide[];
  port: LiveSttPort;
  threshold?: number;
  config?: SpeechTrackingConfigOverride;
  now?: () => number;
  onEvents?: (events: SpeechTrackingEvent[]) => void;
  onSnapshot?: (snapshot: SpeechTrackerSnapshot) => void;
  semanticMatcher?: SemanticUtteranceMatcher;
  semanticCueRuntime?: SemanticCueRuntime;
  isSemanticMatchingEnabled?: () => boolean;
  onSemanticDebugState?: (state: SemanticUtteranceDebugState) => void;
  onSemanticCueDebugEvent?: (event: SemanticCueDebugEvent) => void;
  onSemanticCapabilityEvent?: (event: SemanticCapabilityEvent) => void;
  semanticQueueFlushTimeoutMs?: number;
};

export type P3RehearsalSession = {
  start: (options: {
    audioSource: MediaStream;
    slideIndex?: number;
  }) => Promise<P3RehearsalSessionState>;
  pause: () => Promise<P3RehearsalSessionState>;
  resume: (options: { audioSource: MediaStream }) => Promise<P3RehearsalSessionState>;
  enterSlide: (slideIndex: number) => SpeechTrackingEvent[];
  acceptResult: (result: LiveSttResult) => SpeechTrackingEvent[];
  acceptPrompterPauseBoundary: (silenceDurationMs: number) => boolean;
  setAdviceState: (type: AdviceEventType, active: boolean) => void;
  stop: () => Promise<RehearsalRunMeta>;
  getState: () => P3RehearsalSessionState;
};

export function createP3RehearsalSession(
  input: CreateP3RehearsalSessionInput
): P3RehearsalSession {
  const now = input.now ?? (() => Date.now());
  let currentNowMs = 0;
  const getNowMs = () => {
    currentNowMs = now();
    return currentNowMs;
  };
  let totalPausedMs = 0;
  let pausedAtMs: number | null = null;
  const toActiveTimestampMs = (rawTimestampMs: number) =>
    rawTimestampMs -
    totalPausedMs -
    (pausedAtMs === null ? 0 : Math.max(rawTimestampMs - pausedAtMs, 0));
  const collector = createRehearsalLogCollector({
    slides: input.slides.map((slide) => ({
      slideId: slide.slideId,
      keywordIds: slide.keywords.map((keyword) => keyword.keywordId),
      matchableSentenceIds: getMatchableSentenceIdsForSlide(slide, input.config)
    })),
    now: () => {
      const rawTimestampMs = currentNowMs || now();
      return new Date(toActiveTimestampMs(rawTimestampMs));
    },
    adviceReentryCooldownMs:
      input.config?.adviceReentryCooldownMs ??
      defaultSpeechTrackingConfig.adviceReentryCooldownMs
  });
  const trackers = new Map<number, SpeechTracker>();
  const capabilityState = createSemanticCapabilityState({
    now: () => currentNowMs
  });
  const finalSegments: LiveSttResult[] = [];
  let status: P3RehearsalSessionState["status"] = "idle";
  let slideIndex = 0;
  let startedAtMs: number | null = null;
  let slideEnteredAtMs: number | null = null;
  let currentTracker: SpeechTracker | null = null;
  let runMeta: RehearsalRunMeta | null = null;
  let cleanupSubscriptions: (() => void) | null = null;
  let semanticGeneration = 0;
  let semanticQueue: Promise<void> = Promise.resolve();
  const closingSemanticGenerations = new Set<number>();
  const semanticEvidenceWindow = createSemanticEvidenceWindow();
  const semanticCueProgressBySlideId = new Map<
    string,
    Map<string, P3SemanticCueProgressItem>
  >();
  const semanticPrepareBySlideId = new Map<string, Promise<void>>();
  const semanticCuePrepareBySlideId = new Map<string, Promise<void>>();
  let resultTimestampOffsetMs = 0;
  let lastAcceptedResultEndMs = 0;

  function subscribeToPort() {
    cleanupSubscriptions?.();
    const unsubscribeResult = input.port.onResult(acceptResult);
    const unsubscribeError = input.port.onError((error) => {
      transitionCapability({
        capability: "stt",
        toState: "unavailable",
        reason: error.code === "permission_denied" ? "permission_denied" : "stt_unavailable",
        measurementMode: "none",
        retryable: error.code !== "permission_denied",
        slideId: getSlide(slideIndex).slideId,
        cueIds: (getSlide(slideIndex).semanticCues ?? []).map((cue) => cue.cueId)
      });
      status = "failed";
      cleanupSubscriptions?.();
    });
    cleanupSubscriptions = () => {
      unsubscribeResult();
      unsubscribeError();
      cleanupSubscriptions = null;
    };
  }

  async function start(options: {
    audioSource: MediaStream;
    slideIndex?: number;
  }): Promise<P3RehearsalSessionState> {
    slideIndex = options.slideIndex ?? 0;
    const slide = getSlide(slideIndex);
    status = "starting";
    runMeta = null;
    totalPausedMs = 0;
    pausedAtMs = null;
    finalSegments.length = 0;
    const startRequestedAt = getNowMs();
    resultTimestampOffsetMs = 0;
    lastAcceptedResultEndMs = 0;
    scheduleSemanticCuePrewarm(slideIndex);
    transitionCapability({
      capability: "stt",
      toState: "degraded",
      reason: "model_not_ready",
      measurementMode: "none",
      retryable: true,
      slideId: slide.slideId,
      cueIds: []
    });

    try {
      subscribeToPort();

      await input.port.start({
        language: "ko",
        audioSource: options.audioSource,
        biasPhrases: buildBiasPhrasesForSlideIndex(slideIndex)
      });
    } catch (error) {
      transitionCapability({
        capability: "stt",
        toState: "unavailable",
        reason: "stt_unavailable",
        measurementMode: "none",
        retryable: true,
        slideId: slide.slideId,
        cueIds: []
      });
      status = "failed";
      startedAtMs = null;
      slideEnteredAtMs = null;
      currentTracker = null;
      cleanupSubscriptions?.();
      throw error;
    }

    const startedAt = startRequestedAt;
    startedAtMs = startedAt;
    slideEnteredAtMs = startedAt;
    currentTracker = getTracker(slideIndex);
    collector.enterSlide(slide.slideId);
    status = "running";
    transitionCapability({
      capability: "stt",
      toState: "available",
      measurementMode: "full",
      retryable: false,
      slideId: slide.slideId,
      cueIds: []
    });
    semanticGeneration += 1;
    scheduleSemanticPrepare(slideIndex, semanticGeneration);
    emitSnapshot();
    return getState();
  }

  async function pause(): Promise<P3RehearsalSessionState> {
    if (status !== "running") {
      return getState();
    }

    pausedAtMs = getNowMs();
    status = "paused";
    semanticGeneration += 1;
    cleanupSubscriptions?.();
    await input.port.stop();
    emitSnapshot();
    return getState();
  }

  async function resume(options: {
    audioSource: MediaStream;
  }): Promise<P3RehearsalSessionState> {
    if (status !== "paused") {
      return getState();
    }

    const slide = getSlide(slideIndex);
    finishPause(getNowMs());
    resultTimestampOffsetMs = lastAcceptedResultEndMs;
    status = "starting";
    try {
      subscribeToPort();
      await input.port.start({
        language: "ko",
        audioSource: options.audioSource,
        biasPhrases: buildBiasPhrasesForSlide(slide, input.config)
      });
    } catch (error) {
      status = "paused";
      pausedAtMs = getNowMs();
      cleanupSubscriptions?.();
      throw error;
    }

    status = "running";
    semanticGeneration += 1;
    scheduleSemanticPrepare(slideIndex, semanticGeneration);
    emitSnapshot();
    return getState();
  }

  function enterSlide(nextSlideIndex: number): SpeechTrackingEvent[] {
    if (status !== "running") {
      return [];
    }

    const events: SpeechTrackingEvent[] = [];
    const closingSlideIndex = slideIndex;
    const closingGeneration = semanticGeneration;
    closingSemanticGenerations.add(closingGeneration);
    void flushSemanticQueueForSlide(closingSlideIndex).finally(
      () => closingSemanticGenerations.delete(closingGeneration)
    );
    const atMs = getRelativeNowMs();
    if (currentTracker) {
      events.push(...currentTracker.exitSlide(atMs));
    }

    scheduleSemanticCuePrewarm(nextSlideIndex);
    slideIndex = nextSlideIndex;
    const slide = getSlide(slideIndex);
    currentTracker = getTracker(slideIndex);
    currentTracker.resetForSlideVisit();
    slideEnteredAtMs = getNowMs();
    collector.enterSlide(slide.slideId);
    input.port.updateBiasPhrases(buildBiasPhrasesForSlideIndex(slideIndex));
    semanticGeneration += 1;
    scheduleSemanticPrepare(slideIndex, semanticGeneration);
    applyEventsToLog(events, collector);
    if (events.length > 0) {
      input.onEvents?.(events);
    }
    emitSnapshot();
    return events;
  }

  function acceptResult(result: LiveSttResult): SpeechTrackingEvent[] {
    if (status !== "running" || !currentTracker) {
      return [];
    }

    const normalizedResult = normalizeResultTimestamp(result);
    if (result.isFinal) {
      finalSegments.push(normalizedResult);
      transitionCapability({
        capability: "transcript_evidence",
        toState: "available",
        measurementMode: "full",
        retryable: false,
        slideId: getSlide(slideIndex).slideId,
        cueIds: []
      });
    }

    const events = currentTracker.acceptResult(normalizedResult);
    applyEventsToLog(events, collector);
    if (events.length > 0) {
      input.onEvents?.(events);
    }
    if (result.isFinal) {
      const evidence = semanticEvidenceWindow.accept(
        getSlide(slideIndex).slideId,
        normalizedResult
      );
      enqueueSemanticFinalResult({
        result: {
          ...normalizedResult,
          text: evidence.transcript,
          timestampMs: [evidence.startMs, evidence.endMs]
        },
        resultSlideIndex: slideIndex,
        tracker: currentTracker,
        prompterRevision:
          currentTracker.snapshot().prompterProgress?.revision ?? 0,
        generation: semanticGeneration,
        phraseMatched: events.some((event) => event.type === "sentence-covered"),
        keywordCoverage: calculateKeywordCoverage(currentTracker.snapshot(), getSlide(slideIndex))
      });
    }
    emitSnapshot();
    return events;
  }

  function acceptPrompterPauseBoundary(silenceDurationMs: number) {
    if (status !== "running" || !currentTracker) {
      return false;
    }
    const committed = currentTracker.acceptPrompterBoundary({
      type: "pause-started",
      atMs: lastAcceptedResultEndMs + Math.max(silenceDurationMs, 0)
    });
    if (committed) {
      emitSnapshot();
    }
    return committed;
  }

  function setAdviceState(type: AdviceEventType, active: boolean) {
    collector.setAdviceState(type, active);
  }

  async function stop() {
    const stoppedAtMs = getNowMs();
    finishPause(stoppedAtMs);
    cleanupSubscriptions?.();
    await input.port.stop();
    await flushSemanticQueueForSlide(slideIndex);
    status = "stopped";
    semanticGeneration += 1;
    runMeta = {
      ...collector.finalize(),
      recordingDurationSeconds:
        startedAtMs === null
          ? null
          : Math.max((stoppedAtMs - startedAtMs - totalPausedMs) / 1000, 0)
    };
    return runMeta;
  }

  function getState(): P3RehearsalSessionState {
    return {
      status,
      slideIndex,
      startedAtMs,
      slideEnteredAtMs,
      snapshot: currentTracker?.snapshot() ?? null,
      finalSegments: [...finalSegments],
      runMeta,
      capabilityStatuses: capabilityState.snapshot(),
      semanticCueProgress: getSemanticCueProgress(getSlide(slideIndex))
    };
  }

  function getSemanticCueProgress(slide: P3RehearsalSessionSlide) {
    let progress = semanticCueProgressBySlideId.get(slide.slideId);
    if (!progress) {
      progress = new Map(
        (slide.semanticCues ?? [])
          .filter(
            (cue) =>
              cue.reviewStatus === "approved" && cue.freshness === "current"
          )
          .map((cue) => [cue.cueId, createWaitingSemanticCueProgress(cue)])
      );
      semanticCueProgressBySlideId.set(slide.slideId, progress);
    }
    return [...progress.values()];
  }

  function applySemanticCueDecisions(
    slide: P3RehearsalSessionSlide,
    decisions: readonly RehearsalSemanticCueDecision[]
  ) {
    const progress = new Map(
      getSemanticCueProgress(slide).map((item) => [item.cueId, item])
    );
    for (const decision of decisions) {
      const current = progress.get(decision.cueId);
      if (!current || current.status === "covered") {
        continue;
      }
      progress.set(decision.cueId, {
        ...current,
        status: semanticCueProgressStatus(decision),
        measurementMode: decision.measurementMode,
        matchedBy: decision.matchedBy
      });
    }
    semanticCueProgressBySlideId.set(slide.slideId, progress);
  }

  function markSemanticCueProgressUnmeasured(slide: P3RehearsalSessionSlide) {
    const progress = new Map(
      getSemanticCueProgress(slide).map((item) => [
        item.cueId,
        item.status === "covered"
          ? item
          : {
              ...item,
              status: "unmeasured" as const,
              measurementMode: "none" as const,
              matchedBy: undefined
            }
      ])
    );
    semanticCueProgressBySlideId.set(slide.slideId, progress);
  }

  function getTracker(index: number) {
    const current = trackers.get(index);
    if (current) {
      return current;
    }

    const slide = getSlide(index);
    const tracker = createSpeechTracker({
      slideId: slide.slideId,
      speakerNotes: slide.speakerNotes,
      keywords: slide.keywords,
      controlPhrases: slide.controlPhrases,
      pronunciationEntries: slide.pronunciationEntries,
      threshold: input.threshold,
      config: input.config
    });
    trackers.set(index, tracker);
    return tracker;
  }

  function emitSnapshot() {
    const snapshot = currentTracker?.snapshot();
    if (snapshot) {
      input.onSnapshot?.(snapshot);
    }
  }

  function getRelativeNowMs() {
    const base = startedAtMs ?? getNowMs();
    return Math.max(toActiveTimestampMs(getNowMs()) - base, 0);
  }

  function finishPause(resumedAtMs: number) {
    if (pausedAtMs === null) {
      return;
    }
    totalPausedMs += Math.max(resumedAtMs - pausedAtMs, 0);
    pausedAtMs = null;
  }

  function getSlide(index: number) {
    const slide = input.slides[index];
    if (!slide) {
      throw new Error(`P3 rehearsal slide index is out of range: ${index}`);
    }
    return slide;
  }

  function buildBiasPhrasesForSlideIndex(index: number) {
    return buildBiasPhrasesForSlide(getSlide(index), input.config, {
      adjacentSlides: [input.slides[index - 1], input.slides[index + 1]].filter(
        (slide): slide is P3RehearsalSessionSlide => slide !== undefined
      )
    });
  }

  function scheduleSemanticPrepare(index: number, generation: number) {
    if (!input.semanticMatcher || status !== "running") {
      return;
    }

    const slide = getSlide(index);
    emitSemanticDebugState({
      status: "indexing-script",
      slideId: slide.slideId,
      transcript: "",
      isFinal: false,
      topMatches: [],
      decision: null,
      error: null
    });

    const preparePromise = input.semanticMatcher
      .prepareSlide({
        slideId: slide.slideId,
        speakerNotes: slide.speakerNotes
      })
      .then(() => {
        if (isSemanticGenerationCurrent(generation, index)) {
          emitSemanticDebugState({
            status: "ready",
            slideId: slide.slideId,
            transcript: "",
            isFinal: false,
            topMatches: [],
            decision: null,
            error: null
          });
        }
      })
      .catch((error: unknown) => {
        if (isSemanticGenerationCurrent(generation, index)) {
          emitSemanticDebugState({
            status: "error",
            slideId: slide.slideId,
            transcript: "",
            isFinal: false,
            topMatches: [],
            decision: null,
            error: semanticDebugErrorMessage(error)
          });
        }
      });

    semanticPrepareBySlideId.set(slide.slideId, preparePromise);
  }

  function scheduleSemanticCuePrewarm(index: number) {
    if (
      !input.semanticCueRuntime ||
      !(input.isSemanticMatchingEnabled?.() ?? false)
    ) {
      return;
    }
    for (const targetIndex of [index, index - 1, index + 1]) {
      const slide = input.slides[targetIndex];
      if (!slide) {
        continue;
      }
      const staleCueIds = (slide.semanticCues ?? [])
        .filter(
          (cue) => cue.reviewStatus === "approved" && cue.freshness !== "current"
        )
        .map((cue) => cue.cueId);
      if (targetIndex === index) {
        transitionCapability(
          staleCueIds.length > 0
            ? {
                capability: "cue_freshness",
                toState: "degraded",
                reason: "stale_cue",
                measurementMode: "none",
                retryable: false,
                slideId: slide.slideId,
                cueIds: staleCueIds
              }
            : {
                capability: "cue_freshness",
                toState: "available",
                measurementMode: "full",
                retryable: false,
                slideId: slide.slideId,
                cueIds: []
              }
        );
      }
      const preparePromise = input.semanticCueRuntime.prepareSlide({
        slideId: slide.slideId,
        cues: slide.semanticCues ?? []
      });
      const observedPreparePromise = preparePromise
        .then(() => {
          transitionCapability({
            capability: "embedding",
            toState: "available",
            measurementMode: "full",
            retryable: false,
            slideId: slide.slideId,
            cueIds: []
          });
        })
        .catch(() => {
          transitionCapability({
            capability: "embedding",
            toState: "unavailable",
            reason: "model_load_failed",
            measurementMode: "basic",
            retryable: true,
            slideId: slide.slideId,
            cueIds: (slide.semanticCues ?? []).map((cue) => cue.cueId)
          });
        });
      semanticCuePrepareBySlideId.set(slide.slideId, observedPreparePromise);
    }
  }

  function enqueueSemanticFinalResult(options: {
    result: LiveSttResult;
    resultSlideIndex: number;
    tracker: SpeechTracker;
    prompterRevision: number;
    generation: number;
    phraseMatched: boolean;
    keywordCoverage: number;
  }) {
    if (!input.semanticMatcher && !input.semanticCueRuntime) {
      return;
    }

    semanticQueue = semanticQueue
      .catch(() => undefined)
      .then(() => processSemanticFinalResult(options));
  }

  async function processSemanticFinalResult(options: {
    result: LiveSttResult;
    resultSlideIndex: number;
    tracker: SpeechTracker;
    prompterRevision: number;
    generation: number;
    phraseMatched: boolean;
    keywordCoverage: number;
  }) {
    const slide = getSlide(options.resultSlideIndex);
    await semanticPrepareBySlideId.get(slide.slideId);
    if (!isSemanticGenerationCurrent(options.generation, options.resultSlideIndex)) {
      if (closingSemanticGenerations.has(options.generation)) {
        await processSemanticCueFinalResult({
          slide,
          result: options.result,
          decisionReason: "no_match",
          generation: options.generation,
          resultSlideIndex: options.resultSlideIndex,
          phraseMatched: options.phraseMatched,
          keywordCoverage: options.keywordCoverage,
          allowClosingGeneration: true
        });
      }
      return;
    }

    emitSemanticDebugState({
      status: "matching",
      slideId: slide.slideId,
      transcript: options.result.text,
      isFinal: true,
      topMatches: [],
      decision: null,
      error: null
    });

    try {
      if (!input.semanticMatcher) {
        await processSemanticCueFinalResult({
          slide,
          result: options.result,
          decisionReason: "no_match",
          generation: options.generation,
          resultSlideIndex: options.resultSlideIndex,
          phraseMatched: options.phraseMatched,
          keywordCoverage: options.keywordCoverage
        });
        return;
      }
      const match = await input.semanticMatcher?.matchFinalTranscript({
        slideId: slide.slideId,
        transcript: options.result.text,
        coveredSentenceIds: new Set(options.tracker.snapshot().coveredSentenceIds)
      });
      if (!match) {
        return;
      }
      if (!isSemanticGenerationCurrent(options.generation, options.resultSlideIndex)) {
        if (closingSemanticGenerations.has(options.generation)) {
          await processSemanticCueFinalResult({
            slide,
            result: options.result,
            decisionReason: match.decision?.reason ?? "no_match",
            generation: options.generation,
            resultSlideIndex: options.resultSlideIndex,
            phraseMatched: options.phraseMatched,
            keywordCoverage: options.keywordCoverage,
            allowClosingGeneration: true
          });
        }
        return;
      }

      emitSemanticDebugState({
        status: "ready",
        slideId: slide.slideId,
        transcript: options.result.text,
        isFinal: true,
        topMatches: match.topMatches,
        decision: match.decision,
        error: null
      });

      const decision = match.decision;
      await processSemanticCueFinalResult({
        slide,
        result: options.result,
        decisionReason: decision?.reason ?? "no_match",
        generation: options.generation,
        resultSlideIndex: options.resultSlideIndex,
        phraseMatched: options.phraseMatched,
        keywordCoverage: options.keywordCoverage
      });
      if (!input.isSemanticMatchingEnabled?.()) {
        return;
      }

      const events: SpeechTrackingEvent[] = [];
      if (decision?.outcome === "ad-lib") {
        const nearestMatch = decision.topMatches[0] ?? null;
        events.push({
          type: "ad-lib-detected",
          slideId: slide.slideId,
          text: options.result.text,
          nearestSentenceId: nearestMatch?.sentenceId ?? null,
          similarity: nearestMatch?.similarity ?? null,
          atMs: options.result.timestampMs[1]
        });
      } else if (decision?.accepted && decision.acceptedMatch && decision.outcome) {
        events.push(
          ...options.tracker.acceptSemanticSentenceMatch({
            sentenceId: decision.acceptedMatch.sentenceId,
            transcript: options.result.text,
            similarity: decision.acceptedMatch.similarity,
            matchKind: decision.outcome,
            lexicalOverlap: decision.lexicalOverlap,
            expectedPrompterRevision: options.prompterRevision,
            atMs: options.result.timestampMs[1]
          })
        );
      }
      applyEventsToLog(events, collector);
      if (events.length > 0) {
        input.onEvents?.(events);
      }
      emitSnapshot();
    } catch (error) {
      if (isSemanticGenerationCurrent(options.generation, options.resultSlideIndex)) {
        emitSemanticDebugState({
          status: "error",
          slideId: slide.slideId,
          transcript: options.result.text,
          isFinal: true,
          topMatches: [],
          decision: null,
          error: semanticDebugErrorMessage(error)
        });
      }
    }
  }

  function isSemanticGenerationCurrent(generation: number, expectedSlideIndex: number) {
    return (
      status === "running" &&
      generation === semanticGeneration &&
      slideIndex === expectedSlideIndex
    );
  }

  function emitSemanticDebugState(state: SemanticUtteranceDebugState) {
    input.onSemanticDebugState?.(createSemanticDebugState(state));
  }

  function transitionCapability(transition: SemanticCapabilityTransition) {
    const event = capabilityState.transition(transition);
    if (!event) {
      return;
    }
    collector.recordSemanticCapabilityEvent(event);
    input.onSemanticCapabilityEvent?.(event);
  }

  async function processSemanticCueFinalResult(options: {
    slide: P3RehearsalSessionSlide;
    result: LiveSttResult;
    decisionReason: SemanticMatchDecisionReason | "no_match";
    generation: number;
    resultSlideIndex: number;
    phraseMatched: boolean;
    keywordCoverage: number;
    allowClosingGeneration?: boolean;
  }) {
    if (!input.semanticCueRuntime || (options.slide.semanticCues?.length ?? 0) === 0) {
      return;
    }

    await semanticCuePrepareBySlideId.get(options.slide.slideId);

    let cueResult;
    try {
      cueResult = await input.semanticCueRuntime.evaluateFinalResult({
        deckId: "deck_unknown",
        slideId: options.slide.slideId,
        transcript: options.result.text,
        isFinal: options.result.isFinal,
        cues: options.slide.semanticCues ?? [],
        coveredCueIds: new Set(),
        phraseMatched: options.phraseMatched,
        keywordCoverage: options.keywordCoverage,
        semanticDecisionReason: options.decisionReason,
        semanticMatchingEnabled: input.isSemanticMatchingEnabled?.() ?? false,
        generation: options.generation,
        nowMs: options.result.timestampMs[1],
        evidenceStartMs: options.result.timestampMs[0],
        evidenceEndMs: options.result.timestampMs[1]
      });
    } catch (error) {
      if (
        isSemanticGenerationCurrent(options.generation, options.resultSlideIndex) ||
        (options.allowClosingGeneration &&
          closingSemanticGenerations.has(options.generation))
      ) {
        markSemanticCueProgressUnmeasured(options.slide);
        transitionCapability({
          capability: "semantic_runtime",
          toState: "unavailable",
          reason: "runtime_error",
          measurementMode: "none",
          retryable: true,
          slideId: options.slide.slideId,
          cueIds: (options.slide.semanticCues ?? []).map((cue) => cue.cueId)
        });
        if (
          isSemanticGenerationCurrent(
            options.generation,
            options.resultSlideIndex
          )
        ) {
          emitSnapshot();
        }
      }
      throw error;
    }

    if (
      !isSemanticGenerationCurrent(options.generation, options.resultSlideIndex) &&
      !(
        options.allowClosingGeneration &&
        closingSemanticGenerations.has(options.generation)
      )
    ) {
      return;
    }

    for (const capabilityUpdate of cueResult.capabilityUpdates) {
      transitionCapability(capabilityUpdate);
    }
    applySemanticCueDecisions(options.slide, cueResult.decisions);
    collector.recordSemanticCueDecisions(cueResult.decisions);
    input.onSemanticCueDebugEvent?.(cueResult.debugEvent);
    if (isSemanticGenerationCurrent(options.generation, options.resultSlideIndex)) {
      emitSnapshot();
    }
  }

  async function flushSemanticQueueForSlide(targetSlideIndex: number) {
    const pendingQueue = semanticQueue;
    const timeoutMs = input.semanticQueueFlushTimeoutMs ?? 1_500;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const completed = await Promise.race([
      pendingQueue.then(() => true),
      new Promise<boolean>((resolve) => {
        timeoutId = setTimeout(() => resolve(false), timeoutMs);
      })
    ]);
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
    if (completed) {
      return;
    }

    const slide = getSlide(targetSlideIndex);
    markSemanticCueProgressUnmeasured(slide);
    transitionCapability({
      capability: "semantic_runtime",
      toState: "degraded",
      reason: "queue_dropped",
      measurementMode: "basic",
      retryable: true,
      slideId: slide.slideId,
      cueIds: (slide.semanticCues ?? []).map((cue) => cue.cueId)
    });
  }

  return {
    start,
    pause,
    resume,
    enterSlide,
    acceptResult,
    acceptPrompterPauseBoundary,
    setAdviceState,
    stop,
    getState
  };

  function normalizeResultTimestamp(result: LiveSttResult): LiveSttResult {
    const startMs = Math.max(result.timestampMs[0] + resultTimestampOffsetMs, 0);
    const endMs = Math.max(
      result.timestampMs[1] + resultTimestampOffsetMs,
      startMs,
      lastAcceptedResultEndMs
    );
    lastAcceptedResultEndMs = endMs;
    return {
      ...result,
      timestampMs: [startMs, endMs]
    };
  }
}

function calculateKeywordCoverage(
  snapshot: SpeechTrackerSnapshot,
  slide: P3RehearsalSessionSlide
) {
  if (slide.keywords.length === 0) {
    return 0;
  }

  return snapshot.hitKeywordIds.length / slide.keywords.length;
}

function createWaitingSemanticCueProgress(
  cue: SemanticCue
): P3SemanticCueProgressItem {
  return {
    cueId: cue.cueId,
    slideId: cue.slideId,
    label: cue.presenterTag ?? cue.reportLabel ?? cue.meaning,
    importance: cue.importance,
    status: "waiting",
    measurementMode: "none"
  };
}

function semanticCueProgressStatus(
  decision: RehearsalSemanticCueDecision
): P3SemanticCueProgressStatus {
  if (decision.fallbackUsed && decision.measurementMode === "none") {
    return "unmeasured";
  }
  return decision.label === "covered" ? "covered" : "needs-review";
}

export function buildBiasPhrasesForSlide(
  slide: P3RehearsalSessionSlide,
  config: SpeechTrackingConfigOverride = {},
  context: { adjacentSlides?: readonly P3RehearsalSessionSlide[] } = {}
): LiveSttBiasPhrase[] {
  const extractor = createDefaultPhraseExtractor({
    ...config,
    controlPhrases: slide.controlPhrases,
    keywordTerms: slide.keywords.flatMap((keyword) => [
      keyword.text,
      ...keyword.synonyms,
      ...keyword.abbreviations
    ])
  });
  const sentences = extractor.extract(slide.speakerNotes);
  const finalTriggerPhrases = sentences
    .filter((sentence) => sentence.isFinalTrigger)
    .flatMap((sentence) => sentence.candidates.map((candidate) => candidate.text));
  const representativePhrases = sentences.flatMap((sentence) =>
    sentence.candidates.map((candidate) => candidate.text)
  );

  return buildSpeechTrackingBiasPhrases({
    budget: config.biasPhraseBudget,
    controlPhrases: slide.controlPhrases,
    finalTriggerPhrases,
    cuePhrases: slide.cuePhrases,
    keywords: slide.keywords,
    semanticCues: slide.semanticCues,
    pronunciationEntries: slide.pronunciationEntries,
    adjacentSemanticCues: context.adjacentSlides?.flatMap(
      (adjacentSlide) => adjacentSlide.semanticCues ?? [],
    ),
    adjacentPronunciationEntries: context.adjacentSlides?.flatMap(
      (adjacentSlide) => adjacentSlide.pronunciationEntries ?? [],
    ),
    representativePhrases,
    legacyPhrases: slide.legacyPhrases
  }).map((term) => ({
    text: term.text,
    weight: term.weight,
    source: term.source,
    ...(term.keywordId === undefined ? {} : { keywordId: term.keywordId }),
    ...(term.canonicalText === undefined
      ? {}
      : { canonicalText: term.canonicalText })
  }));
}

function getMatchableSentenceIdsForSlide(
  slide: P3RehearsalSessionSlide,
  config: SpeechTrackingConfigOverride = {}
) {
  return createDefaultPhraseExtractor({
    ...config,
    controlPhrases: slide.controlPhrases
  })
    .extract(slide.speakerNotes)
    .filter((sentence) => sentence.matchable)
    .map((sentence) => sentence.sentenceId);
}

function applyEventsToLog(
  events: readonly SpeechTrackingEvent[],
  collector: RehearsalLogCollector
) {
  for (const event of events) {
    switch (event.type) {
      case "keyword-hit":
        collector.recordKeywordHit(event.slideId, event.keywordId);
        break;
      case "keyword-missing":
        collector.recordProvisionalMissing(event.slideId, event.keywordId);
        break;
      case "advice-event":
        collector.setAdviceState(event.adviceType, true);
        break;
      case "sentence-covered":
        collector.recordSentenceCovered({
          slideId: event.slideId,
          sentenceId: event.sentenceId,
          matchKind: event.matchKind,
          ...(event.similarity === undefined ? {} : { similarity: event.similarity }),
          ...(event.lexicalOverlap === undefined
            ? {}
            : { lexicalOverlap: event.lexicalOverlap })
        });
        break;
      case "ad-lib-detected":
        collector.recordAdLib({
          slideId: event.slideId,
          text: event.text,
          nearestSentenceId: event.nearestSentenceId,
          similarity: event.similarity
        });
        break;
      case "coverage-updated":
      case "last-sentence-spoken":
      case "sentence-missed":
        break;
    }
  }
}
