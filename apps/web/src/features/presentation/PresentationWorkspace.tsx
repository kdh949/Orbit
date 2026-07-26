import {
  createSlidePlaybackState,
  type SlidePlaybackState,
} from "@orbit/editor-core/playback";
import type {
  PresentationRecordingMode,
} from "@orbit/shared/presentation";
import type {
  Deck,
  DeckElement,
  Slide,
} from "@orbit/shared/deck";
import type {
  SlideTranscriptSnapshot,
} from "@orbit/shared/rehearsals";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OrbitButton, OrbitFailureState } from "../../components/ui";
import { PresentationScreen } from "./PresentationScreen";
import { PresentationCompletionDialog } from "./PresentationCompletionDialog";
import { PresentationMicCheckModal } from "./PresentationMicCheckModal";
import {
  completePresentationWithoutAudio,
  closePresenterCompanionSession,
  ensurePresenterCompanionSession,
  fetchOrCreatePresentationDeck,
  startPresentationRuntime,
  uploadPresentationRecording,
  type PresenterCompanionSessionIdentity,
  type PresentationRuntimeIdentity,
} from "./presentationApi";
import {
  createPresentationRecordingSession,
  type PresentationRecordingSession,
} from "./presentationRecording";
import { usePresentationSpeech } from "./usePresentationSpeech";
import { getPresentationHighlightedKeywordOccurrences } from "./presentationKeywordOccurrences";
import { getPresentationFailureCopy } from "./presentationFailureCopy";
import {
  shouldClosePresenterSessionOnPreflightExit,
  shouldWarnBeforePresentationUnload,
  type PresentationRuntimePhase,
} from "./presentationLifecycle";
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
import { createSlideshowAnimationPlan } from "../../runtime/presentation/slideshow/slideshowStepModel";
import { usePresenterKeyboard } from "../rehearsal/presenter/usePresenterKeyboard";
import { AudienceOutputControls } from "../rehearsal/presenter/AudienceOutputControls";
import {
  DisplayControls,
  type RequestDisplayScreensResult,
  type RequestSlideWindowFullscreenResult,
  type SlideDisplayOptions,
} from "../rehearsal/presenter/DisplayControls";
import {
  createDisplayManager,
  type DisplayManagerErrorCode,
  type DisplayScreenDescriptor,
  type SlideWindowRef,
} from "../../runtime/presentation/displayManager";
import {
  createAudiencePresenterState,
  createSlideWindowDeckSnapshot,
  type PresenterRemoteCommand,
} from "../rehearsal/presenter/presentationChannel";
import type {
  AudienceOutputMode,
  PresenterSlideshowState,
} from "../rehearsal/presenter/presenterStateStore";
import {
  PresentWindowReceiver,
  requestPresentWindowFullscreen,
} from "../rehearsal/presenter/PresentWindow";
import { PresenterRemoteWindow } from "../rehearsal/presenter/PresenterRemoteWindow";
import type { AudienceStreamBridgeWindow } from "../../runtime/presentation/audienceStreamBridge";
import { useLivePresentationOutput } from "./useLivePresentationOutput";
import { PresenterCompanionSetup } from "../presenter-companion/PresenterCompanionSetup";
import { PresenterCompanionStatus } from "../presenter-companion/PresenterCompanionStatus";
import { usePresenterCompanionFeatureFlag } from "../presenter-companion/usePresenterCompanionFeatureFlag";
import {
  createCompanionPrompterProjection,
  getCompanionPrompterTrackingStatus,
} from "../presenter-companion/companionPrompterProjection";
import { createRehearsalScriptPrompterRows } from "../rehearsal/panel/rehearsalScriptPrompter";
import {
  getTriggerAnimationIdsForSlide,
  getKeywordOccurrenceTriggerIdsForSlide,
  restoreSlidePlaybackAtStep,
  resolveManualAnimationPlaybackUpdate,
  resolveKeywordOccurrenceTriggeredActions,
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
import { createDefaultPhraseExtractor } from "../../runtime/speech/tracking/phraseExtractor";
import {
  estimateScriptProgressOffset,
  matchKeywordOccurrenceTriggers,
} from "../../runtime/speech/tracking/keywordOccurrenceRuntime";
import type { SpeechTrackerSnapshot } from "../../runtime/speech/tracking/speechTrackingEvents";
import { createIdleSemanticDebugState } from "../rehearsal/speech/semanticSpeechDebug";
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
export function PresentationWorkspace(props: {
  fallbackDeck?: Deck;
  initialDeck?: Deck;
  initialSlideIndex?: number;
  initialStepIndex?: number;
  localWindowSessionId?: string;
  presenterWindow?: boolean;
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
  const [audienceOutputMode, setAudienceOutputMode] =
    useState<AudienceOutputMode>("slide");
  const [displayRole, setDisplayRole] = useState<
    "presenter" | "slide-receiver" | "slide-surface"
  >("presenter");
  const [slideReceiverMessage, setSlideReceiverMessage] = useState("");
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
    props.projectId && !props.initialDeck && !props.presenterWindow,
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
  const presenterSessionRef =
    useRef<PresenterCompanionSessionIdentity | null>(null);
  const [presenterSession, setPresenterSession] =
    useState<PresenterCompanionSessionIdentity | null>(null);
  const presenterSessionPromiseRef =
    useRef<Promise<PresenterCompanionSessionIdentity> | null>(null);
  const presenterSessionPromiseKeyRef = useRef<string | null>(null);
  const closePresenterSessionPromiseRef = useRef<Promise<void> | null>(null);
  const slideWindowRef = useRef<SlideWindowRef | null>(null);
  const reattachAudienceStreamRef = useRef<() => boolean>(() => false);
  const stopAudienceStreamRef = useRef<() => void>(() => undefined);
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
  const speech = usePresentationSpeech(props.projectId);
  const presenterCompanionEnabled = usePresenterCompanionFeatureFlag();

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
    if (!requiresPresentationRuntime || !deck || !props.projectId) {
      return;
    }

    let isCancelled = false;
    setRuntimePhase("starting");
    setRuntimeError("");
    setRuntimeFailureOperation(null);
    void ensurePresentationSession()
      .then(() => {
        if (!isCancelled) {
          setRuntimePhase("preflight");
        }
      })
      .catch((cause) => {
        if (!isCancelled) {
          setRuntimeError(
            cause instanceof Error
              ? cause.message
              : "실전 발표 세션을 준비하지 못했습니다.",
          );
          setRuntimeFailureOperation("start");
          setRuntimePhase("failed");
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [
    deck?.deckId,
    deck?.version,
    props.projectId,
    requiresPresentationRuntime,
  ]);

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
  const animationTriggerDebugEnabled =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("animationDebug") === "1";
  const animationTriggerDebug = useMemo(() => {
    if (!currentSlide) {
      return null;
    }

    const targetOccurrenceIds = getKeywordOccurrenceTriggerIdsForSlide(
      currentSlide,
    );
    const confirmedOccurrenceIds =
      keywordOccurrenceStateRef.current?.slideId === currentSlide.slideId
        ? keywordOccurrenceStateRef.current.confirmedOccurrenceIds
        : [];
    const transcriptSpan = speech.getSlideTranscriptSpan();
    const transcript = transcriptSpan.transcript;
    const confidence = speech.state.latestTranscriptConfidence;
    const matches = matchKeywordOccurrenceTriggers({
      slide: currentSlide,
      targetOccurrenceIds,
      previousTranscript: transcriptSpan.previousTranscript,
      transcript,
      latestTranscript: speech.state.latestTranscript,
      confidence,
      confirmedOccurrenceIds,
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
      currentCharOffset: estimateScriptProgressOffset(
        currentSlide.speakerNotes,
        transcript,
      ),
      previousCharOffset: estimateScriptProgressOffset(
        currentSlide.speakerNotes,
        transcriptSpan.previousTranscript,
      ),
      currentStepAnimationIds:
        currentTriggerStep?.animations.map((animation) => animation.animationId) ??
        [],
      currentStepIndex: presenterStepIndex,
      latestTranscript: speech.state.latestTranscript,
      matches,
      occurrenceActions,
      playedAnimationIds: playbackStateRef.current.playedAnimationIds,
      speechStatus: speech.state.status,
      targetOccurrenceIds,
      transcript,
    };
  }, [
    currentSlide,
    presenterStepIndex,
    slideshowAnimationPlan,
    speech,
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
  const companionPrompterState = useMemo(
    () =>
      currentSlide
        ? createCompanionPrompterProjection({
            progressPercent:
              (panelSnapshot.scriptProgress?.ratio ?? 0) * 100,
            rows: createRehearsalScriptPrompterRows({
              sentences,
              coveredSentenceIds: panelSnapshot.coveredSentenceIds,
              coveredSentenceMatchKinds:
                panelSnapshot.coveredSentenceMatchKinds,
              prompterProgress: panelSnapshot.prompterProgress,
            }).map((row) => ({
              isFocusTarget: row.isFocusTarget,
              sentenceId: row.sentence.sentenceId,
              status: row.status,
              text: row.sentence.text,
            })),
            slideId: currentSlide.slideId,
            slideIndex: currentSlideIndex,
            trackingStatus: getCompanionPrompterTrackingStatus(
              speech.state.status,
            ),
          })
        : null,
    [
      currentSlide,
      currentSlideIndex,
      panelSnapshot,
      sentences,
      speech.state.status,
    ],
  );
  const presentationOutputState = useMemo<PresenterSlideshowState | null>(
    () =>
      currentSlide
        ? {
            audienceOutputMode,
            highlights: [],
            slideId: currentSlide.slideId,
            slideIndex: currentSlideIndex,
            speech: {
              coveredSentenceIds: panelSnapshot.coveredSentenceIds,
              coveredSentenceMatchKinds:
                panelSnapshot.coveredSentenceMatchKinds,
              matchableSentenceCount: panelSnapshot.matchableSentenceCount,
              semanticDebug: createIdleSemanticDebugState(),
              semanticMatchingEnabled: false,
              snapshot: speech.state.snapshot ?? null,
            },
            stepIndex: presenterStepIndex,
            timing: {
              canStartLiveStt: runtimePhase === "active",
              currentSlideElapsedSeconds: slideElapsedSeconds,
              currentSlideTargetSeconds,
              displayedSeconds: displayedTimeSeconds,
              elapsedSeconds,
              isLiveSttActive:
                speech.state.status === "listening" ||
                speech.state.status === "starting",
              isPaused: speech.state.status === "paused",
              isRunning: isTimerRunning,
              liveStatus: speech.state.status,
              mode: timeMode === "timer" ? "timer" : "stopwatch",
              timerDurationSeconds,
            },
          }
        : null,
    [
      audienceOutputMode,
      currentSlide,
      currentSlideIndex,
      currentSlideTargetSeconds,
      displayedTimeSeconds,
      elapsedSeconds,
      isTimerRunning,
      panelSnapshot,
      presenterStepIndex,
      runtimePhase,
      slideElapsedSeconds,
      speech.state.snapshot,
      speech.state.status,
      timeMode,
      timerDurationSeconds,
    ],
  );
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
    setPresenterStepIndex(0);
    setCurrentSlideIndex((current) => Math.max(0, current - 1));
  }, [cancelAutoAdvanceForManualCommand]);

  const goNext = useCallback(() => {
    if (!deck) {
      return;
    }

    cancelAutoAdvanceForManualCommand();
    setPresenterStepIndex(0);
    setCurrentSlideIndex((current) =>
      Math.min(deck.slides.length - 1, current + 1),
    );
  }, [cancelAutoAdvanceForManualCommand, deck]);

  const applyPlaybackUpdate = useCallback(
    (args: {
      consumedOccurrenceIds?: readonly string[];
      slide: Slide;
      update: ReturnType<typeof resolveTriggeredActionPlaybackUpdate>;
    }) => {
      playbackStateRef.current = args.update.playbackState;

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
      }

      if (args.update.shouldAdvanceSlide) {
        goNext();
        return;
      }

      setPresenterStepIndex(args.update.presenterStepIndex);
    },
    [goNext],
  );

  const handleNextPresenterStep = useCallback(() => {
    if (!currentSlide || !slideshowAnimationPlan) {
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
      update,
    });
  }, [applyPlaybackUpdate, currentSlide, presenterStepIndex, slideshowAnimationPlan]);

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
    if (
      !currentSlide ||
      !slideshowAnimationPlan ||
      runtimePhase !== "active" ||
      speech.state.status !== "listening" ||
      !speech.state.latestTranscript.trim()
    ) {
      return;
    }

    const currentState =
      keywordOccurrenceStateRef.current?.slideId === currentSlide.slideId
        ? keywordOccurrenceStateRef.current
        : { slideId: currentSlide.slideId, confirmedOccurrenceIds: [] };
    const transcriptSpan = speech.getSlideTranscriptSpan();
    const matches = matchKeywordOccurrenceTriggers({
      slide: currentSlide,
      targetOccurrenceIds: getKeywordOccurrenceTriggerIdsForSlide(currentSlide),
      previousTranscript: transcriptSpan.previousTranscript,
      transcript: transcriptSpan.transcript,
      latestTranscript: speech.state.latestTranscript,
      confidence: speech.state.latestTranscriptConfidence,
      confirmedOccurrenceIds: currentState.confirmedOccurrenceIds,
    });
    if (matches.length === 0) {
      return;
    }

    const update = resolveTriggeredActionPlaybackUpdate({
      actions: matches.flatMap((match) =>
        resolveKeywordOccurrenceTriggeredActions(
          currentSlide,
          match.keywordId,
          match.occurrenceId,
        ),
      ),
      playbackState: playbackStateRef.current,
      presenterStepIndex,
      slide: currentSlide,
      slideAnimationPlan: slideshowAnimationPlan,
    });
    applyPlaybackUpdate({
      consumedOccurrenceIds: matches.map((match) => match.occurrenceId),
      slide: currentSlide,
      update,
    });
  }, [
    applyPlaybackUpdate,
    currentSlide,
    presenterStepIndex,
    runtimePhase,
    slideshowAnimationPlan,
    speech.state.latestTranscript,
    speech.state.latestTranscriptConfidence,
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
      applyPlaybackUpdate({ slide: currentSlide, update });
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

  function ensurePresentationSession() {
    const sessionKey = deck ? `${deck.deckId}:${deck.version}` : null;
    if (
      presenterSessionRef.current &&
      deck &&
      presenterSessionRef.current.deckId === deck.deckId &&
      presenterSessionRef.current.deckVersion === deck.version
    ) {
      return Promise.resolve(presenterSessionRef.current);
    }
    if (
      presenterSessionPromiseRef.current &&
      presenterSessionPromiseKeyRef.current === sessionKey
    ) {
      return presenterSessionPromiseRef.current;
    }
    if (!deck || !props.projectId) {
      return Promise.reject(new Error("발표 자료가 준비되지 않았습니다."));
    }
    presenterSessionRef.current = null;
    presenterSessionPromiseKeyRef.current = sessionKey;

    const promise = ensurePresenterCompanionSession({
      deckId: deck.deckId,
      projectId: props.projectId,
      sessionPurpose: "presentation",
    })
      .then((session) => {
        if (presenterSessionPromiseKeyRef.current === sessionKey) {
          presenterSessionRef.current = session;
          setPresenterSession(session);
        }
        return session;
      })
      .finally(() => {
        if (presenterSessionPromiseKeyRef.current === sessionKey) {
          presenterSessionPromiseRef.current = null;
          presenterSessionPromiseKeyRef.current = null;
        }
      });
    presenterSessionPromiseRef.current = promise;
    return promise;
  }

  function closePresentationSession() {
    if (closePresenterSessionPromiseRef.current) {
      return closePresenterSessionPromiseRef.current;
    }
    const session = presenterSessionRef.current;
    if (!session || !props.projectId) {
      return Promise.resolve();
    }
    const promise = closePresenterCompanionSession({
      projectId: props.projectId,
      sessionId: session.sessionId,
    })
      .then(() => {
        if (presenterSessionRef.current?.sessionId === session.sessionId) {
          presenterSessionRef.current = null;
          setPresenterSession(null);
        }
      })
      .finally(() => {
        closePresenterSessionPromiseRef.current = null;
      });
    closePresenterSessionPromiseRef.current = promise;
    return promise;
  }

  async function leavePresentation() {
    if (
      shouldClosePresenterSessionOnPreflightExit(
        presenterSessionRef.current?.audienceAccessEnabled ?? null,
      )
    ) {
      await closePresentationSession().catch(() => undefined);
    }
    navigateToProject(deck?.projectId ?? props.projectId);
  }

  function startPresentation(recordingMode: PresentationRecordingMode) {
    if (startPromiseRef.current) {
      return startPromiseRef.current;
    }

    const promise = (async () => {
      if (!deck || !currentSlide || !props.projectId) {
        throw new Error("발표 자료가 준비되지 않았습니다.");
      }
      setRuntimePhase("starting");
      setRuntimeError("");
      setRuntimeFailureOperation(null);
      setRequestedRecordingMode(recordingMode);

      const presenterSession = await ensurePresentationSession();
      const runtime =
        runtimeRef.current ??
        (await startPresentationRuntime({
          projectId: props.projectId,
          recordingMode,
          session: presenterSession,
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
        audienceAccessEnabled: runtime.audienceUrl !== null,
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
      await closePresentationSession();
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

  function handlePresenterRemoteCommand(command: PresenterRemoteCommand) {
    switch (command.action) {
      case "finish":
        void finishPresentation();
        return;
      case "next-step":
        handleNextPresenterStep();
        return;
      case "prev":
        goPrevious();
        return;
      case "goto":
        handleAnimationFlowNavigation({
          kind: "slide",
          stepIndex: command.stepIndex ?? 0,
          targetSlideIndex: command.slideIndex,
        });
        return;
      case "set-audience-output":
        setAudienceOutputMode(command.mode);
        return;
      case "timer-pause":
        if (isTimerRunning) void handleTimePrimaryAction();
        return;
      case "timer-reset":
        resetPresentationTimerState({
          setElapsedSeconds,
          setIsTimerRunning,
          setSlideElapsedSeconds,
        });
        return;
      case "timer-start":
        if (!isTimerRunning) void handleTimePrimaryAction();
        return;
    }
  }

  const displayManager = useMemo(() => createDisplayManager(), []);
  const presentationScreenSession = useMemo(
    () =>
      createPresentationScreenSession(
        runtimeRef.current,
        presenterSession,
      ),
    [presenterSession, runtimePhase],
  );
  const activityElementRuntime = useMemo(
    () => ({
      audienceUrl: presentationScreenSession?.audienceUrl ?? null,
      passcodeState:
        presentationScreenSession?.passcodeState ??
        ({ status: "not-prepared" } as const),
    }),
    [presentationScreenSession],
  );
  const livePresentationOutput = useLivePresentationOutput({
    activityElementRuntime,
    audienceWindowConnected: Boolean(
      slideWindowRef.current && !slideWindowRef.current.closed,
    ),
    canGoNext: Boolean(
      deck &&
        (presenterStepIndex <
          (slideshowAnimationPlan?.maxStepIndex ?? 0) ||
          currentSlideIndex < deck.slides.length - 1),
    ),
    canGoPrevious: currentSlideIndex > 0,
    companionEnabled: presenterCompanionEnabled,
    deck,
    displayRole,
    enabled:
      !props.presenterWindow &&
      (displayRole === "presenter" ||
        displayRole === "slide-receiver" ||
        displayRole === "slide-surface"),
    getAudienceWindow: () =>
      slideWindowRef.current as unknown as AudienceStreamBridgeWindow | null,
    localWindowSessionId: props.localWindowSessionId,
    onCommand: handlePresenterRemoteCommand,
    onOutputModeChange: setAudienceOutputMode,
    onPeerReady: (peer) => {
      if (peer === "slide-window") {
        reattachAudienceStreamRef.current();
      }
    },
    onScreenShareEnded: () => stopAudienceStreamRef.current(),
    outputMode: audienceOutputMode,
    persistedSessionId: presenterSession?.sessionId,
    prompterState: companionPrompterState,
    state: presentationOutputState,
    triggerAnimationIds,
  });
  const presentationChannel = livePresentationOutput.localChannel;
  const slideReceiverIdentity =
    livePresentationOutput.hostIdentity.localChannel;
  const audienceScreenShare = livePresentationOutput.screenShare;
  reattachAudienceStreamRef.current = audienceScreenShare.reattach;
  stopAudienceStreamRef.current = () =>
    audienceScreenShare.stopSharing({ returnToSlide: true });
  const slideReceiverSnapshot = useMemo(
    () =>
      deck && presentationOutputState
        ? {
            activityElementRuntime,
            deck: createSlideWindowDeckSnapshot(deck),
            state: createAudiencePresenterState(presentationOutputState),
            triggerAnimationIds,
          }
        : null,
    [
      activityElementRuntime.audienceUrl,
      activityElementRuntime.passcodeState,
      deck,
      presentationOutputState,
      triggerAnimationIds,
    ],
  );

  const resetSlideDisplayToBeginning = () => {
    setCurrentSlideIndex(0);
    setPresenterStepIndex(0);
  };
  const closeSlideWindow = (windowRef: SlideWindowRef | null) => {
    if (windowRef && !windowRef.closed) {
      windowRef.close?.();
    }
  };
  const closeExistingSlideWindow = () => {
    closeSlideWindow(slideWindowRef.current);
    slideWindowRef.current = null;
  };
  const publishSlideWindowSnapshot = (deferUntilNextRender: boolean) => {
    if (deferUntilNextRender && typeof window !== "undefined") {
      window.setTimeout(() => presentationChannel.publishSnapshot(), 0);
      return;
    }
    presentationChannel.publishSnapshot();
  };
  const requestDisplayScreens =
    async (): Promise<RequestDisplayScreensResult> => {
      const result = await displayManager.listExternalScreens();
      return result.ok
        ? { ok: true, screens: result.value }
        : { code: result.code, ok: false };
    };
  const requestSlideWindowFullscreen =
    async (): Promise<RequestSlideWindowFullscreenResult> => {
      if (!slideWindowRef.current || slideWindowRef.current.closed) {
        return { code: "fullscreen-blocked", ok: false };
      }
      const result = displayManager.delegateSlideWindowFullscreen(
        slideWindowRef.current,
      );
      return result.ok ? { ok: true } : { code: result.code, ok: false };
    };
  const buildPresenterRemoteWindowPath = () => {
    const projectId = deck?.projectId ?? props.projectId ?? "";
    const params = new URLSearchParams({
      presenterSessionId: presentationChannel.sessionId,
      presenterWindow: "1",
      slideIndex: String(currentSlideIndex),
      stepIndex: String(presenterStepIndex),
    });
    return `/presentation/${encodeURIComponent(projectId)}?${params.toString()}`;
  };
  const openSurfaceSwapDisplay = async (
    options: SlideDisplayOptions,
    targetScreen: DisplayScreenDescriptor,
    placementCode?: DisplayManagerErrorCode,
  ) => {
    if (options.startFromBeginning) {
      resetSlideDisplayToBeginning();
    }
    const presenterScreen = displayManager.getCurrentScreen();
    const fullscreenResult = await displayManager.requestFullscreenOnScreen(
      typeof document === "undefined" ? null : document.documentElement,
      targetScreen.screenIndex,
    );
    if (!fullscreenResult.ok) {
      return {
        autoPlaced: false,
        displayOpened: false,
        fullscreenStarted: false,
        placementCode: fullscreenResult.code,
        placementTargetLabel: targetScreen.label,
      };
    }
    closeExistingSlideWindow();
    const remoteWindowResult = displayManager.openPresenterRemoteWindow(
      buildPresenterRemoteWindowPath(),
      {
        screen: presenterScreen,
        target: `orbit-presentation-presenter-${presentationChannel.sessionId}-${Date.now()}`,
      },
    );
    setSlideReceiverMessage(
      remoteWindowResult.ok
        ? ""
        : "팝업이 차단되었습니다. 이 화면의 제어 버튼으로 발표를 계속할 수 있습니다.",
    );
    setDisplayRole("slide-surface");
    publishSlideWindowSnapshot(options.startFromBeginning);
    return {
      autoPlaced: true,
      displayOpened: true,
      fullscreenStarted: true,
      placementCode: remoteWindowResult.ok
        ? placementCode
        : remoteWindowResult.code,
      placementTargetLabel: targetScreen.label,
    };
  };
  const openSlideDisplay = async (options: SlideDisplayOptions) => {
    audienceScreenShare.returnToSlide();
    if (!deck || !currentSlide) {
      return {
        displayMode: options.displayMode,
        displayOpened: false,
        fullscreenStarted: false,
      };
    }
    if (options.startFromBeginning) {
      resetSlideDisplayToBeginning();
    }
    if (options.displayMode === "current-window") {
      const fullscreenStarted = options.fullscreen
        ? await requestPresentWindowFullscreen(
            typeof document === "undefined"
              ? null
              : document.documentElement,
          )
        : false;
      setDisplayRole("slide-receiver");
      return {
        displayMode: "current-window" as const,
        displayOpened: true,
        fullscreenStarted,
      };
    }
    const targetScreen = options.autoPlace
      ? (options.targetScreen ?? null)
      : null;
    if (
      options.presenterView &&
      options.fullscreen &&
      options.autoPlace &&
      targetScreen
    ) {
      const surfaceSwapResult = await openSurfaceSwapDisplay(
        options,
        targetScreen,
      );
      if (surfaceSwapResult.fullscreenStarted) {
        return {
          ...surfaceSwapResult,
          displayMode: "slide-window" as const,
        };
      }
    }
    const previousSlideWindow = slideWindowRef.current;
    const openResult = displayManager.openSlideWindow(slideReceiverIdentity, {
      screen: targetScreen,
      target: `orbit-presentation-slide-${presentationChannel.sessionId}-${Date.now()}`,
    });
    if (!openResult.ok) {
      return {
        displayMode: "slide-window" as const,
        displayOpened: false,
        fullscreenStarted: false,
        placementCode: openResult.code,
        placementTargetLabel: targetScreen?.label,
      };
    }
    if (previousSlideWindow !== openResult.value) {
      closeSlideWindow(previousSlideWindow);
    }
    slideWindowRef.current = openResult.value;
    publishSlideWindowSnapshot(options.startFromBeginning);
    return {
      autoPlaced: Boolean(targetScreen),
      displayMode: "slide-window" as const,
      displayOpened: true,
      fullscreenStarted: false,
      placementTargetLabel: targetScreen?.label,
    };
  };

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

  if (props.presenterWindow && deck && presentationOutputState) {
    return (
      <PresenterRemoteWindow
        deck={deck}
        identity={slideReceiverIdentity}
        initialState={presentationOutputState}
      />
    );
  }

  if (
    (displayRole === "slide-receiver" || displayRole === "slide-surface") &&
    slideReceiverSnapshot
  ) {
    return (
      <PresentWindowReceiver
        controlOverlayMode={
          displayRole === "slide-receiver" ? "always" : "fallback"
        }
        fullscreenMessage={slideReceiverMessage}
        identity={slideReceiverIdentity}
        initialSnapshot={slideReceiverSnapshot}
        onExit={() => {
          if (typeof document !== "undefined" && document.fullscreenElement) {
            void document.exitFullscreen();
          }
          setDisplayRole("presenter");
          setSlideReceiverMessage("");
        }}
        onNextStep={handleNextPresenterStep}
        onPreviousSlide={goPrevious}
        onReconnectPresenter={(snapshot) => {
          const projectId = deck?.projectId ?? props.projectId ?? "";
          const params = new URLSearchParams({
            presenterSessionId: presentationChannel.sessionId,
            presenterWindow: "1",
            slideIndex: String(snapshot.state.slideIndex),
            stepIndex: String(snapshot.state.stepIndex),
          });
          const presenterWindow = window.open(
            `/presentation/${encodeURIComponent(projectId)}?${params.toString()}`,
            `orbit-presentation-presenter-${presentationChannel.sessionId}`,
            "popup=yes,width=1512,height=900",
          );
          presenterWindow?.focus();
          setSlideReceiverMessage(
            presenterWindow
              ? ""
              : "팝업이 차단되었습니다. 브라우저 팝업을 허용한 뒤 다시 시도해주세요.",
          );
        }}
      />
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
                onClick={() => void leavePresentation()}
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
            <PresentationAnimationTriggerDebug data={animationTriggerDebug} />
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
        displayToolbar={
          <>
            <DisplayControls
              channelStatus={presentationChannel.status}
              onOpenSlideDisplay={openSlideDisplay}
              onRequestDisplayScreens={requestDisplayScreens}
              onRequestSlideWindowFullscreen={requestSlideWindowFullscreen}
            />
            <AudienceOutputControls
              connected={presentationChannel.status === "connected"}
              error={audienceScreenShare.error}
              onReturnToSlide={audienceScreenShare.returnToSlide}
              onShowBlack={audienceScreenShare.showBlack}
              onStartMonitor={audienceScreenShare.startMonitor}
              onStartTabOrWindow={audienceScreenShare.startTabOrWindow}
              outputMode={audienceOutputMode}
              status={audienceScreenShare.status}
            />
            {presenterCompanionEnabled && presenterSession ? (
              <PresenterCompanionStatus
                projectId={deck?.projectId ?? props.projectId ?? ""}
                sessionId={presenterSession.sessionId}
                sessionPurpose={presenterSession.sessionPurpose}
              />
            ) : null}
          </>
        }
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
        presentationSession={
          presentationScreenSession
        }
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
          companionSetup={
            presenterCompanionEnabled && presenterSession && deck ? (
              <PresenterCompanionSetup
                projectId={deck.projectId}
                sessionId={presenterSession.sessionId}
                sessionPurpose={presenterSession.sessionPurpose}
                variant="preflight"
              />
            ) : undefined
          }
          onClose={() => void leavePresentation()}
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

function createPresentationScreenSession(
  runtime: PresentationRuntimeIdentity | null,
  presenterSession: PresenterCompanionSessionIdentity | null,
) {
  if (runtime) {
    return {
      audienceUrl: runtime.audienceUrl,
      passcodeState:
        runtime.accessMode === "public"
          ? ({ status: "public" } as const)
          : runtime.displayPasscode
            ? ({
                status: "private",
                displayPasscode: runtime.displayPasscode,
              } as const)
            : ({ status: "legacy-unavailable" } as const),
      sessionId: runtime.sessionId,
    };
  }
  return presenterSession
    ? {
        audienceUrl: presenterSession.audienceUrl,
        passcodeState: { status: "not-prepared" } as const,
        sessionId: presenterSession.sessionId,
      }
    : undefined;
}

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
    confidence: number | null;
    confirmedOccurrenceIds: string[];
    currentCharOffset: number;
    previousCharOffset: number;
    currentStepAnimationIds: string[];
    currentStepIndex: number;
    latestTranscript: string;
    matches: Array<{ occurrenceId: string }>;
    occurrenceActions: Array<{ animationId: string; occurrenceId: string }>;
    playedAnimationIds: string[];
    speechStatus: string;
    targetOccurrenceIds: string[];
    transcript: string;
  };
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
          <dt>대본 위치</dt>
          <dd>{data.previousCharOffset} → {data.currentCharOffset}</dd>
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
      <details>
        <summary>연결 데이터 보기</summary>
        <p>트리거 occurrence: {formatDebugValues(data.targetOccurrenceIds)}</p>
        <p>
          action 연결: {" "}
          {formatDebugValues(
            data.occurrenceActions.map(
              (action) => `${action.occurrenceId} → ${action.animationId}`,
            ),
          )}
        </p>
        <p>위치 계산 대본: {data.transcript || "-"}</p>
      </details>
    </aside>
  );
}

function getAnimationTriggerBlocker(data: {
  confidence: number | null;
  confirmedOccurrenceIds: string[];
  latestTranscript: string;
  matches: Array<{ occurrenceId: string }>;
  occurrenceActions: Array<{ animationId: string; occurrenceId: string }>;
  speechStatus: string;
  targetOccurrenceIds: string[];
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
  if (data.targetOccurrenceIds.length === 0) {
    return "현재 슬라이드에 keyword-occurrence action이 없습니다.";
  }
  if (data.occurrenceActions.length === 0) {
    return "occurrence action 연결을 찾지 못했습니다.";
  }
  if (
    data.targetOccurrenceIds.length > 0 &&
    data.targetOccurrenceIds.every((occurrenceId) =>
      data.confirmedOccurrenceIds.includes(occurrenceId),
    )
  ) {
    return "해당 occurrence는 이미 처리되어 중복 실행하지 않습니다.";
  }
  if (data.matches.length === 0) {
    return "대본 위치·키워드·미소비 조건 중 하나가 일치하지 않습니다.";
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
