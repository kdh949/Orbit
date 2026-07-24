import {
  createSlidePlaybackState,
  getPresentationSequenceReviewSlideIds,
  type SlidePlaybackState,
} from "@orbit/editor-core";
import type {
  Deck,
  DeckElement,
  PresentationRecordingMode,
  Slide,
  SlideTranscriptSnapshot,
} from "@orbit/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OrbitButton, OrbitFailureState } from "../../components/ui";
import { PresentationScreen } from "./PresentationScreen";
import { PresentationCompletionDialog } from "./PresentationCompletionDialog";
import { PresentationMicCheckModal } from "./PresentationMicCheckModal";
import {
  completePresentationWithoutAudio,
  createPresentationRuntime,
  fetchOrCreatePresentationDeck,
  uploadPresentationRecording,
  type PresentationRuntimeIdentity,
} from "./presentationApi";
import {
  createPresentationRecordingSession,
  type PresentationRecordingSession,
} from "./presentationRecording";
import {
  usePresentationSpeech,
  type PresentationSpeechTranscriptEvent,
} from "./usePresentationSpeech";
import { getPresentationHighlightedKeywordOccurrences } from "./presentationKeywordOccurrences";
import { getPresentationFailureCopy } from "./presentationFailureCopy";
import {
  shouldWarnBeforePresentationUnload,
  type PresentationRuntimePhase,
} from "./presentationLifecycle";
import { activityApi } from "../activity-slides/api/activityApi";
import { prepareActivityQrRuns } from "../activity-slides/model/activityQrElements";
import {
  getRehearsalMicrophoneAudioConstraints,
  readRehearsalMicrophoneDeviceId,
} from "../presenter-shell/microphoneSettings";
import {
  getDeckTargetSeconds,
  getSlideTargetSeconds,
  type RehearsalTimingSnapshot,
  type TimingAdviceState,
} from "../rehearsal/panel/rehearsalTiming";
import { createSlideshowAnimationPlan } from "../rehearsal/presenter/slideshowStepModel";
import { usePresenterKeyboard } from "../rehearsal/presenter/usePresenterKeyboard";
import {
  getTriggerAnimationIdsForSlide,
  restoreSlidePlaybackAtStep,
  resolveManualAnimationPlaybackUpdate,
  resolveQueuedKeywordOccurrencePlayback,
  resolveKeywordTriggeredActions,
  resolveTriggeredActionPlaybackUpdate,
} from "../rehearsal/playback/triggeredActionPlayback";
import type { AnimationFlowNavigation } from "../rehearsal/presenter/AnimationFlowNavigator";
import { AutoAdvanceStatus } from "../rehearsal/advance/AutoAdvanceStatus";
import {
  defaultAutoAdvanceConfig,
  defaultAutoAdvancePolicy,
} from "../rehearsal/advance/autoAdvanceConfig";
import {
  cancelAdvanceCountdown,
  createInitialAdvanceControllerState,
  evaluateAdvanceController,
  resetAdvanceControllerForSlide,
  type AdvanceControllerState,
} from "../rehearsal/advance/advanceController";
import { createDefaultPhraseExtractor } from "../rehearsal/speech/phraseExtractor";
import { getExpectedKeywordOccurrenceStep } from "../rehearsal/speech/keywordOccurrenceStepResolver";
import { dispatchKeywordOccurrencePlayback } from "../rehearsal/speech/keywordOccurrencePlaybackDispatcher";
import type { SpeechTrackerSnapshot } from "../rehearsal/speech/speechTrackingEvents";
import {
  PresenterStatusShell,
  type PresenterInfoCardItem,
  type PresenterTimeMode,
} from "../presenter-shell/PresenterScaffold";

type PresentationPhase = "loading" | "ready" | "failed";
type PresentationKeywordOccurrenceState = {
  slideId: string;
  confirmedOccurrenceIds: string[];
};

type PresentationAnimationExecutionSource =
  | "approval"
  | "click"
  | "generic-keyword"
  | "speech";

type PresentationAnimationExecutionHistoryEntry = {
  animationIds: string[];
  atMs: number;
  consumedOccurrenceIds: string[];
  id: number;
  newSegment: string | null;
  source: PresentationAnimationExecutionSource;
  stepAfter: number;
  stepBefore: number;
};
export function PresentationWorkspace(props: {
  fallbackDeck?: Deck;
  initialDeck?: Deck;
  initialSlideIndex?: number;
  initialStepIndex?: number;
  projectId?: string;
}) {
  const [deck, setDeck] = useState<Deck | null>(props.initialDeck ?? null);
  const [phase, setPhase] = useState<PresentationPhase>(
    props.initialDeck ? "ready" : "loading",
  );
  const [error, setError] = useState("");
  const [currentSlideIndex, setCurrentSlideIndex] = useState(
    props.initialSlideIndex ?? 0,
  );
  const [presenterStepIndex, setPresenterStepIndex] = useState(
    props.initialStepIndex ?? 0,
  );
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [slideElapsedSeconds, setSlideElapsedSeconds] = useState(0);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [timeMode, setTimeMode] = useState<PresenterTimeMode>("timer");
  const [timerDurationSeconds, setTimerDurationSeconds] = useState(
    props.initialDeck ? getDeckTargetSeconds(props.initialDeck) : 5 * 60,
  );
  const [elapsedTimeInput, setElapsedTimeInput] = useState("00:00");
  const [timerDurationInput, setTimerDurationInput] = useState(() =>
    formatClock(
      props.initialDeck ? getDeckTargetSeconds(props.initialDeck) : 5 * 60,
    ),
  );
  const [editingTimeField, setEditingTimeField] = useState<
    "elapsed" | "duration" | null
  >(null);
  const [hasManualTimerDuration, setHasManualTimerDuration] = useState(false);
  const requiresPresentationRuntime = Boolean(
    props.projectId && !props.initialDeck,
  );
  const [runtimePhase, setRuntimePhase] = useState<PresentationRuntimePhase>(
    requiresPresentationRuntime ? "preflight" : "active",
  );
  const [runtimeError, setRuntimeError] = useState("");
  const [runtimeFailureOperation, setRuntimeFailureOperation] = useState<
    "start" | "finish" | null
  >(null);
  const [requestedRecordingMode, setRequestedRecordingMode] =
    useState<PresentationRecordingMode>("microphone");
  const runtimeRef = useRef<PresentationRuntimeIdentity | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recordingRef = useRef<PresentationRecordingSession | null>(null);
  const recordedFileRef = useRef<File | null>(null);
  const startPromiseRef = useRef<Promise<void> | null>(null);
  const finishPromiseRef = useRef<Promise<void> | null>(null);
  const slideTranscriptSnapshotsRef = useRef<SlideTranscriptSnapshot[]>([]);
  const slideTranscriptVisitVersionsRef = useRef<Map<string, number>>(
    new Map(),
  );
  const activeSlideTranscriptVisitRef = useRef<{
    slideId: string;
    slideNum: number;
    visitedAt: string;
    visitedVer: number;
  } | null>(null);
  const previousSlideIndexRef = useRef(currentSlideIndex);
  const playbackStateRef = useRef<SlidePlaybackState>(
    createSlidePlaybackState(),
  );
  const previousHitKeywordIdsRef = useRef<Set<string>>(new Set());
  const keywordOccurrenceStateRef =
    useRef<PresentationKeywordOccurrenceState | null>(null);
  const pendingKeywordOccurrenceIdsRef = useRef<{
    occurrenceIds: string[];
    slideId: string;
  } | null>(null);
  const presentationSpeechEventHandlerRef = useRef<
    ((event: PresentationSpeechTranscriptEvent) => void) | null
  >(null);
  const currentSlideRef = useRef<Slide | null>(null);
  const slideshowAnimationPlanRef = useRef<ReturnType<
    typeof createSlideshowAnimationPlan
  > | null>(null);
  const presenterStepIndexRef = useRef(presenterStepIndex);
  const runtimePhaseRef = useRef(runtimePhase);
  const [pendingKeywordOccurrenceIds, setPendingKeywordOccurrenceIds] =
    useState<string[]>([]);
  const [animationExecutionHistory, setAnimationExecutionHistory] = useState<
    PresentationAnimationExecutionHistoryEntry[]
  >([]);
  const animationExecutionHistoryIdRef = useRef(0);
  const pendingFlowRestoreRef = useRef<{
    slideId: string;
    stepIndex: number;
  } | null>(null);
  const advanceControllerStateRef = useRef<AdvanceControllerState>(
    createInitialAdvanceControllerState(),
  );
  const finalSentenceCommittedAtMsRef = useRef<number | null>(null);
  const finalSentenceSpokenAtMsRef = useRef<number | null>(null);
  const [advanceControllerState, setAdvanceControllerState] =
    useState<AdvanceControllerState>(() =>
      createInitialAdvanceControllerState(),
    );
  const [autoAdvanceNowMs, setAutoAdvanceNowMs] = useState(0);
  useEffect(() => {
    if (props.initialDeck) {
      return;
    }

    let isCancelled = false;
    setPhase("loading");
    void fetchOrCreatePresentationDeck({
      fallbackDeck: props.fallbackDeck,
      projectId: props.projectId,
    })
      .then((nextDeck) => {
        if (isCancelled) {
          return;
        }

        setDeck(nextDeck);
        setPhase("ready");
      })
      .catch((cause) => {
        if (isCancelled) {
          return;
        }

        setError(
          cause instanceof Error
            ? cause.message
            : "발표 자료를 불러오지 못했습니다.",
        );
        setPhase("failed");
      });

    return () => {
      isCancelled = true;
    };
  }, [props.fallbackDeck, props.initialDeck, props.projectId]);

  useEffect(() => {
    if (!deck || hasManualTimerDuration) {
      return;
    }

    const nextSeconds = getDeckTargetSeconds(deck);
    setTimerDurationSeconds(nextSeconds);
    if (editingTimeField !== "duration") {
      setTimerDurationInput(formatClock(nextSeconds));
    }
  }, [deck, editingTimeField, hasManualTimerDuration]);

  useEffect(() => {
    if (!isTimerRunning) {
      return;
    }

    const timerId = window.setInterval(() => {
      setElapsedSeconds((current) => current + 1);
      setSlideElapsedSeconds((current) => current + 1);
    }, 1000);

    return () => window.clearInterval(timerId);
  }, [isTimerRunning]);

  useEffect(() => {
    if (timeMode === "timer" && elapsedSeconds >= timerDurationSeconds) {
      setIsTimerRunning(false);
    }
  }, [elapsedSeconds, timeMode, timerDurationSeconds]);

  useEffect(() => {
    setSlideElapsedSeconds(0);
  }, [currentSlideIndex]);

  const displayedTimeSeconds =
    timeMode === "timer"
      ? Math.max(timerDurationSeconds - elapsedSeconds, 0)
      : elapsedSeconds;

  useEffect(() => {
    if (editingTimeField !== "elapsed") {
      setElapsedTimeInput(formatClock(displayedTimeSeconds));
    }
  }, [displayedTimeSeconds, editingTimeField]);

  useEffect(() => {
    if (editingTimeField !== "duration") {
      setTimerDurationInput(formatClock(timerDurationSeconds));
    }
  }, [editingTimeField, timerDurationSeconds]);

  const currentSlide = deck?.slides[currentSlideIndex] ?? null;
  const nextSlide = deck?.slides[currentSlideIndex + 1] ?? null;
  useEffect(() => {
    if (runtimePhase !== "active" || !currentSlide) {
      previousSlideIndexRef.current = currentSlideIndex;
      return;
    }
    if (previousSlideIndexRef.current !== currentSlideIndex) {
      captureSlideTranscriptSnapshot("slide-change");
      beginSlideTranscriptVisit(currentSlide, currentSlideIndex);
      previousSlideIndexRef.current = currentSlideIndex;
    }
  }, [currentSlide, currentSlideIndex, runtimePhase]);
  const triggerAnimationIds = useMemo(
    () => (currentSlide ? getTriggerAnimationIdsForSlide(currentSlide) : []),
    [currentSlide],
  );
  const slideshowAnimationPlan = useMemo(
    () =>
      currentSlide
        ? createSlideshowAnimationPlan({
            slide: currentSlide,
            triggerAnimationIds,
          })
        : null,
    [currentSlide, triggerAnimationIds],
  );
  currentSlideRef.current = currentSlide;
  slideshowAnimationPlanRef.current = slideshowAnimationPlan;
  presenterStepIndexRef.current = presenterStepIndex;
  runtimePhaseRef.current = runtimePhase;
  const speech = usePresentationSpeech(
    props.projectId,
    (event) => presentationSpeechEventHandlerRef.current?.(event),
  );
  const animationTriggerDebugEnabled =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("animationDebug") === "1";
  const animationTriggerDebug = useMemo(() => {
    if (!currentSlide) {
      return null;
    }

    const confirmedOccurrenceIds =
      keywordOccurrenceStateRef.current?.slideId === currentSlide.slideId
        ? keywordOccurrenceStateRef.current.confirmedOccurrenceIds
        : [];
    const transcriptEvent = speech.getSlideTranscriptEvent();
    const confidence = speech.state.latestTranscriptConfidence;
    const expectedStep = slideshowAnimationPlan
      ? getExpectedKeywordOccurrenceStep({
          presenterStepIndex,
          slide: currentSlide,
          slideAnimationPlan: slideshowAnimationPlan,
        })
      : null;
    const debugDispatch = dispatchKeywordOccurrencePlayback({
      allowAutomaticPlayback: transcriptEvent.isActionDispatchable,
      confidence,
      consumedOccurrenceIds: confirmedOccurrenceIds,
      latestTranscript: transcriptEvent.actionNewSegment,
      newSegment: transcriptEvent.actionNewSegment,
      pendingOccurrenceIds: [],
      playbackState: playbackStateRef.current,
      previousTranscript: transcriptEvent.actionPreviousTranscript,
      presenterStepIndex,
      slide: currentSlide,
      slideAnimationPlan: slideshowAnimationPlan ?? createSlideshowAnimationPlan({
        slide: currentSlide,
        triggerAnimationIds: getTriggerAnimationIdsForSlide(currentSlide),
      }),
      transcript: transcriptEvent.actionTranscript,
    });
    const occurrenceActions = currentSlide.actions.flatMap((action) => {
      if (action.trigger.kind !== "keyword-occurrence") {
        return [];
      }
      return [
        {
          animationId:
            action.effect.kind === "play-animation"
              ? action.effect.animationId
              : "(play-animation 아님)",
          occurrenceId: action.trigger.occurrenceId,
        },
      ];
    });
    const currentTriggerStep =
      slideshowAnimationPlan?.triggerSteps[presenterStepIndex] ?? null;

    return {
      confidence,
      confirmedOccurrenceIds,
      currentStepAnimationIds:
        currentTriggerStep?.animations.map((animation) => animation.animationId) ??
        [],
      currentStepIndex: presenterStepIndex,
      expectedOccurrenceIds: expectedStep?.occurrenceIds ?? [],
      latestTranscript: speech.state.latestTranscript,
      matches: debugDispatch.matches,
      approvalOccurrenceId:
        debugDispatch.resolution.blocker === "confidence-low" && debugDispatch.resolution.candidates.length === 1
          ? debugDispatch.resolution.candidates[0]?.occurrenceId ?? null
          : null,
      animationExecutionHistory,
      actionDispatchable: transcriptEvent.isActionDispatchable,
      newSegment: transcriptEvent.actionNewSegment,
      occurrenceActions,
      positionedMatches: debugDispatch.positionedMatches,
      playedAnimationIds: playbackStateRef.current.playedAnimationIds,
      resolutionBlocker: debugDispatch.resolution.blocker,
      speechStatus: speech.state.status,
      transcript: transcriptEvent.transcript,
    };
  }, [
    animationExecutionHistory,
    currentSlide,
    presenterStepIndex,
    slideshowAnimationPlan,
    speech.state.latestTranscript,
    speech.state.latestTranscriptConfidence,
    speech.state.status,
  ]);
  const currentSlideTargetSeconds =
    deck && currentSlide ? getSlideTargetSeconds(deck, currentSlide) : 0;
  const timing: RehearsalTimingSnapshot =
    deck && currentSlide
      ? {
          currentSlideElapsedSeconds: slideElapsedSeconds,
          currentSlideOvertime:
            currentSlideTargetSeconds > 0 &&
            slideElapsedSeconds > currentSlideTargetSeconds,
          currentSlideTargetSeconds,
          deckTargetSeconds: timerDurationSeconds,
          elapsedSeconds,
          remainingSeconds: timerDurationSeconds - elapsedSeconds,
        }
      : {
          currentSlideElapsedSeconds: 0,
          currentSlideOvertime: false,
          currentSlideTargetSeconds: 0,
          deckTargetSeconds: timerDurationSeconds,
          elapsedSeconds,
          remainingSeconds: timerDurationSeconds - elapsedSeconds,
        };
  const adviceState: TimingAdviceState = {
    pace: "normal",
    slideOvertime: timing.currentSlideOvertime,
  };
  const sentences = useMemo(
    () =>
      currentSlide
        ? createDefaultPhraseExtractor({
            controlPhrases: [],
            keywordTerms: (currentSlide.keywords ?? []).flatMap((keyword) => [
              keyword.text,
              ...keyword.synonyms,
              ...keyword.abbreviations,
            ]),
          }).extract(currentSlide.speakerNotes)
        : [],
    [currentSlide],
  );
  const panelSnapshot = useMemo(() => {
    if (
      speech.state.snapshot &&
      speech.state.snapshot.slideId === currentSlide?.slideId
    ) {
      return speech.state.snapshot;
    }
    return createEmptySpeechTrackerSnapshot({
      matchableSentenceCount: sentences.filter((sentence) => sentence.matchable)
        .length,
      slideId: currentSlide?.slideId ?? "presentation-empty",
    });
  }, [currentSlide?.slideId, sentences, speech.state.snapshot]);
  const checklistKeywords = currentSlide?.keywords ?? [];
  const highlightedKeywordOccurrences = useMemo(
    () => getPresentationHighlightedKeywordOccurrences(currentSlide),
    [currentSlide],
  );
  const rehearsalProgressPercent =
    timerDurationSeconds > 0
      ? Math.min(
          100,
          Math.max(0, (elapsedSeconds / timerDurationSeconds) * 100),
        )
      : 0;
  const presentationStatusLabel =
    runtimePhase === "finishing"
      ? "발표 저장 중"
      : speech.state.status === "paused"
        ? "발표 일시정지"
        : isTimerRunning
          ? "발표 진행 중"
          : "발표 준비";
  const miniSlideScale = deck ? getMiniSlideScale(deck) : 0.14;
  const { presenterScale, presenterStageRef } = usePresenterStageScale(deck);
  const infoCards: PresenterInfoCardItem[] = [
    {
      detail: currentSlide ? getSlideTitle(currentSlide) : "-",
      label: "현재 슬라이드",
      value: `슬라이드 ${currentSlideIndex + 1} / ${deck?.slides.length ?? 0}`,
    },
    {
      detail: timing.currentSlideOvertime
        ? "현재 슬라이드 시간 초과"
        : "현재 슬라이드 시간 정상",
      label: "발표 상태",
      value: isTimerRunning ? "진행 중" : "대기 중",
      variantClassName: "rehearsal-side-advice-card",
    },
  ];
  const nextHint = nextSlide?.keywords?.[0]
    ? `다음 키워드 "${nextSlide.keywords[0].text}"를 확인하세요`
    : "마지막 슬라이드를 마무리할 흐름을 점검하세요";

  const cancelAutoAdvanceForManualCommand = useCallback(() => {
    const result = cancelAdvanceCountdown(
      advanceControllerStateRef.current,
      "manual",
    );
    advanceControllerStateRef.current = result.state;
    setAdvanceControllerState(result.state);
  }, []);

  const goPrevious = useCallback(() => {
    cancelAutoAdvanceForManualCommand();
    presenterStepIndexRef.current = 0;
    setPresenterStepIndex(0);
    setCurrentSlideIndex((current) => Math.max(0, current - 1));
  }, [cancelAutoAdvanceForManualCommand]);

  const goNext = useCallback(() => {
    if (!deck) {
      return;
    }

    cancelAutoAdvanceForManualCommand();
    presenterStepIndexRef.current = 0;
    setPresenterStepIndex(0);
    setCurrentSlideIndex((current) =>
      Math.min(deck.slides.length - 1, current + 1),
    );
  }, [cancelAutoAdvanceForManualCommand, deck]);

  const appendAnimationExecutionHistory = useCallback(
    (entry: Omit<PresentationAnimationExecutionHistoryEntry, "atMs" | "id">) => {
      animationExecutionHistoryIdRef.current += 1;
      const nextEntry: PresentationAnimationExecutionHistoryEntry = {
        ...entry,
        atMs: Date.now(),
        id: animationExecutionHistoryIdRef.current,
      };
      setAnimationExecutionHistory((current) => [...current, nextEntry].slice(-20));
    },
    [],
  );

  const applyPlaybackUpdate = useCallback(
    (args: {
      consumedOccurrenceIds?: readonly string[];
      newSegment?: string | null;
      slide: Slide;
      source?: PresentationAnimationExecutionSource;
      update: ReturnType<typeof resolveTriggeredActionPlaybackUpdate>;
    }) => {
      const stepBefore = presenterStepIndexRef.current;
      const previouslyPlayedAnimationIds = new Set(
        playbackStateRef.current.playedAnimationIds,
      );
      playbackStateRef.current = args.update.playbackState;
      const newlyPlayedAnimationIds = args.update.playbackState.playedAnimationIds.filter(
        (animationId) => !previouslyPlayedAnimationIds.has(animationId),
      );
      if (
        newlyPlayedAnimationIds.length > 0 ||
        args.consumedOccurrenceIds?.length ||
        args.update.shouldAdvanceSlide
      ) {
        appendAnimationExecutionHistory({
          animationIds: newlyPlayedAnimationIds,
          consumedOccurrenceIds: [...(args.consumedOccurrenceIds ?? [])],
          newSegment: args.newSegment ?? null,
          source: args.source ?? "click",
          stepAfter: args.update.presenterStepIndex,
          stepBefore,
        });
      }

      if (args.consumedOccurrenceIds?.length) {
        const currentOccurrenceState =
          keywordOccurrenceStateRef.current?.slideId === args.slide.slideId
            ? keywordOccurrenceStateRef.current
            : { slideId: args.slide.slideId, confirmedOccurrenceIds: [] };
        keywordOccurrenceStateRef.current = {
          slideId: args.slide.slideId,
          confirmedOccurrenceIds: [
            ...new Set([
              ...currentOccurrenceState.confirmedOccurrenceIds,
              ...args.consumedOccurrenceIds,
            ]),
          ],
        };
        if (pendingKeywordOccurrenceIdsRef.current?.slideId === args.slide.slideId) {
          pendingKeywordOccurrenceIdsRef.current = {
            occurrenceIds: pendingKeywordOccurrenceIdsRef.current.occurrenceIds.filter(
              (occurrenceId) => !args.consumedOccurrenceIds?.includes(occurrenceId),
            ),
            slideId: args.slide.slideId,
          };
          setPendingKeywordOccurrenceIds(
            pendingKeywordOccurrenceIdsRef.current.occurrenceIds,
          );
        }
      }

      if (args.update.shouldAdvanceSlide) {
        goNext();
        return;
      }

      presenterStepIndexRef.current = args.update.presenterStepIndex;
      setPresenterStepIndex(args.update.presenterStepIndex);
    },
    [appendAnimationExecutionHistory, goNext],
  );

  presentationSpeechEventHandlerRef.current = (event) => {
    const slide = event.slide;
    const slideAnimationPlan = slideshowAnimationPlanRef.current;
    if (
      !slideAnimationPlan ||
      currentSlideRef.current?.slideId !== slide.slideId ||
      runtimePhaseRef.current !== "active"
    ) {
      return;
    }
    const occurrenceState =
      keywordOccurrenceStateRef.current?.slideId === slide.slideId
        ? keywordOccurrenceStateRef.current
        : { slideId: slide.slideId, confirmedOccurrenceIds: [] };
    const pendingOccurrenceIds =
      pendingKeywordOccurrenceIdsRef.current?.slideId === slide.slideId
        ? pendingKeywordOccurrenceIdsRef.current.occurrenceIds
        : [];
    const dispatched = dispatchKeywordOccurrencePlayback({
      allowAutomaticPlayback: event.isActionDispatchable,
      confidence: event.result.confidence ?? null,
      consumedOccurrenceIds: occurrenceState.confirmedOccurrenceIds,
      latestTranscript: event.actionNewSegment,
      newSegment: event.actionNewSegment,
      pendingOccurrenceIds,
      playbackState: playbackStateRef.current,
      previousTranscript: event.actionPreviousTranscript,
      presenterStepIndex: presenterStepIndexRef.current,
      slide,
      slideAnimationPlan,
      transcript: event.actionTranscript,
    });
    pendingKeywordOccurrenceIdsRef.current = {
      occurrenceIds: dispatched.queuedPlayback.pendingOccurrenceIds,
      slideId: slide.slideId,
    };
    setPendingKeywordOccurrenceIds(dispatched.queuedPlayback.pendingOccurrenceIds);
    if (dispatched.queuedPlayback.update) {
      applyPlaybackUpdate({
        consumedOccurrenceIds: dispatched.queuedPlayback.consumedOccurrenceIds,
        newSegment: event.actionNewSegment,
        slide,
        source: "speech",
        update: dispatched.queuedPlayback.update,
      });
    }
  };

  const handleNextPresenterStep = useCallback((source: PresentationAnimationExecutionSource = "click") => {
    if (!currentSlide || !slideshowAnimationPlan) {
      return;
    }

    const queued = resolveQueuedKeywordOccurrencePlayback({
      actionsByOccurrenceId: new Map(),
      matchedOccurrenceIds: [],
      pendingOccurrenceIds:
        pendingKeywordOccurrenceIdsRef.current?.slideId === currentSlide.slideId
          ? pendingKeywordOccurrenceIdsRef.current.occurrenceIds
          : [],
      playbackState: playbackStateRef.current,
      presenterStepIndex,
      slide: currentSlide,
      slideAnimationPlan: slideshowAnimationPlan,
    });
    pendingKeywordOccurrenceIdsRef.current = {
      occurrenceIds: queued.pendingOccurrenceIds,
      slideId: currentSlide.slideId,
    };
    setPendingKeywordOccurrenceIds(queued.pendingOccurrenceIds);
    if (queued.update) {
      applyPlaybackUpdate({
        consumedOccurrenceIds: queued.consumedOccurrenceIds,
        slide: currentSlide,
        source,
        update: queued.update,
      });
      return;
    }

    const update = resolveManualAnimationPlaybackUpdate({
      playbackState: playbackStateRef.current,
      presenterStepIndex,
      slide: currentSlide,
      slideAnimationPlan: slideshowAnimationPlan,
    });
    applyPlaybackUpdate({
      consumedOccurrenceIds: update.consumedOccurrenceIds,
      slide: currentSlide,
      source,
      update,
    });
  }, [applyPlaybackUpdate, currentSlide, presenterStepIndex, slideshowAnimationPlan]);

  const approvePresentationKeywordOccurrence = useCallback(
    (occurrenceId: string) => {
      if (!currentSlide) return;
      const pendingOccurrenceIds = new Set(
        pendingKeywordOccurrenceIdsRef.current?.slideId === currentSlide.slideId
          ? pendingKeywordOccurrenceIdsRef.current.occurrenceIds
          : [],
      );
      pendingOccurrenceIds.add(occurrenceId);
      pendingKeywordOccurrenceIdsRef.current = {
        occurrenceIds: [...pendingOccurrenceIds],
        slideId: currentSlide.slideId,
      };
      setPendingKeywordOccurrenceIds([...pendingOccurrenceIds]);
      handleNextPresenterStep("approval");
    },
    [currentSlide, handleNextPresenterStep],
  );

  const restorePresentationPlaybackAtStep = useCallback(
    (slide: Slide, stepIndex: number) => {
      const restored = restoreSlidePlaybackAtStep({
        slide,
        slideAnimationPlan: createSlideshowAnimationPlan({
          slide,
          triggerAnimationIds: getTriggerAnimationIdsForSlide(slide),
        }),
        stepIndex,
      });
      previousHitKeywordIdsRef.current = new Set();
      playbackStateRef.current = restored.playbackState;
      keywordOccurrenceStateRef.current = {
        confirmedOccurrenceIds: restored.consumedOccurrenceIds,
        slideId: slide.slideId,
      };
      pendingKeywordOccurrenceIdsRef.current = {
        occurrenceIds: [],
        slideId: slide.slideId,
      };
      setPendingKeywordOccurrenceIds([]);
      finalSentenceCommittedAtMsRef.current = null;
      finalSentenceSpokenAtMsRef.current = null;
      const nextAdvanceState = resetAdvanceControllerForSlide(slide.slideId);
      advanceControllerStateRef.current = nextAdvanceState;
      setAdvanceControllerState(nextAdvanceState);
      setPresenterStepIndex(restored.presenterStepIndex);
      if (speech.state.status === "listening") {
        speech.enterSlide(slide);
      }
    },
    [speech.enterSlide, speech.state.status],
  );

  const handleAnimationFlowNavigation = useCallback(
    (navigation: AnimationFlowNavigation) => {
      if (!deck) return;
      const targetSlide = deck.slides[navigation.targetSlideIndex];
      if (!targetSlide) return;
      cancelAutoAdvanceForManualCommand();
      const stepIndex =
        targetSlide.kind === "activity" || targetSlide.kind === "activity-results"
          ? 0
          : navigation.stepIndex;

      if (navigation.targetSlideIndex === currentSlideIndex) {
        restorePresentationPlaybackAtStep(targetSlide, stepIndex);
        return;
      }

      pendingFlowRestoreRef.current = {
        slideId: targetSlide.slideId,
        stepIndex,
      };
      setPresenterStepIndex(stepIndex);
      setCurrentSlideIndex(navigation.targetSlideIndex);
    },
    [
      cancelAutoAdvanceForManualCommand,
      currentSlideIndex,
      deck,
      restorePresentationPlaybackAtStep,
    ],
  );

  usePresenterKeyboard({
    enabled: Boolean(deck) && runtimePhase === "active",
    onNextStep: handleNextPresenterStep,
    onPreviousSlide: goPrevious,
  });

  useEffect(() => {
    const pendingFlowRestore = pendingFlowRestoreRef.current;
    if (
      currentSlide &&
      pendingFlowRestore?.slideId === currentSlide.slideId
    ) {
      pendingFlowRestoreRef.current = null;
      restorePresentationPlaybackAtStep(currentSlide, pendingFlowRestore.stepIndex);
      return;
    }
    previousHitKeywordIdsRef.current = new Set();
    keywordOccurrenceStateRef.current = currentSlide
      ? { slideId: currentSlide.slideId, confirmedOccurrenceIds: [] }
      : null;
    pendingKeywordOccurrenceIdsRef.current = currentSlide
      ? { occurrenceIds: [], slideId: currentSlide.slideId }
      : null;
    setPendingKeywordOccurrenceIds([]);
    animationExecutionHistoryIdRef.current = 0;
    setAnimationExecutionHistory([]);
    playbackStateRef.current = createSlidePlaybackState();
    finalSentenceCommittedAtMsRef.current = null;
    finalSentenceSpokenAtMsRef.current = null;
    const nextAdvanceState = currentSlide
      ? resetAdvanceControllerForSlide(currentSlide.slideId)
      : createInitialAdvanceControllerState();
    advanceControllerStateRef.current = nextAdvanceState;
    setAdvanceControllerState(nextAdvanceState);
    if (currentSlide && speech.state.status === "listening") {
      speech.enterSlide(currentSlide);
    }
  }, [currentSlide, restorePresentationPlaybackAtStep, speech.enterSlide, speech.state.status]);

  useEffect(() => {
    if (runtimePhase !== "active" || speech.state.status !== "listening") {
      return;
    }

    const timer = window.setInterval(
      () => setAutoAdvanceNowMs(Date.now()),
      250,
    );
    return () => window.clearInterval(timer);
  }, [runtimePhase, speech.state.status]);

  useEffect(() => {
    if (
      !deck ||
      !currentSlide ||
      !slideshowAnimationPlan ||
      runtimePhase !== "active" ||
      speech.state.status !== "listening"
    ) {
      return;
    }

    const nowMs = autoAdvanceNowMs || Date.now();
    if (panelSnapshot.finalSentenceCommitted === true) {
      finalSentenceCommittedAtMsRef.current ??= nowMs;
    } else {
      finalSentenceCommittedAtMsRef.current = null;
    }
    if (panelSnapshot.finalSentenceSpoken) {
      finalSentenceSpokenAtMsRef.current ??=
        speech.state.lastTranscriptActivityAtMs ?? nowMs;
    } else {
      finalSentenceSpokenAtMsRef.current = null;
    }

    const lastActivityAtMs = speech.state.lastTranscriptActivityAtMs;
    const silenceDurationMs = lastActivityAtMs
      ? Math.max(0, nowMs - lastActivityAtMs)
      : 0;
    const result = evaluateAdvanceController(
      advanceControllerStateRef.current,
      {
        effectiveCoverage: panelSnapshot.effectiveCoverage,
        finalSentenceCommitted: panelSnapshot.finalSentenceCommitted === true,
        finalSentenceCommittedAtMs: finalSentenceCommittedAtMsRef.current,
        finalSentenceSpoken: panelSnapshot.finalSentenceSpoken,
        finalSentenceSpokenAtMs: finalSentenceSpokenAtMsRef.current,
        isLastSlide: currentSlideIndex >= deck.slides.length - 1,
        mode: "live",
        nowMs,
        pause: {
          isPaused:
            lastActivityAtMs !== null &&
            silenceDurationMs >= presentationAutoAdvancePolicy.pauseMs,
          silenceDurationMs,
        },
        policy: presentationAutoAdvancePolicy,
        remainingTriggerSteps: Math.max(
          0,
          slideshowAnimationPlan.maxStepIndex - presenterStepIndex,
        ),
        semanticAutoActionAllowed: true,
        slideId: currentSlide.slideId,
      },
      defaultAutoAdvanceConfig,
    );
    advanceControllerStateRef.current = result.state;
    setAdvanceControllerState(result.state);

    if (result.commands.some((command) => command.type === "advance-slide")) {
      setPresenterStepIndex(0);
      setCurrentSlideIndex((current) =>
        Math.min(deck.slides.length - 1, current + 1),
      );
    }
  }, [
    autoAdvanceNowMs,
    currentSlide,
    currentSlideIndex,
    deck,
    panelSnapshot.effectiveCoverage,
    panelSnapshot.finalSentenceCommitted,
    panelSnapshot.finalSentenceSpoken,
    presenterStepIndex,
    runtimePhase,
    slideshowAnimationPlan,
    speech.state.lastTranscriptActivityAtMs,
    speech.state.status,
  ]);

  useEffect(() => {
    if (!currentSlide || !slideshowAnimationPlan || runtimePhase !== "active") {
      return;
    }

    const nextHitIds = new Set(panelSnapshot.hitKeywordIds);
    const newlyHitIds = panelSnapshot.hitKeywordIds.filter(
      (keywordId) => !previousHitKeywordIdsRef.current.has(keywordId),
    );
    previousHitKeywordIdsRef.current = nextHitIds;

    for (const keywordId of newlyHitIds) {
      const actions = resolveKeywordTriggeredActions(currentSlide, keywordId);
      if (actions.length === 0) {
        continue;
      }
      const update = resolveTriggeredActionPlaybackUpdate({
        actions,
        playbackState: playbackStateRef.current,
        presenterStepIndex,
        slide: currentSlide,
        slideAnimationPlan: slideshowAnimationPlan,
      });
      applyPlaybackUpdate({
        slide: currentSlide,
        source: "generic-keyword",
        update,
      });
      if (update.shouldAdvanceSlide) {
        return;
      }
    }
  }, [
    applyPlaybackUpdate,
    currentSlide,
    panelSnapshot.hitKeywordIds,
    presenterStepIndex,
    runtimePhase,
    slideshowAnimationPlan,
  ]);

  useEffect(() => {
    if (!shouldWarnBeforePresentationUnload(runtimePhase)) {
      return;
    }
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [runtimePhase]);

  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
    },
    [],
  );

  function startPresentation(recordingMode: PresentationRecordingMode) {
    if (startPromiseRef.current) {
      return startPromiseRef.current;
    }

    const promise = (async () => {
      if (!deck || !currentSlide || !props.projectId) {
        throw new Error("발표 자료가 준비되지 않았습니다.");
      }
      if (getPresentationSequenceReviewSlideIds(deck).length > 0) {
        throw new Error(
          "대본 키워드 순서가 변경되었습니다. 에디터의 발표 순서에서 검토를 저장한 뒤 발표를 시작하세요.",
        );
      }
      setRuntimePhase("starting");
      setRuntimeError("");
      setRuntimeFailureOperation(null);
      setRequestedRecordingMode(recordingMode);

      const runtime =
        runtimeRef.current ??
        (await createPresentationRuntime({
          deckId: deck.deckId,
          deckVersion: deck.version,
          projectId: props.projectId,
          recordingMode,
        }));
      runtimeRef.current = runtime;

      if (runtime.status !== "created") {
        navigateToPresentationReport({
          projectId: props.projectId,
          runId: runtime.runId,
          sessionId: runtime.sessionId,
        });
        return;
      }

      await prepareActivityQrRuns({
        deck,
        projectId: props.projectId,
        sessionId: runtime.sessionId,
      });

      setRequestedRecordingMode(runtime.recordingMode);

      if (runtime.recordingMode === "microphone") {
        const deviceId = readRehearsalMicrophoneDeviceId();
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            ...getRehearsalMicrophoneAudioConstraints(),
            ...(deviceId ? { deviceId: { ideal: deviceId } } : {}),
          },
          video: false,
        });
        streamRef.current = stream;
        recordingRef.current = createPresentationRecordingSession(stream);
        await speech.start(stream, currentSlide);
      }

      resetSlideTranscriptSnapshots(deck, currentSlideIndex);

      setElapsedSeconds(0);
      setSlideElapsedSeconds(0);
      setIsTimerRunning(true);
      setRuntimePhase("active");
    })()
      .catch(async (cause) => {
        await speech.stop().catch(() => undefined);
        if (recordingRef.current) {
          await recordingRef.current.stop().catch(() => undefined);
        }
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        recordingRef.current = null;
        runtimeRef.current = null;
        setRuntimeError(
          cause instanceof Error
            ? cause.message
            : "실전 발표를 시작하지 못했습니다.",
        );
        setRuntimeFailureOperation("start");
        setRuntimePhase("failed");
      })
      .finally(() => {
        startPromiseRef.current = null;
      });
    startPromiseRef.current = promise;
    return promise;
  }

  function finishPresentation() {
    if (finishPromiseRef.current) {
      return finishPromiseRef.current;
    }

    const promise = (async () => {
      const runtime = runtimeRef.current;
      if (!runtime || !props.projectId) {
        navigateToProject(deck?.projectId ?? props.projectId);
        return;
      }
      setRuntimePhase("finishing");
      setRuntimeError("");
      setRuntimeFailureOperation(null);
      setIsTimerRunning(false);
      captureSlideTranscriptSnapshot("rehearsal-end");
      const liveTranscript = speech.getTranscript();
      await speech.stop();

      if (recordingRef.current && !recordedFileRef.current) {
        recordedFileRef.current = await recordingRef.current.stop();
        recordingRef.current = null;
      }
      if (recordedFileRef.current && recordedFileRef.current.size > 0) {
        await uploadPresentationRecording({
          file: recordedFileRef.current,
          liveTranscript,
          projectId: props.projectId,
          runId: runtime.runId,
          sessionId: runtime.sessionId,
          slideTranscriptSnapshots: slideTranscriptSnapshotsRef.current,
        });
      } else {
        await completePresentationWithoutAudio({
          projectId: props.projectId,
          runId: runtime.runId,
          sessionId: runtime.sessionId,
        });
      }
      await activityApi.closeSession(props.projectId, runtime.sessionId);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setRuntimePhase("completed");
    })()
      .catch((cause) => {
        setRuntimeError(
          cause instanceof Error
            ? cause.message
            : "발표 기록을 저장하지 못했습니다.",
        );
        setRuntimeFailureOperation("finish");
        setRuntimePhase("failed");
      })
      .finally(() => {
        finishPromiseRef.current = null;
      });
    finishPromiseRef.current = promise;
    return promise;
  }

  function requestPresentationExit() {
    if (!requiresPresentationRuntime) {
      navigateToProject(deck?.projectId ?? props.projectId);
      return;
    }
    if (!window.confirm("발표를 종료하고 결과를 저장할까요?")) {
      return;
    }
    void finishPresentation();
  }

  async function handleTimePrimaryAction() {
    if (isTimerRunning) {
      setIsTimerRunning(false);
      recordingRef.current?.pause();
      streamRef.current?.getAudioTracks().forEach((track) => {
        track.enabled = false;
      });
      await speech.pause().catch(() => undefined);
      return;
    }

    if (timeMode === "timer" && elapsedSeconds >= timerDurationSeconds) {
      resetPresentationTimerState({
        setElapsedSeconds,
        setIsTimerRunning,
        setSlideElapsedSeconds,
      });
    }

    streamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = true;
    });
    recordingRef.current?.resume();
    if (
      requestedRecordingMode === "microphone" &&
      streamRef.current &&
      currentSlide
    ) {
      await speech
        .resume(streamRef.current, currentSlide)
        .catch(() => undefined);
    }
    setIsTimerRunning(true);
  }

  function beginSlideTranscriptVisit(
    slide: Slide,
    slideIndex: number,
    visitedAt = new Date().toISOString(),
  ) {
    const visitedVer =
      (slideTranscriptVisitVersionsRef.current.get(slide.slideId) ?? 0) + 1;
    slideTranscriptVisitVersionsRef.current.set(slide.slideId, visitedVer);
    activeSlideTranscriptVisitRef.current = {
      slideId: slide.slideId,
      slideNum: slideIndex + 1,
      visitedAt,
      visitedVer,
    };
  }

  function captureSlideTranscriptSnapshot(
    reason: SlideTranscriptSnapshot["reason"],
    capturedAt = new Date().toISOString(),
  ) {
    const activeVisit = activeSlideTranscriptVisitRef.current;
    if (!activeVisit) {
      return;
    }
    slideTranscriptSnapshotsRef.current.push({
      ...activeVisit,
      capturedAt,
      reason,
      transcript: speech.getTranscript(),
    });
    activeSlideTranscriptVisitRef.current = null;
  }

  function resetSlideTranscriptSnapshots(activeDeck: Deck, slideIndex: number) {
    slideTranscriptSnapshotsRef.current = [];
    slideTranscriptVisitVersionsRef.current = new Map();
    activeSlideTranscriptVisitRef.current = null;
    previousSlideIndexRef.current = slideIndex;
    const slide = activeDeck.slides[slideIndex];
    if (slide) {
      beginSlideTranscriptVisit(slide, slideIndex);
    }
  }

  function commitElapsedTimeInput(value: string) {
    const nextSeconds = parseClockInput(value);
    setEditingTimeField(null);

    if (nextSeconds === null) {
      setElapsedTimeInput(formatClock(displayedTimeSeconds));
      return;
    }

    const boundedSeconds = Math.min(nextSeconds, 60 * 60 * 24 - 1);
    setElapsedSeconds(
      timeMode === "timer"
        ? Math.max(timerDurationSeconds - boundedSeconds, 0)
        : boundedSeconds,
    );
  }

  function commitTimerDurationInput(value: string) {
    const nextSeconds = parseClockInput(value);
    setEditingTimeField(null);

    if (nextSeconds === null || nextSeconds <= 0) {
      setTimerDurationInput(formatClock(timerDurationSeconds));
      return;
    }

    const boundedSeconds = Math.min(nextSeconds, 60 * 60 * 24 - 1);
    setHasManualTimerDuration(true);
    setTimerDurationSeconds(boundedSeconds);
  }

  if (phase === "failed") {
    const failureCopy = getPresentationFailureCopy("load", error);

    return (
      <main className="rehearsal-presenter-shell">
        <OrbitFailureState
          description={failureCopy.description}
          onRetry={() => window.location.reload()}
          recommendedAction={failureCopy.recommendedAction}
          retryLabel="다시 불러오기"
          secondaryAction={
            <OrbitButton
              onClick={() =>
                navigateToProject(deck?.projectId ?? props.projectId)
              }
              size="prominent"
              variant="secondary"
            >
              프로젝트로 돌아가기
            </OrbitButton>
          }
          title={failureCopy.title}
        />
      </main>
    );
  }

  if (phase === "loading" && !deck) {
    return (
      <PresenterStatusShell title="발표 화면을 준비하는 중입니다.">
        최신 슬라이드와 발표 메모를 불러오고 있습니다.
      </PresenterStatusShell>
    );
  }

  if (runtimePhase === "starting") {
    return (
      <PresenterStatusShell title="실전 발표를 준비하는 중입니다.">
        발표 세션과 음성 인식을 연결하고 있습니다.
      </PresenterStatusShell>
    );
  }

  if (runtimePhase === "failed") {
    const failureOperation =
      runtimeFailureOperation === "finish" ? "finish" : "start";
    const failureCopy = getPresentationFailureCopy(
      failureOperation,
      runtimeError,
    );

    return (
      <main className="rehearsal-presenter-shell">
        <OrbitFailureState
          description={failureCopy.description}
          onRetry={() =>
            runtimeFailureOperation === "finish"
              ? void finishPresentation()
              : void startPresentation(requestedRecordingMode)
          }
          recommendedAction={failureCopy.recommendedAction}
          secondaryAction={
            <>
              {runtimeFailureOperation === "start" &&
              requestedRecordingMode === "microphone" ? (
                <OrbitButton
                  onClick={() => void startPresentation("none")}
                  size="prominent"
                  variant="secondary"
                >
                  마이크 없이 시작
                </OrbitButton>
              ) : null}
              <OrbitButton
                onClick={() =>
                  navigateToProject(deck?.projectId ?? props.projectId)
                }
                size="prominent"
                variant="secondary"
              >
                프로젝트로 돌아가기
              </OrbitButton>
            </>
          }
          title={failureCopy.title}
        />
      </main>
    );
  }

  return (
    <>
      <PresentationScreen
        adviceState={adviceState}
        animationTriggerDebug={
          animationTriggerDebugEnabled && animationTriggerDebug ? (
            <PresentationAnimationTriggerDebug
              data={animationTriggerDebug}
              onApprove={approvePresentationKeywordOccurrence}
            />
          ) : undefined
        }
        autoAdvanceStatus={
          <AutoAdvanceStatus
            countdownMs={presentationAutoAdvancePolicy.countdownMs}
            nowMs={autoAdvanceNowMs}
            onFinish={requestPresentationExit}
            state={advanceControllerState}
          />
        }
        currentSlide={currentSlide}
        currentSlideIndex={currentSlideIndex}
        deck={deck}
        elapsedTimeInput={elapsedTimeInput}
        highlightedKeywordOccurrences={highlightedKeywordOccurrences}
        infoCards={infoCards}
        isTimerRunning={isTimerRunning}
        keywords={checklistKeywords}
        miniSlideScale={miniSlideScale}
        nextHint={nextHint}
        nextSlide={nextSlide}
        onDurationInputBlur={commitTimerDurationInput}
        onDurationInputChange={(value) => {
          setEditingTimeField("duration");
          setTimerDurationInput(value);
        }}
        onDurationInputFocus={() => setEditingTimeField("duration")}
        onElapsedInputBlur={commitElapsedTimeInput}
        onElapsedInputChange={(value) => {
          setEditingTimeField("elapsed");
          setElapsedTimeInput(value);
        }}
        onElapsedInputFocus={() => setEditingTimeField("elapsed")}
        onExit={requestPresentationExit}
        onNext={handleNextPresenterStep}
        onAnimationFlowNavigate={handleAnimationFlowNavigation}
        onPrevious={goPrevious}
        onPrimaryAction={handleTimePrimaryAction}
        onReset={() =>
          resetPresentationTimerState({
            setElapsedSeconds,
            setIsTimerRunning,
            setSlideElapsedSeconds,
          })
        }
        onTimeModeChange={(value) => {
          setTimeMode(value);
          resetPresentationTimerState({
            setElapsedSeconds,
            setIsTimerRunning,
            setSlideElapsedSeconds,
          });
        }}
        panelSnapshot={panelSnapshot}
        pendingKeywordOccurrenceIds={pendingKeywordOccurrenceIds}
        presentationSession={runtimeRef.current ?? undefined}
        presenterScale={presenterScale}
        presenterStageRef={presenterStageRef}
        presenterStepIndex={presenterStepIndex}
        progressPercent={rehearsalProgressPercent}
        sentences={sentences}
        stageEmptyLabel="발표 자료를 불러오는 중입니다."
        stageIndexLabel={
          deck
            ? `${String(currentSlideIndex + 1).padStart(2, "0")} / ${String(
                deck.slides.length,
              ).padStart(2, "0")}`
            : undefined
        }
        statusLabel={presentationStatusLabel}
        timeInputValue={
          editingTimeField === "duration"
            ? timerDurationInput
            : formatClock(displayedTimeSeconds)
        }
        timeMetaLeft={`현재 ${formatClock(timing.currentSlideElapsedSeconds)}`}
        timeMetaRight={`예상 ${formatClock(timing.currentSlideTargetSeconds)}`}
        timeMode={timeMode}
        timing={timing}
        timerDurationInput={timerDurationInput}
        totalSlides={deck?.slides.length ?? 0}
        triggerAnimationIds={triggerAnimationIds}
        wordsPerMinute={speech.state.wordsPerMinute}
      />
      {runtimePhase === "preflight" ? (
        <PresentationMicCheckModal
          onClose={() => navigateToProject(deck?.projectId ?? props.projectId)}
          onStart={() => void startPresentation("microphone")}
          onStartWithoutMicrophone={() => void startPresentation("none")}
        />
      ) : null}
      {runtimePhase === "finishing" || runtimePhase === "completed" ? (
        <PresentationCompletionDialog
          isSaving={runtimePhase === "finishing"}
          onClose={() => navigateToProject(deck?.projectId ?? props.projectId)}
          onGoHome={navigateToHome}
          onOpenProject={() =>
            navigateToProject(deck?.projectId ?? props.projectId)
          }
          onOpenReport={() => {
            const runtime = runtimeRef.current;
            if (!runtime || !props.projectId) {
              return;
            }
            navigateToPresentationReport({
              projectId: props.projectId,
              runId: runtime.runId,
              sessionId: runtime.sessionId,
            });
          }}
        />
      ) : null}
    </>
  );
}

const presentationAutoAdvancePolicy = Object.freeze({
  ...defaultAutoAdvancePolicy,
  live: true,
  rehearsal: false,
});

function navigateToProject(projectId?: string) {
  if (!projectId || typeof window === "undefined") {
    return;
  }

  window.history.pushState({}, "", `/project/${encodeURIComponent(projectId)}`);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function navigateToHome() {
  if (typeof window === "undefined") {
    return;
  }

  window.history.pushState({}, "", "/");
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function navigateToPresentationReport(input: {
  projectId: string;
  runId: string;
  sessionId: string;
}) {
  if (typeof window === "undefined") {
    return;
  }
  const search = new URLSearchParams({ runId: input.runId });
  window.history.pushState(
    {},
    "",
    `/presentation/${encodeURIComponent(input.projectId)}/report/${encodeURIComponent(
      input.sessionId,
    )}?${search.toString()}`,
  );
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function createEmptySpeechTrackerSnapshot(options: {
  matchableSentenceCount: number;
  slideId: string;
}): SpeechTrackerSnapshot {
  return {
    coveredSentenceIds: [],
    coveredSentenceMatchKinds: {},
    effectiveCoverage: 0,
    finalSentenceSpoken: false,
    hitKeywordIds: [],
    matchableSentenceCount: options.matchableSentenceCount,
    provisionalMissingKeywordIds: [],
    sentenceCoverage: 0,
    slideId: options.slideId,
    wordCoverage: 0,
  };
}

function PresentationAnimationTriggerDebug(props: {
  data: {
    animationExecutionHistory: PresentationAnimationExecutionHistoryEntry[];
    actionDispatchable: boolean;
    confidence: number | null;
    approvalOccurrenceId: string | null;
    confirmedOccurrenceIds: string[];
    currentStepAnimationIds: string[];
    currentStepIndex: number;
    expectedOccurrenceIds: string[];
    latestTranscript: string;
    matches: Array<{ occurrenceId: string }>;
    newSegment: string;
    occurrenceActions: Array<{ animationId: string; occurrenceId: string }>;
    playedAnimationIds: string[];
    positionedMatches: Array<{
      currentCharOffset: number;
      occurrenceId: string;
      matchedScriptOffset: number;
    }>;
    resolutionBlocker: string | null;
    speechStatus: string;
    transcript: string;
  };
  onApprove: (occurrenceId: string) => void;
}) {
  const { data } = props;
  const blocker = getAnimationTriggerBlocker(data);

  return (
    <aside
      aria-label="애니메이션 트리거 디버그"
      className="presentation-animation-trigger-debug"
    >
      <header>
        <strong>애니메이션 트리거 디버그</strong>
        <span>URL의 <code>animationDebug=1</code>에서만 표시</span>
      </header>
      <dl>
        <div>
          <dt>STT 상태</dt>
          <dd>{data.speechStatus}</dd>
        </div>
        <div>
          <dt>최근 인식</dt>
          <dd>{data.latestTranscript || "-"}</dd>
        </div>
        <div>
          <dt>confidence</dt>
          <dd>{data.confidence?.toFixed(2) ?? "브라우저 미제공"}</dd>
        </div>
        <div>
          <dt>실행용 전사 구간</dt>
          <dd>{data.newSegment || "-"}</dd>
        </div>
        <div>
          <dt>실행 증거</dt>
          <dd>{data.actionDispatchable ? "확정" : "안정화 대기"}</dd>
        </div>
        <div>
          <dt>현재 step occurrence</dt>
          <dd>{formatDebugValues(data.expectedOccurrenceIds)}</dd>
        </div>
        <div>
          <dt>위치 정렬 occurrence</dt>
          <dd>
            {formatDebugValues(
              data.positionedMatches.map(
                (match) =>
                  `${match.occurrenceId} (${match.matchedScriptOffset}→${match.currentCharOffset})`,
              ),
            )}
          </dd>
        </div>
        <div>
          <dt>매칭 occurrence</dt>
          <dd>{formatDebugValues(data.matches.map((match) => match.occurrenceId))}</dd>
        </div>
        <div>
          <dt>소비된 occurrence</dt>
          <dd>{formatDebugValues(data.confirmedOccurrenceIds)}</dd>
        </div>
        <div>
          <dt>실행된 animation</dt>
          <dd>{formatDebugValues(data.playedAnimationIds)}</dd>
        </div>
        <div>
          <dt>현재 step</dt>
          <dd>
            {data.currentStepIndex} · {formatDebugValues(data.currentStepAnimationIds)}
          </dd>
        </div>
      </dl>
      <p className="presentation-animation-trigger-debug-blocker">
        판정: {blocker}
      </p>
      {data.approvalOccurrenceId ? (
        <button
          type="button"
          onClick={() => props.onApprove(data.approvalOccurrenceId ?? "")}
        >
          이 키워드 효과 실행
        </button>
      ) : null}
      <details>
        <summary>연결 데이터 보기</summary>
        <p>현재 step occurrence: {formatDebugValues(data.expectedOccurrenceIds)}</p>
        <p>
          action 연결: {" "}
          {formatDebugValues(
            data.occurrenceActions.map(
              (action) => `${action.occurrenceId} → ${action.animationId}`,
            ),
          )}
        </p>
        <p>누적 전사: {data.transcript || "-"}</p>
      </details>
      <section className="presentation-animation-trigger-history">
        <strong>애니메이션 실행 이력</strong>
        {data.animationExecutionHistory.length > 0 ? (
          <ol>
            {data.animationExecutionHistory.map((entry) => (
              <li key={entry.id}>
                <span>{formatAnimationExecutionTime(entry.atMs)}</span>
                <strong>{getAnimationExecutionSourceLabel(entry.source)}</strong>
                <span>step {entry.stepBefore} → {entry.stepAfter}</span>
                <span>효과: {formatDebugValues(entry.animationIds)}</span>
                <span>occurrence: {formatDebugValues(entry.consumedOccurrenceIds)}</span>
                {entry.newSegment ? <span>전사: {entry.newSegment}</span> : null}
              </li>
            ))}
          </ol>
        ) : (
          <p>아직 실행된 애니메이션이 없습니다.</p>
        )}
      </section>
    </aside>
  );
}

function getAnimationExecutionSourceLabel(
  source: PresentationAnimationExecutionSource,
) {
  switch (source) {
    case "speech":
      return "STT";
    case "approval":
      return "수동 승인";
    case "generic-keyword":
      return "일반 키워드";
    case "click":
      return "클릭";
  }
}

function formatAnimationExecutionTime(atMs: number) {
  return new Date(atMs).toLocaleTimeString("ko-KR", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function getAnimationTriggerBlocker(data: {
  confidence: number | null;
  confirmedOccurrenceIds: string[];
  latestTranscript: string;
  matches: Array<{ occurrenceId: string }>;
  occurrenceActions: Array<{ animationId: string; occurrenceId: string }>;
  speechStatus: string;
  expectedOccurrenceIds: string[];
  resolutionBlocker: string | null;
}) {
  if (data.speechStatus !== "listening") {
    return "음성 인식이 listening 상태가 아닙니다.";
  }
  if (!data.latestTranscript.trim()) {
    return "아직 STT 결과가 없습니다.";
  }
  if (data.confidence !== null && data.confidence < 0.7) {
    return "confidence가 0.70 미만이라 자동 실행을 막았습니다.";
  }
  if (data.occurrenceActions.length === 0) {
    return "occurrence action 연결을 찾지 못했습니다.";
  }
  if (
    data.expectedOccurrenceIds.length > 0 &&
    data.expectedOccurrenceIds.every((occurrenceId) =>
      data.confirmedOccurrenceIds.includes(occurrenceId),
    )
  ) {
    return "해당 occurrence는 이미 처리되어 중복 실행하지 않습니다.";
  }
  if (!data.expectedOccurrenceIds.length) {
    return "현재 step은 키워드 애니메이션 단계가 아닙니다.";
  }
  if (data.matches.length === 0) {
    return data.resolutionBlocker === "confidence-low"
      ? "confidence가 0.70 미만이라 자동 실행을 막았습니다."
      : `현재 step occurrence와 새 전사 구간이 일치하지 않습니다. (${data.resolutionBlocker ?? "unknown"})`;
  }
  return "매칭 성공: 다음 렌더에서 action 실행·step 전진을 확인하세요.";
}

function formatDebugValues(values: readonly string[]) {
  return values.length > 0 ? values.join(", ") : "-";
}

function getMiniSlideScale(deck: Deck) {
  return Math.min(0.16, 154 / deck.canvas.width, 87 / deck.canvas.height);
}

function getSlideTitle(slide: Slide) {
  const title = slide.title.trim();
  if (title) {
    return title;
  }

  const titleElement = slide.elements.find(
    (element): element is Extract<DeckElement, { type: "text" }> =>
      element.type === "text" && element.role === "title",
  );
  return titleElement?.props.text || `Slide ${slide.order}`;
}

function formatClock(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = Math.floor(totalSeconds % 60)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function parseClockInput(value: string): number | null {
  const normalizedValue = value.trim();
  const match = normalizedValue.match(/^(\d{1,3})(?::([0-5]?\d))?$/);

  if (!match) {
    return null;
  }

  const minutes = Number(match[1]);
  const seconds = Number(match[2] ?? 0);

  if (!Number.isInteger(minutes) || !Number.isInteger(seconds)) {
    return null;
  }

  return minutes * 60 + seconds;
}

function resetPresentationTimerState(actions: {
  setElapsedSeconds: (value: number) => void;
  setIsTimerRunning: (value: boolean) => void;
  setSlideElapsedSeconds: (value: number) => void;
}) {
  actions.setElapsedSeconds(0);
  actions.setSlideElapsedSeconds(0);
  actions.setIsTimerRunning(false);
}

function usePresenterStageScale(deck: Deck | null) {
  const [presenterStageElement, setPresenterStageElement] =
    useState<HTMLDivElement | null>(null);
  const [presenterScale, setPresenterScale] = useState(0.44);
  const presenterStageRef = useCallback((node: HTMLDivElement | null) => {
    setPresenterStageElement(node);
  }, []);

  useEffect(() => {
    const stage = presenterStageElement;
    if (!stage || !deck) {
      return;
    }

    let animationFrame: number | null = null;

    const updateScale = () => {
      const bounds = stage.getBoundingClientRect();
      const style = window.getComputedStyle(stage);
      const horizontalPadding =
        Number.parseFloat(style.paddingLeft) +
        Number.parseFloat(style.paddingRight);
      const verticalPadding =
        Number.parseFloat(style.paddingTop) +
        Number.parseFloat(style.paddingBottom);
      const availableWidth = Math.max(0, bounds.width - horizontalPadding);
      const availableHeight = Math.max(0, bounds.height - verticalPadding);
      const nextScale = Math.min(
        availableWidth / deck.canvas.width,
        availableHeight / deck.canvas.height,
      );
      if (Number.isFinite(nextScale) && nextScale > 0) {
        setPresenterScale((current) =>
          Math.abs(current - nextScale) > 0.001 ? nextScale : current,
        );
      }
    };
    const scheduleScaleUpdate = () => {
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
      animationFrame = window.requestAnimationFrame(updateScale);
    };

    updateScale();
    scheduleScaleUpdate();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", scheduleScaleUpdate);
      return () => {
        window.removeEventListener("resize", scheduleScaleUpdate);
        if (animationFrame !== null) {
          window.cancelAnimationFrame(animationFrame);
        }
      };
    }

    const observer = new ResizeObserver(scheduleScaleUpdate);
    observer.observe(stage);
    window.addEventListener("resize", scheduleScaleUpdate);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", scheduleScaleUpdate);
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
    };
  }, [deck, presenterStageElement]);

  return { presenterScale, presenterStageRef };
}
