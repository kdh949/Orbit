import {
  createSlidePlaybackState,
  type SlidePlaybackState,
} from "@orbit/editor-core/playback";
import { demoIds } from "@orbit/shared/common";
import { type Deck, type Keyword, type Slide } from "@orbit/shared/deck";
import { type Job } from "@orbit/shared/jobs";
import {
  createRehearsalEvaluationSnapshot,
  type LiveSttAnimationCueEvent,
  type LiveSttPartialTranscriptEvent,
  type LiveSttSlideAdvanceEvent,
  type RehearsalRunComparison,
  type RehearsalEvaluationSnapshot,
  type RehearsalRun,
  type RehearsalRunMeta,
  type SemanticCapabilityEvent,
} from "@orbit/shared/rehearsals";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  Mic,
  MoreHorizontal,
  Presentation,
  Square,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { JobProgressDisplay } from "./JobProgressDisplay";
import { runRehearsalPauseSequence } from "./recording/recordingSession";
import { fetchOrCreateRehearsalDeck } from "./api/rehearsalApi";
import {
  getRehearsalFinishPath,
  getRehearsalPresenterWindowPath,
  getRehearsalReportPath,
} from "./rehearsalRoutes";
import { RehearsalScriptTeleprompter } from "../presenter-shell/presenter/RehearsalScriptTeleprompter";
import "./rehearsal-preflight.css";
import "../reports/rehearsal-report-detail.css";
import "./rehearsal-workspace-orbit.css";
import {
  fetchProjectRehearsalReportRuns,
  fetchRehearsalRunComparison,
} from "../reports/reportApi";
import { RehearsalCompletionScreen } from "./completion/RehearsalCompletionScreen";
import { RehearsalPreflightScreen } from "./preflight/RehearsalPreflightScreen";
import {
  buildRehearsalRunComparisonViewModel,
  createComparisonReminderState,
  dismissComparisonReminder,
  enterComparisonSlide,
  type ComparisonReminderState,
} from "./rehearsalRunComparisonModel";
import { sortRehearsalRunsByCreatedAt } from "../reports/reportUtils";
import {
  logRehearsalValidationFailure,
  rehearsalDeckInvalidMessage,
} from "./rehearsalErrorHandling";
import { useJobSmoothProgress } from "./useJobSmoothProgress";
import {
  closePresenterCompanionSession,
  ensurePresenterCompanionSession,
  type PresenterCompanionSessionIdentity,
} from "../presentation/presentationApi";
import { type LiveSttAdapter } from "../../runtime/speech/stt/liveSttAdapter";
import {
  confirmRehearsalCommandCandidate,
  defaultRehearsalCommandConfig,
  detectRehearsalCommandCandidate,
  type RehearsalCommandCandidate,
} from "./rehearsalCommands";
import {
  applyLiveTranscriptBias,
  getLiveSttBiasMode,
  shouldUseLiveSttPostprocessBias,
} from "./stt/liveSttBias";
import { getRehearsalSlideTitle as getSlideTitle } from "./rehearsalSlideText";
import {
  LiveSttError,
  type LiveSttPort,
  type LiveSttResult,
} from "../../runtime/speech/stt/liveSttPort";
import {
  applyLiveTranscriptEvent,
  confirmKeywordOccurrenceMatches,
  createKeywordOccurrenceAnimationCueEvent,
  evaluateLiveTranscript,
  getLiveKeywordOccurrenceStateForSlide,
  renderLiveTranscriptBuffer,
} from "../../runtime/speech/tracking/liveTranscriptAnalysis";
import { createRehearsalScriptPrompterRows } from "../presenter-shell/panel/rehearsalScriptPrompter";
import {
  getKeywordOccurrenceTriggerIdsForSlide,
  resolveCueTriggeredActions,
  resolveKeywordOccurrenceTriggeredActions,
  resolveKeywordTriggeredActions,
  getTriggerAnimationIdsForSlide,
  restoreSlidePlaybackAtStep,
  resolveTriggeredActionPlaybackUpdate,
} from "../../runtime/presentation/playback/triggeredActionPlayback";
import {
  AnimationFlowNavigator,
  type AnimationFlowNavigation,
} from "../presenter-shell/presenter/AnimationFlowNavigator";
import {
  DisplayControls,
  type RequestDisplayScreensResult,
  type RequestSlideWindowFullscreenResult,
  type SlideDisplayOptions,
} from "../presenter-shell/presenter/DisplayControls";
import {
  PresentWindowReceiver,
  requestPresentWindowFullscreen,
} from "../presenter-shell/presenter/PresentWindow";
import { PresenterRemoteWindow } from "../presenter-shell/presenter/PresenterRemoteWindow";
import {
  createDisplayManager,
  type DisplayManagerErrorCode,
  type DisplayScreenDescriptor,
  type SlideWindowRef,
} from "../../runtime/presentation/displayManager";
import { SingleScreenPresenter } from "../presenter-shell/presenter/SingleScreenPresenter";
import { SlideshowRenderer } from "../presenter-shell/presenter/SlideshowRenderer";
import { createSlideshowAnimationPlan } from "../../runtime/presentation/slideshow/slideshowStepModel";
import { getNextPresenterStepState } from "../../runtime/presentation/slideshow/presenterStepNavigation";
import {
  createAudiencePresenterState,
  createSlideWindowDeckSnapshot,
  type PresenterRemoteCommand,
} from "../../runtime/presentation/channel/presentationChannel";
import { useLivePresentationOutput } from "../presentation/useLivePresentationOutput";
import { PresenterCompanionSetup } from "../presenter-companion/PresenterCompanionSetup";
import { PresenterCompanionStatus } from "../presenter-companion/PresenterCompanionStatus";
import { usePresenterCompanionFeatureFlag } from "../presenter-companion/usePresenterCompanionFeatureFlag";
import {
  createCompanionPrompterProjection,
  getCompanionPrompterTrackingStatus,
} from "../presenter-companion/companionPrompterProjection";
import type { AudienceStreamBridgeWindow } from "../../runtime/presentation/audienceStreamBridge";
import { usePresenterKeyboard } from "../presenter-shell/presenter/usePresenterKeyboard";
import { AutoAdvanceSettings } from "../presenter-shell/advance/AutoAdvanceSettings";
import { AutoAdvanceStatus } from "../presenter-shell/advance/AutoAdvanceStatus";
import { defaultAutoAdvanceConfig } from "../../runtime/presentation/advance/autoAdvanceConfig";
import {
  cancelAdvanceCountdown,
  createInitialAdvanceControllerState,
  evaluateAdvanceController,
  resetAdvanceControllerForSlide,
  type AdvanceControllerState,
} from "../../runtime/presentation/advance/advanceController";
import { RehearsalPanel } from "../presenter-shell/panel/RehearsalPanel";
import {
  clearProjectSlideImageCache,
  preloadSlideAssets,
  retainSlideAssetWindow,
} from "../slides/rendering";
import { sanitizeLiveSttErrorMessage } from "../presenter-shell/panel/rehearsalLiveSttRecovery";
import {
  createSemanticCapabilityStatusItems,
  getNextSemanticCapabilityRecoveryDelay,
  isSemanticAutoActionAllowed,
  type SemanticCapabilityStatusItem,
} from "../presenter-shell/panel/semanticCapabilityStatusModel";
import {
  SemanticCueDebugPanel,
  shouldShowSemanticCueDebugPanel,
} from "../presenter-shell/panel/SemanticCueDebugPanel";
import {
  SemanticSpeechDebugPanel,
  semanticSpeechDebugPanelStorageKey,
  shouldShowSemanticSpeechDebugPanel,
} from "../presenter-shell/panel/SemanticSpeechDebugPanel";
import {
  calculateFinalTranscriptWpm,
  getDeckTargetSeconds as getRehearsalDeckTargetSeconds,
  getTimingAdviceState,
  type RehearsalTimingSnapshot,
} from "../presenter-shell/panel/rehearsalTiming";
import { usePresenterSettings } from "./settings/presenterSettings";
import { createDefaultPhraseExtractor } from "../../runtime/speech/tracking/phraseExtractor";
import {
  createP3RehearsalSession,
  type P3RehearsalSession,
  type P3RehearsalSessionState,
} from "./speech/p3RehearsalSession";
import {
  getSemanticCueRuntimeFlags,
  isSemanticCueNliEnabledForMode,
} from "../../runtime/speech/semantic/cue/semanticCueFeatureFlags";
import {
  createSemanticCueDebugRingBuffer,
  type SemanticCueDebugEvent,
} from "../../runtime/speech/semantic/cue/semanticCueDebugEvents";
import {
  createSemanticCueEmbeddingIndex,
  type SemanticCueEmbeddingIndex,
} from "../../runtime/speech/semantic/cue/semanticCueEmbeddingIndex";
import { createSemanticCueRuntime } from "../../runtime/speech/semantic/cue/semanticCueRuntime";
import { createMockSemanticCueNliProvider } from "../../runtime/speech/semantic/nli/mockSemanticCueNliProvider";
import { createBrowserTransformersSemanticCueNliProvider } from "../../runtime/speech/semantic/nli/browserSemanticCueNliProvider";
import {
  getE5EmbeddingService,
  type E5EmbeddingService,
} from "../../runtime/speech/semantic/e5EmbeddingService";
import {
  createIdleSemanticDebugState,
  createSemanticDebugState,
  markSemanticModelReady,
} from "../../runtime/speech/semantic/semanticSpeechDebug";
import {
  createSemanticUtteranceMatcher,
  type SemanticUtteranceMatcher,
} from "../../runtime/speech/semantic/semanticUtteranceMatcher";
import {
  createPauseDetector,
  type PauseDetector,
  type PauseDetectorEvent,
  type PauseDetectorSnapshot,
} from "./speech/pauseDetector";
import { defaultSpeechTrackingConfig } from "../../runtime/speech/tracking/speechTrackingConfig";
import { matchKeywordOccurrenceTriggers } from "../../runtime/speech/tracking/keywordOccurrenceRuntime";
import {
  getPresenterTimingProgress,
  PresenterStageSection,
  PresenterTimerCard,
  PresenterTopbar,
  type PresenterTimingProgressItem,
} from "../presenter-shell/PresenterScaffold";
import type {
  SpeechTrackerSnapshot,
  SpeechTrackingEvent,
} from "../../runtime/speech/tracking/speechTrackingEvents";
import { PracticeGoalReminder } from "../coaching/PracticeGoalReminder";
import { ActivityPresenterPanel } from "../activity-slides";
import { RehearsalFailureScreen } from "./completion/RehearsalFailureScreen";
import {
  buildP3SessionSlides,
  getHighlightedKeywordOccurrencesForSlide,
  getRehearsalPrompterRows,
  getRemainingTriggerStepsFromPlan,
  resetRehearsalTimerState,
  type RehearsalPrompterRows,
} from "./rehearsalWorkspaceModel";
import { useRehearsalMediaSession } from "./hooks/useRehearsalMediaSession";
import { useRehearsalRunLifecycle } from "./hooks/useRehearsalRunLifecycle";
import {
  createDefaultLiveSttPort,
  useLiveSttSession,
} from "./hooks/useLiveSttSession";
import { useRehearsalPresentation } from "./hooks/useRehearsalPresentation";
import { useRehearsalSpeechTracking } from "./hooks/useRehearsalSpeechTracking";

type RehearsalPhase =
  | "idle"
  | "loading"
  | "recording"
  | "uploading"
  | "processing"
  | "succeeded"
  | "failed";
type RehearsalTimeMode = "stopwatch" | "timer";
type RehearsalRuntimeStatus =
  | "idle"
  | "running"
  | "pausing"
  | "paused"
  | "resuming"
  | "stopping";

const ENABLE_REHEARSAL_NLI = false;

const rehearsalPracticeSummaryStoragePrefix = "orbit.rehearsal.lastSummary";

type RehearsalPracticeSummary = {
  completedAt: string;
  coveragePercent: number;
  deckId: string;
  durationSeconds: number;
  missedKeywordCount: number;
  projectId: string;
  targetSeconds: number;
};

function getCurrentRehearsalPresenterWindowPath(
  sessionId: string,
  state: { slideIndex: number; stepIndex: number },
) {
  if (typeof window === "undefined") {
    return `?presenterSessionId=${encodeURIComponent(sessionId)}&presenterWindow=1&slideIndex=${state.slideIndex}&stepIndex=${state.stepIndex}`;
  }

  const params = new URLSearchParams(window.location.search);
  params.set("presenterSessionId", sessionId);
  params.set("presenterWindow", "1");
  params.set("slideIndex", String(Math.max(0, Math.floor(state.slideIndex))));
  params.set("stepIndex", String(Math.max(0, Math.floor(state.stepIndex))));
  return `${window.location.pathname}?${params.toString()}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function readBrowserLocalStorage() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export type RehearsalWorkspaceProps = {
  initialDeck?: Deck;
  fallbackDeck?: Deck;
  liveSttAdapter?: LiveSttAdapter;
  liveSttPort?: LiveSttPort;
  presenterInitialSlideIndex?: number;
  presenterInitialStepIndex?: number;
  presenterSessionId?: string;
  presenterWindow?: boolean;
  snapshotPreparationId?: string;
  projectId?: string;
  sourceFullRunId?: string;
  sourceGoalSetId?: string;
  preflightMode?: "microphone" | "without-voice";
};

export function RehearsalWorkspace(props: RehearsalWorkspaceProps) {
  const [deck, setDeck] = useState<Deck | null>(props.initialDeck ?? null);
  const { settings: presenterSettings, save: savePresenterSettings } =
    usePresenterSettings();
  const rehearsalPresentation = useRehearsalPresentation({
    deck,
    initialSlideIndex: props.presenterInitialSlideIndex ?? 0,
    initialStepIndex: props.presenterInitialStepIndex ?? 0,
  });
  const {
    audienceOutputMode,
    commitPresenterStep,
    cancelPendingNavigation,
    currentSlideIndex,
    currentSlideIndexRef,
    displayRole,
    isSlidePreparationPending,
    presenterStepIndex,
    presenterStepIndexRef,
    resetSlideDisplayToBeginning,
    requestPreparedSlideChange,
    setAudienceOutputMode,
    setDisplayRole,
    setSlideReceiverMessage,
    slideReceiverMessage,
    slideWindowRef,
  } = rehearsalPresentation;
  const speechTracking = useRehearsalSpeechTracking();
  const {
    commandConfirmationRef: liveCommandConfirmationRef,
    keywordOccurrenceStateRef: liveKeywordOccurrenceStateRef,
    keywordStateRef: liveKeywordStateRef,
    sessionTranscript: liveSessionTranscript,
    sessionTranscriptBufferRef: liveSessionTranscriptBufferRef,
    setCurrentKeywordState: setLiveKeywordState,
    setSessionTranscript: setLiveSessionTranscript,
    transcriptBufferRef: liveTranscriptBufferRef,
  } = speechTracking;
  const [phase, setPhase] = useState<RehearsalPhase>(
    props.initialDeck ? "idle" : "loading",
  );
  const [error, setError] = useState("");
  const [run, setRun] = useState<RehearsalRun | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [liveCue, setLiveCue] = useState<LiveSttAnimationCueEvent | null>(null);
  const [liveSlideAdvance, setLiveSlideAdvance] =
    useState<LiveSttSlideAdvanceEvent | null>(null);
  const [p3SessionState, setP3SessionState] =
    useState<P3RehearsalSessionState | null>(null);
  const [semanticDebugState, setSemanticDebugState] = useState(
    createIdleSemanticDebugState,
  );
  const [showSemanticDebugPanel, setShowSemanticDebugPanel] = useState(() =>
    shouldShowSemanticSpeechDebugPanel({
      isDevelopment: import.meta.env.DEV,
      storage: getSemanticDebugPanelStorage(),
    }),
  );
  const [semanticCueDebugEvents, setSemanticCueDebugEvents] = useState<
    SemanticCueDebugEvent[]
  >([]);
  const [semanticCapabilityEvents, setSemanticCapabilityEvents] = useState<
    SemanticCapabilityEvent[]
  >([]);
  const [semanticCapabilityNowMs, setSemanticCapabilityNowMs] = useState(() =>
    Date.now(),
  );
  const [practiceWithoutVoiceAt, setPracticeWithoutVoiceAt] = useState<
    number | null
  >(null);
  const shouldAutoStartRef = useRef<
    "microphone" | "without-voice" | "starting" | null
  >(props.preflightMode ?? null);
  const [p3RunMeta, setP3RunMeta] = useState<RehearsalRunMeta | null>(null);
  const [previousPracticeSummary, setPreviousPracticeSummary] =
    useState<RehearsalPracticeSummary | null>(() =>
      props.initialDeck
        ? readRehearsalPracticeSummary(
            props.initialDeck.projectId,
            props.initialDeck.deckId,
          )
        : null,
    );
  const [runComparison, setRunComparison] =
    useState<RehearsalRunComparison | null>(null);
  const [comparisonRefreshVersion, setComparisonRefreshVersion] = useState(0);
  const [comparisonReminderState, setComparisonReminderState] =
    useState<ComparisonReminderState>(createComparisonReminderState);
  const [hasLocalCompletion, setHasLocalCompletion] = useState(false);
  const [slidePlaybackState, setSlidePlaybackState] = useState(
    createSlidePlaybackState,
  );
  const [advanceControllerState, setAdvanceControllerState] =
    useState<AdvanceControllerState>(() =>
      createInitialAdvanceControllerState(),
    );
  const [autoAdvanceNowMs, setAutoAdvanceNowMs] = useState(0);
  const [lastSentenceSpokenAtMs, setLastSentenceSpokenAtMs] = useState<
    number | null
  >(null);
  const [pauseDetectorSnapshot, setPauseDetectorSnapshot] =
    useState<PauseDetectorSnapshot | null>(null);
  const [isLiveDemoActive, setIsLiveDemoActive] = useState(false);
  const [isLiveStopModalOpen, setIsLiveStopModalOpen] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [slideElapsedSeconds, setSlideElapsedSeconds] = useState(0);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [rehearsalRuntimeStatus, setRehearsalRuntimeStatus] =
    useState<RehearsalRuntimeStatus>("idle");
  const [scriptAutoFollowKey, setScriptAutoFollowKey] = useState(0);
  const [isSingleScreenOpen, setIsSingleScreenOpen] = useState(false);
  const [isCompletionModalOpen, setIsCompletionModalOpen] = useState(false);
  const [timeMode, setTimeMode] = useState<RehearsalTimeMode>("stopwatch");
  const [timerDurationSeconds, setTimerDurationSeconds] = useState(() =>
    props.initialDeck
      ? getRehearsalDeckTargetSeconds(props.initialDeck)
      : 5 * 60,
  );
  const [elapsedTimeInput, setElapsedTimeInput] = useState("00:00");
  const [timerDurationInput, setTimerDurationInput] = useState("05:00");
  const [editingTimeField, setEditingTimeField] = useState<
    "elapsed" | "duration" | null
  >(null);
  const p3SessionRef = useRef<P3RehearsalSession | null>(null);
  const semanticEmbeddingServicePromiseRef =
    useRef<Promise<E5EmbeddingService> | null>(null);
  const semanticMatcherRef = useRef<SemanticUtteranceMatcher | null>(null);
  const semanticCueEmbeddingIndexRef = useRef<SemanticCueEmbeddingIndex | null>(
    null,
  );
  const semanticCueDebugBufferRef = useRef(createSemanticCueDebugRingBuffer());
  const semanticCueNliProviderRef = useRef<{
    key: string;
    provider: ReturnType<
      typeof createBrowserTransformersSemanticCueNliProvider
    >;
  } | null>(null);
  const rehearsalRuntimeStatusRef = useRef<RehearsalRuntimeStatus>("idle");
  const p3RunMetaRef = useRef<RehearsalRunMeta | null>(null);
  const pendingP3RunMetaRef = useRef<Promise<RehearsalRunMeta | null> | null>(
    null,
  );
  const pendingP3SlideIndexRef = useRef<number | null>(null);
  const companionSessionRef = useRef<PresenterCompanionSessionIdentity | null>(
    null,
  );
  const [companionSession, setCompanionSession] =
    useState<PresenterCompanionSessionIdentity | null>(null);
  const companionSessionPromiseRef =
    useRef<Promise<PresenterCompanionSessionIdentity> | null>(null);
  const companionSessionPromiseKeyRef = useRef<string | null>(null);
  const closeCompanionSessionPromiseRef = useRef<Promise<void> | null>(null);
  const reattachAudienceStreamRef = useRef<() => boolean>(() => true);
  const stopAudienceStreamRef = useRef<() => void>(() => undefined);
  const presenterCompanionEnabled = usePresenterCompanionFeatureFlag();
  const deckRef = useRef<Deck | null>(props.initialDeck ?? null);
  const slidePlaybackStateRef = useRef<SlidePlaybackState>(
    createSlidePlaybackState(),
  );
  const pendingFlowRestoreRef = useRef<{
    slideId: string;
    stepIndex: number;
  } | null>(null);
  const advanceControllerStateRef = useRef<AdvanceControllerState>(
    createInitialAdvanceControllerState(),
  );
  const lastSentenceSpokenAtMsRef = useRef<number | null>(null);
  const finalSentenceCommittedAtMsRef = useRef<number | null>(null);
  const pauseDetectorRef = useRef<PauseDetector | null>(null);
  const mediaSession = useRehearsalMediaSession();
  const liveSttSession = useLiveSttSession({
    fallbackEngineId: presenterSettings.sttEngine,
    initialPort: props.liveSttPort,
    legacyAdapter: props.liveSttAdapter,
    projectId: deck?.projectId ?? props.projectId,
  });
  const {
    audioLevel: liveAudioLevel,
    audioLevelLabel: liveAudioLevelLabel,
    audioLevelPercent: liveAudioLevelPercent,
    canDownloadDebugPcm: canDownloadLiveSttDebugPcm,
    error: liveError,
    isRetrying: isLiveSttRetrying,
    setError: setLiveError,
    status: liveStatus,
  } = liveSttSession;
  const runLifecycle = useRehearsalRunLifecycle({
    getLiveTranscript: speechTracking.getSessionTranscript,
    getRunMeta: async () =>
      pendingP3RunMetaRef.current
        ? await pendingP3RunMetaRef.current
        : p3RunMetaRef.current,
    getSlideTranscriptSnapshots: speechTracking.getSlideTranscriptSnapshots,
    onCompletionModalChange: setIsCompletionModalOpen,
    onError: setError,
    onJobChange: setJob,
    onLiveError: setLiveError,
    onPhaseChange: setPhase,
    onRunChange: setRun,
    snapshotPreparationId: props.snapshotPreparationId,
    sourceGoalSetId: props.sourceGoalSetId,
  });

  useEffect(() => {
    function handleDeveloperModeShortcut(event: KeyboardEvent) {
      if (
        event.repeat ||
        !event.ctrlKey ||
        !event.shiftKey ||
        event.altKey ||
        event.key.toLocaleLowerCase() !== "q"
      ) {
        return;
      }

      event.preventDefault();
      setShowSemanticDebugPanel((current) => {
        const next = !current;
        writeSemanticDebugPanelPreference(next);
        return next;
      });
    }

    window.addEventListener("keydown", handleDeveloperModeShortcut);
    return () =>
      window.removeEventListener("keydown", handleDeveloperModeShortcut);
  }, []);

  useEffect(() => {
    if (import.meta.env.MODE === "test" || !ENABLE_REHEARSAL_NLI) {
      return;
    }

    getOrCreateSemanticMatcher();
  }, []);

  useEffect(() => {
    if (import.meta.env.MODE === "test") {
      return;
    }
    const flags = getSemanticCueRuntimeFlags(import.meta.env);
    if (!flags.nliEnabled || flags.provider !== "browser-transformersjs") {
      return;
    }

    void getOrCreateBrowserSemanticCueNliProvider(flags).load();
  }, []);

  useEffect(
    () => () => {
      semanticCueNliProviderRef.current?.provider.dispose();
      semanticCueNliProviderRef.current = null;
    },
    [],
  );

  useEffect(() => {
    if (props.initialDeck) {
      return;
    }

    let isCancelled = false;
    setPhase("loading");
    void fetchOrCreateRehearsalDeck({
      projectId: props.projectId,
      fallbackDeck: props.fallbackDeck,
    })
      .then((nextDeck) => {
        if (!isCancelled) {
          setDeck(nextDeck);
          setPhase("idle");
        }
      })
      .catch((cause) => {
        if (!isCancelled) {
          setError(toErrorMessage(cause));
          setPhase("failed");
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [props.fallbackDeck, props.initialDeck, props.projectId]);

  useEffect(() => {
    deckRef.current = deck;
  }, [deck]);

  useEffect(() => {
    if (!presenterCompanionEnabled || !deck || props.presenterWindow) {
      return;
    }
    void ensureRehearsalCompanionSession().catch(() => undefined);
  }, [
    deck?.deckId,
    deck?.version,
    presenterCompanionEnabled,
    props.presenterWindow,
  ]);

  useEffect(() => {
    const projectId = deck?.projectId ?? props.projectId ?? demoIds.projectId;
    let isCancelled = false;
    setRunComparison(null);

    void fetchProjectRehearsalReportRuns(projectId)
      .then(({ runs }) => {
        const succeededRuns = sortRehearsalRunsByCreatedAt(runs);
        const latestRun = succeededRuns[succeededRuns.length - 1];
        return latestRun
          ? fetchRehearsalRunComparison(projectId, latestRun.runId)
          : null;
      })
      .then((comparison) => {
        if (!isCancelled) setRunComparison(comparison);
      })
      .catch(() => {
        if (!isCancelled) setRunComparison(null);
      });

    return () => {
      isCancelled = true;
    };
  }, [comparisonRefreshVersion, deck?.projectId, props.projectId]);

  useEffect(() => {
    setComparisonReminderState(createComparisonReminderState());
  }, [runComparison?.currentRunId]);

  useEffect(() => {
    if (!deck) {
      setPreviousPracticeSummary(null);
      return;
    }

    setPreviousPracticeSummary(
      readRehearsalPracticeSummary(deck.projectId, deck.deckId),
    );
  }, [deck?.deckId, deck?.projectId]);

  useEffect(() => {
    if (deck) {
      setTimerDurationSeconds(getRehearsalDeckTargetSeconds(deck));
    }
  }, [deck?.deckId, deck?.targetDurationMinutes]);

  useEffect(() => {
    slidePlaybackStateRef.current = slidePlaybackState;
  }, [slidePlaybackState]);

  useEffect(() => {
    if (!isTimerRunning) {
      return;
    }

    const timer = window.setInterval(() => {
      setElapsedSeconds((current) => current + 1);
      setSlideElapsedSeconds((current) => current + 1);
    }, 1000);

    return () => window.clearInterval(timer);
  }, [isTimerRunning]);

  useEffect(() => {
    rehearsalRuntimeStatusRef.current = rehearsalRuntimeStatus;
  }, [rehearsalRuntimeStatus]);

  const displayedTimeSeconds =
    timeMode === "timer"
      ? Math.max(timerDurationSeconds - elapsedSeconds, 0)
      : elapsedSeconds;

  function handlePresenterRemoteCommand(command: PresenterRemoteCommand) {
    if (command.action === "finish") {
      finishRehearsal();
      return;
    }
    const deckSnapshot = deckRef.current;
    if (!deckSnapshot) {
      return;
    }
    if (deckSnapshot.slides.length === 0) {
      return;
    }

    if (command.action === "set-audience-output") {
      setAudienceOutputMode(command.mode);
      return;
    }

    cancelAutoAdvanceForManualCommand();

    if (command.action === "timer-start") {
      if (rehearsalRuntimeStatusRef.current === "paused") {
        void resumePausedRehearsal();
        return;
      }

      if (canStartLiveDemo) {
        void startLiveDemo();
      } else if (deckSnapshot) {
        setIsTimerRunning(true);
      }
      return;
    }

    if (command.action === "timer-pause") {
      void pauseActiveRehearsal();
      return;
    }

    if (command.action === "timer-reset") {
      if (phase === "recording") {
        stopRecording();
      } else {
        stopLiveDemo();
      }
      resetRehearsalTimerState({
        setElapsedSeconds,
        setSlideElapsedSeconds,
        setIsTimerRunning,
      });
      return;
    }

    if (command.action === "prev") {
      void requestPreparedSlideChange({
        source: "manual",
        stepIndex: 0,
        targetSlideIndex: currentSlideIndexRef.current - 1,
      });
      return;
    }

    if (command.action === "goto") {
      const nextSlideIndex = Math.min(
        deckSnapshot.slides.length - 1,
        Math.max(0, Math.trunc(command.slideIndex)),
      );
      void requestPreparedSlideChange({
        source: "remote-goto",
        stepIndex: Math.max(0, Math.trunc(command.stepIndex ?? 0)),
        targetSlideIndex: nextSlideIndex,
      });
      return;
    }

    const slide = deckSnapshot.slides[currentSlideIndexRef.current];
    if (!slide) {
      return;
    }

    const plan = createSlideshowAnimationPlan({
      slide,
      triggerAnimationIds: getTriggerAnimationIdsForSlide(slide),
    });
    const nextState = getNextPresenterStepState({
      currentSlideIndex: currentSlideIndexRef.current,
      currentStepIndex: presenterStepIndexRef.current,
      maxStepIndex: plan.maxStepIndex,
      slideCount: deckSnapshot.slides.length,
    });
    void requestPreparedSlideChange({
      source: "manual",
      stepIndex: nextState.stepIndex,
      targetSlideIndex: nextState.slideIndex,
    });
  }

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

  useEffect(() => {
    return () => {
      resetAutoAdvanceRuntimeState(currentSlide?.slideId ?? null);
      liveSttSession.cleanupSubscriptions();
      const p3Session = p3SessionRef.current;
      p3SessionRef.current = null;
      pendingP3SlideIndexRef.current = null;
      if (p3Session) {
        void p3Session.stop();
      } else {
        void liveSttSession.stopPort();
      }
    };
  }, []);

  useEffect(() => {
    pauseDetectorRef.current = createPauseDetector({
      config: presenterSettings.pauseDetector,
      pauseMs: presenterSettings.advancePolicy.pauseMs,
    });
    setPauseDetectorSnapshot(null);
  }, [
    presenterSettings.advancePolicy.pauseMs,
    presenterSettings.pauseDetector.silenceThresholdDb,
  ]);

  const currentSlide = deck?.slides[currentSlideIndex] ?? null;

  useEffect(() => {
    const projectId = deck?.projectId;
    if (!projectId) return;

    return () => {
      cancelPendingNavigation();
      clearProjectSlideImageCache(projectId);
    };
  }, [deck?.projectId]);

  useEffect(() => {
    if (!deck || !currentSlide) return;

    retainSlideAssetWindow(deck, currentSlideIndex);
    void preloadSlideAssets(deck, currentSlide, "high");
    const nextSlide = deck.slides[currentSlideIndex + 1];
    if (nextSlide) {
      void preloadSlideAssets(deck, nextSlide, "low");
    }
  }, [currentSlide?.slideId, currentSlideIndex, deck]);
  const visibleSemanticCapabilityEvents = useMemo(() => {
    if (practiceWithoutVoiceAt === null) {
      return semanticCapabilityEvents;
    }

    return [
      ...semanticCapabilityEvents,
      {
        eventId: `semantic_cap_voice_disabled_${practiceWithoutVoiceAt}`,
        capability: "stt" as const,
        fromState: "available" as const,
        toState: "unavailable" as const,
        reason: "user_disabled" as const,
        measurementMode: "none" as const,
        retryable: false,
        cueIds: [],
        at: new Date(practiceWithoutVoiceAt).toISOString(),
      },
    ];
  }, [practiceWithoutVoiceAt, semanticCapabilityEvents]);
  const semanticCapabilityItems = useMemo(
    () =>
      createSemanticCapabilityStatusItems(visibleSemanticCapabilityEvents, {
        nowMs: semanticCapabilityNowMs,
      }).slice(0, 6),
    [semanticCapabilityNowMs, visibleSemanticCapabilityEvents],
  );

  useEffect(() => {
    const delay = getNextSemanticCapabilityRecoveryDelay(
      visibleSemanticCapabilityEvents,
      semanticCapabilityNowMs,
    );
    if (delay === null) {
      return;
    }

    const timer = window.setTimeout(
      () => setSemanticCapabilityNowMs(Date.now()),
      delay + 1,
    );
    return () => window.clearTimeout(timer);
  }, [semanticCapabilityNowMs, visibleSemanticCapabilityEvents]);
  const currentSlideTargetSeconds =
    deck && currentSlide ? getSlideTargetSeconds(deck, currentSlide) : 0;
  const canRecord =
    Boolean(deck) && !["recording", "uploading", "processing"].includes(phase);
  const isLiveSttActive =
    liveStatus === "starting" || liveStatus === "listening";
  const isP3TrackingActive = p3SessionState?.status === "running";
  const isReportBusy = ["recording", "uploading", "processing"].includes(phase);
  const canStartLiveDemo =
    Boolean(deck) && !isReportBusy && !isLiveSttActive && !isLiveDemoActive;
  const canStopLiveDemo = isLiveDemoActive && isLiveSttActive;
  const p3Sentences = useMemo(
    () =>
      currentSlide
        ? createDefaultPhraseExtractor({
            controlPhrases: defaultRehearsalCommandConfig
              .map((command) => command.phrases)
              .flatMap((phrases) => phrases),
            keywordTerms: (currentSlide.keywords ?? []).flatMap((keyword) => [
              keyword.text,
              ...keyword.synonyms,
              ...keyword.abbreviations,
            ]),
          }).extract(currentSlide.speakerNotes)
        : [],
    [currentSlide?.slideId, currentSlide?.speakerNotes],
  );
  const p3PanelSnapshot = useMemo(
    () =>
      currentSlide && p3SessionState?.snapshot?.slideId === currentSlide.slideId
        ? p3SessionState.snapshot
        : createEmptySpeechTrackerSnapshot({
            slideId: currentSlide?.slideId ?? "slide-empty",
            matchableSentenceCount: p3Sentences.filter(
              (sentence) => sentence.matchable,
            ).length,
          }),
    [currentSlide?.slideId, p3Sentences, p3SessionState?.snapshot],
  );
  const triggerAnimationIds = useMemo(
    () => (currentSlide ? getTriggerAnimationIdsForSlide(currentSlide) : []),
    [currentSlide],
  );
  const slideshowAnimationPlan = currentSlide
    ? createSlideshowAnimationPlan({
        slide: currentSlide,
        triggerAnimationIds,
      })
    : null;
  const companionPrompterState = useMemo(
    () =>
      currentSlide
        ? createCompanionPrompterProjection({
            progressPercent: (p3PanelSnapshot.scriptProgress?.ratio ?? 0) * 100,
            rows: createRehearsalScriptPrompterRows({
              sentences: p3Sentences,
              coveredSentenceIds: p3PanelSnapshot.coveredSentenceIds,
              coveredSentenceMatchKinds:
                p3PanelSnapshot.coveredSentenceMatchKinds,
              prompterProgress: p3PanelSnapshot.prompterProgress,
            }).map((row) => ({
              isFocusTarget: row.isFocusTarget,
              sentenceId: row.sentence.sentenceId,
              status: row.status,
              text: row.sentence.text,
            })),
            slideId: currentSlide.slideId,
            slideIndex: currentSlideIndex,
            trackingStatus: getCompanionPrompterTrackingStatus(liveStatus),
          })
        : null,
    [currentSlide, currentSlideIndex, liveStatus, p3PanelSnapshot, p3Sentences],
  );
  const presentationChannelState = useMemo(
    () =>
      currentSlide
        ? {
            audienceOutputMode,
            highlights: [],
            slideId: currentSlide.slideId,
            slideIndex: currentSlideIndex,
            speech: {
              coveredSentenceIds: p3PanelSnapshot.coveredSentenceIds,
              coveredSentenceMatchKinds:
                p3PanelSnapshot.coveredSentenceMatchKinds,
              matchableSentenceCount: p3PanelSnapshot.matchableSentenceCount,
              semanticDebug: semanticDebugState,
              semanticMatchingEnabled:
                presenterSettings.advancePolicy.semanticMatching,
              semanticCapabilityItems,
              snapshot: p3SessionState?.snapshot ?? null,
            },
            stepIndex: presenterStepIndex,
            timing: {
              canStartLiveStt: canStartLiveDemo,
              currentSlideElapsedSeconds: slideElapsedSeconds,
              currentSlideTargetSeconds,
              displayedSeconds: displayedTimeSeconds,
              elapsedSeconds,
              isLiveSttActive,
              isPaused: rehearsalRuntimeStatus === "paused",
              isRunning: isTimerRunning,
              liveStatus,
              mode: timeMode,
              timerDurationSeconds,
            },
          }
        : null,
    [
      canStartLiveDemo,
      audienceOutputMode,
      currentSlide?.slideId,
      currentSlideIndex,
      currentSlideTargetSeconds,
      displayedTimeSeconds,
      elapsedSeconds,
      isLiveSttActive,
      isTimerRunning,
      liveStatus,
      p3PanelSnapshot,
      p3SessionState?.snapshot,
      presenterStepIndex,
      presenterSettings.advancePolicy.semanticMatching,
      rehearsalRuntimeStatus,
      semanticDebugState,
      semanticCapabilityItems,
      slideElapsedSeconds,
      timeMode,
      timerDurationSeconds,
    ],
  );
  const livePresentationOutput = useLivePresentationOutput({
    audienceWindowConnected: Boolean(
      slideWindowRef.current && !slideWindowRef.current.closed,
    ),
    canGoNext: Boolean(
      deck &&
      (presenterStepIndex < (slideshowAnimationPlan?.maxStepIndex ?? 0) ||
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
    localWindowSessionId: props.presenterSessionId,
    onCommand: handlePresenterRemoteCommand,
    onOutputModeChange: setAudienceOutputMode,
    onPeerReady: (peer) => {
      if (peer === "slide-window") reattachAudienceStreamRef.current();
    },
    onScreenShareEnded: () => stopAudienceStreamRef.current(),
    outputMode: audienceOutputMode,
    persistedSessionId: companionSession?.sessionId,
    prompterState: companionPrompterState,
    state: presentationChannelState,
    triggerAnimationIds,
  });
  const presentationChannel = livePresentationOutput.localChannel;
  const audienceScreenShareIdentity =
    livePresentationOutput.hostIdentity.localChannel;
  const audienceScreenShare = livePresentationOutput.screenShare;
  reattachAudienceStreamRef.current = audienceScreenShare.reattach;
  stopAudienceStreamRef.current = () =>
    audienceScreenShare.stopSharing({ returnToSlide: true });
  const displayManager = useMemo(() => createDisplayManager(), []);
  const remainingTriggerSteps = slideshowAnimationPlan
    ? getRemainingTriggerStepsFromPlan(
        slideshowAnimationPlan.maxStepIndex,
        presenterStepIndex,
      )
    : 0;
  const liveAudioMeterState = liveAudioLevel
    ? liveAudioLevelLabel === "입력 과대"
      ? "clipped"
      : liveAudioLevel.isLikelySilence
        ? "quiet"
        : "active"
    : "idle";
  const p3TimingSnapshot: RehearsalTimingSnapshot = deck
    ? {
        deckTargetSeconds: getRehearsalDeckTargetSeconds(deck),
        elapsedSeconds,
        remainingSeconds: getRehearsalDeckTargetSeconds(deck) - elapsedSeconds,
        currentSlideElapsedSeconds: slideElapsedSeconds,
        currentSlideTargetSeconds,
        currentSlideOvertime:
          currentSlideTargetSeconds > 0 &&
          slideElapsedSeconds > currentSlideTargetSeconds,
      }
    : {
        deckTargetSeconds: 0,
        elapsedSeconds: 0,
        remainingSeconds: 0,
        currentSlideElapsedSeconds: 0,
        currentSlideTargetSeconds: 0,
        currentSlideOvertime: false,
      };
  const totalTimingProgress = getPresenterTimingProgress(
    p3TimingSnapshot.elapsedSeconds,
    p3TimingSnapshot.deckTargetSeconds,
  );
  const slideTimingProgress = getPresenterTimingProgress(
    p3TimingSnapshot.currentSlideElapsedSeconds,
    p3TimingSnapshot.currentSlideTargetSeconds,
  );
  const rehearsalProgressPercent = totalTimingProgress.percent;
  const p3WordsPerMinute =
    p3SessionState?.startedAtMs !== null &&
    p3SessionState?.startedAtMs !== undefined
      ? calculateFinalTranscriptWpm({
          segments: p3SessionState.finalSegments,
          nowMs: p3SessionState.startedAtMs + elapsedSeconds * 1000,
          startedAtMs: p3SessionState.startedAtMs,
          windowMs: 30000,
        })
      : 0;
  const p3AdviceState = getTimingAdviceState({
    wordsPerMinute: p3WordsPerMinute,
    currentSlideOvertime: p3TimingSnapshot.currentSlideOvertime,
    paceAdvice: presenterSettings.paceAdvice,
  });

  useEffect(() => {
    const p3Session = p3SessionRef.current;
    if (!p3Session || p3Session.getState().status !== "running") {
      return;
    }

    syncP3AdviceState(p3Session);
  }, [p3AdviceState.pace, p3AdviceState.slideOvertime]);

  useEffect(() => {
    setSlideElapsedSeconds(0);
  }, [currentSlide?.slideId]);

  useEffect(() => {
    if (!currentSlide) {
      return;
    }
    speechTracking.transitionSlideTranscriptVisit(
      currentSlide,
      currentSlideIndex,
    );
  }, [currentSlide?.slideId, currentSlideIndex]);

  const isRehearsalCompletionVisible =
    Boolean(deck) &&
    (hasLocalCompletion ||
      isLiveStopModalOpen ||
      phase === "succeeded" ||
      (Boolean(p3RunMeta) &&
        !isLiveDemoActive &&
        !isLiveSttActive &&
        !isTimerRunning &&
        phase !== "recording"));

  usePresenterKeyboard({
    enabled:
      Boolean(deck) &&
      !props.presenterWindow &&
      !isRehearsalCompletionVisible &&
      (displayRole === "presenter" ||
        displayRole === "slide-receiver" ||
        displayRole === "slide-surface"),
    onNextStep: () => {
      handleNextPresenterStep();
    },
    onPreviousSlide: () => {
      goPrevious();
    },
  });

  useEffect(() => {
    if (displayRole !== "slide-surface" || typeof document === "undefined") {
      return;
    }

    const handleFullscreenChange = () => {
      if (!document.fullscreenElement) {
        setDisplayRole("presenter");
        setSlideReceiverMessage("");
      }
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, [displayRole]);

  useEffect(() => {
    resetAutoAdvanceRuntimeState(currentSlide?.slideId ?? null);
    const pendingFlowRestore = pendingFlowRestoreRef.current;
    if (currentSlide && pendingFlowRestore?.slideId === currentSlide.slideId) {
      pendingFlowRestoreRef.current = null;
      restoreLivePlaybackAtStep(currentSlide, pendingFlowRestore.stepIndex);
    } else {
      resetLivePlaybackForSlide(currentSlide);
    }
    if (deck && currentSlide) {
      liveSttSession.updateBias(deck, currentSlideIndex, {
        nearbySlides: getNearbySlides(deck, currentSlideIndex),
        pronunciationLexicon:
          runLifecycle.getActiveRun()?.evaluationSnapshot?.pronunciationLexicon,
      });
    }
    const p3Session = p3SessionRef.current;
    if (p3Session && (isLiveDemoActive || phase === "recording")) {
      const p3State = p3Session.getState();
      if (p3State.status === "starting") {
        pendingP3SlideIndexRef.current = currentSlideIndex;
      } else if (p3State.status === "running") {
        p3Session.enterSlide(currentSlideIndex);
        setP3SessionState(p3Session.getState());
      }
    }
  }, [currentSlide?.slideId, currentSlideIndex, deck]);

  const isJobActive = phase === "uploading" || phase === "processing";
  const smoothProgress = useJobSmoothProgress(job, isJobActive);
  const completionProgress = phase === "succeeded" ? 100 : smoothProgress;
  const completionMessage =
    phase === "uploading"
      ? "음성 업로드 중"
      : phase === "succeeded"
        ? "리포트 생성 완료"
        : "AI가 발표를 분석하는 중";
  const shouldShowCompletionModal = isCompletionModalOpen || isJobActive;

  async function startRecording(options: { allowDuringReport?: boolean } = {}) {
    if (!deck || (!options.allowDuringReport && !canRecord)) return;
    const activeDeck = deck;
    const activeSlide = activeDeck.slides[currentSlideIndexRef.current] ?? null;
    runLifecycle.beginRecordingAttempt();
    setPracticeWithoutVoiceAt(null);
    stopLiveDemo();

    setError("");
    setRun(null);
    setJob(null);
    setHasLocalCompletion(false);
    setIsCompletionModalOpen(false);
    liveSttSession.resetAttempt();
    if (options.allowDuringReport) {
      setPhase("idle");
    }
    speechTracking.resetSessionTranscript();
    resetLivePlaybackForSlide(activeSlide);
    resetAutoAdvanceRuntimeState(activeSlide?.slideId ?? null);

    if (!navigator.mediaDevices?.getUserMedia) {
      setError("이 브라우저는 마이크 녹음을 지원하지 않습니다.");
      setPhase("failed");
      return;
    }

    let stream: MediaStream | null = null;
    try {
      stream = await mediaSession.acquireStream("recording");
      const evaluationSnapshot =
        await runLifecycle.prepareEvaluationSnapshot(activeDeck);
      mediaSession.startRecordingSession(stream, {
        onError: (recordingError) => {
          runLifecycle.cancelPendingEvaluationRun();
          setError(recordingError.message);
          setPhase("failed");
        },
        onStop: (audioFile) => {
          void runLifecycle.submitRecording(activeDeck, audioFile);
        },
      });
      speechTracking.resetSlideTranscriptSnapshots(
        activeDeck,
        currentSlideIndexRef.current,
      );
      setPhase("recording");
      setIsTimerRunning(true);
      setRehearsalRuntimeStatus("running");
      rehearsalRuntimeStatusRef.current = "running";
      void startP3Tracking(stream, evaluationSnapshot);
    } catch (cause) {
      mediaSession.releaseStream("recording");
      runLifecycle.cancelPendingEvaluationRun();
      const hasValidationError = logRehearsalValidationFailure(cause, {
        projectId: activeDeck.projectId,
        deckId: activeDeck.deckId,
      });
      setError(
        hasValidationError
          ? rehearsalDeckInvalidMessage
          : toMicrophoneErrorMessage(cause),
      );
      setPhase("failed");
    }
  }

  useEffect(() => {
    const mode = shouldAutoStartRef.current;
    if (!mode || mode === "starting" || !deck || phase !== "idle") {
      return;
    }
    if (mode === "microphone" && !canRecord) return;
    shouldAutoStartRef.current = "starting";
    if (mode === "without-voice") {
      startPracticeWithoutVoice();
      shouldAutoStartRef.current = null;
    } else {
      void startRecording().finally(() => {
        shouldAutoStartRef.current = null;
      });
    }
  }, [canRecord, deck, phase]);

  async function startLiveDemo() {
    if (!deck || !canStartLiveDemo) return;

    liveSttSession.resetAttempt();
    setHasLocalCompletion(false);
    setElapsedSeconds(0);
    setIsTimerRunning(true);
    setRehearsalRuntimeStatus("running");
    rehearsalRuntimeStatusRef.current = "running";
    speechTracking.resetSessionTranscript();
    resetLivePlaybackForSlide(currentSlide);
    resetAutoAdvanceRuntimeState(currentSlide?.slideId ?? null);

    if (!navigator.mediaDevices?.getUserMedia) {
      liveSttSession.fail(
        new LiveSttError(
          "start_failed",
          "이 브라우저는 마이크 녹음을 지원하지 않습니다.",
        ),
      );
      return;
    }

    let stream: MediaStream | null = null;
    setIsLiveDemoActive(true);
    try {
      stream = await mediaSession.acquireStream("live-demo");
      const started = await startP3Tracking(stream);
      if (!started) {
        mediaSession.releaseStream("live-demo");
        setIsLiveDemoActive(false);
        setRehearsalRuntimeStatus("idle");
        rehearsalRuntimeStatusRef.current = "idle";
      } else {
        setIsTimerRunning(true);
        setRehearsalRuntimeStatus("running");
        rehearsalRuntimeStatusRef.current = "running";
      }
    } catch (cause) {
      mediaSession.releaseStream("live-demo");
      setIsLiveDemoActive(false);
      setRehearsalRuntimeStatus("idle");
      rehearsalRuntimeStatusRef.current = "idle";
      liveSttSession.fail(
        new LiveSttError("start_failed", toMicrophoneErrorMessage(cause)),
      );
    }
  }

  async function retryInitialRecordingLiveStt() {
    const stream = mediaSession.getStream("recording");
    if (!stream) {
      return false;
    }

    return liveSttSession.retryRecording(
      {
        hasActiveSession: p3SessionRef.current !== null,
        hasReusableStream: mediaSession.hasReusableStream("recording"),
        isRecording: phase === "recording",
      },
      (isCurrent) =>
        startP3Tracking(
          stream,
          runLifecycle.getActiveRun()?.evaluationSnapshot ?? undefined,
          () =>
            isCurrent() &&
            mediaSession.getStream("recording") === stream &&
            mediaSession.hasReusableStream("recording"),
        ),
    );
  }

  function stopLiveDemo(options: { showCompletionModal?: boolean } = {}) {
    const wasLiveDemoActive = isLiveDemoActive || isLiveSttActive;
    setRehearsalRuntimeStatus("stopping");
    liveSttSession.cleanupSubscriptions();
    const p3Session = p3SessionRef.current;
    p3SessionRef.current = null;
    pendingP3SlideIndexRef.current = null;
    if (p3Session) {
      const runMetaPromise = p3Session
        .stop()
        .then((meta) => {
          p3RunMetaRef.current = meta;
          setP3RunMeta(meta);
          setP3SessionState(p3Session.getState());
          return meta;
        })
        .catch(() => null);
      pendingP3RunMetaRef.current = runMetaPromise;
      void runMetaPromise;
    } else {
      void liveSttSession.stopPort();
    }
    mediaSession.releaseStream("live-demo");
    liveSttSession.markStopped();
    setIsLiveDemoActive(false);
    setIsTimerRunning(false);
    setRehearsalRuntimeStatus("idle");
    rehearsalRuntimeStatusRef.current = "idle";
    resetLivePlaybackForSlide(currentSlide);
    resetAutoAdvanceRuntimeState(currentSlide?.slideId ?? null);
    if (options.showCompletionModal && wasLiveDemoActive) {
      setIsLiveStopModalOpen(true);
    }
  }

  function stopRecording() {
    if (phase !== "recording") return;

    speechTracking.captureSlideTranscriptSnapshot("rehearsal-end");
    liveSttSession.cancelRetry();
    setRehearsalRuntimeStatus("stopping");
    setPhase("uploading");
    setIsTimerRunning(false);
    resetLivePlaybackForSlide(currentSlide);
    resetAutoAdvanceRuntimeState(currentSlide?.slideId ?? null);
    liveSttSession.cleanupSubscriptions();
    const p3Session = p3SessionRef.current;
    p3SessionRef.current = null;
    pendingP3SlideIndexRef.current = null;
    if (p3Session) {
      const runMetaPromise = p3Session
        .stop()
        .then((meta) => {
          p3RunMetaRef.current = meta;
          setP3RunMeta(meta);
          setP3SessionState(p3Session.getState());
          return meta;
        })
        .catch(() => null);
      pendingP3RunMetaRef.current = runMetaPromise;
      void runMetaPromise;
    } else {
      void liveSttSession.stopPort();
    }
    liveSttSession.markStopped();
    mediaSession.stopRecording();
    setRehearsalRuntimeStatus("idle");
    rehearsalRuntimeStatusRef.current = "idle";
  }

  async function pauseActiveRehearsal() {
    if (
      rehearsalRuntimeStatusRef.current === "paused" ||
      rehearsalRuntimeStatusRef.current === "pausing"
    ) {
      return;
    }

    cancelAutoAdvanceForManualCommand();
    pauseDetectorRef.current?.accept({ type: "reset" });
    setPauseDetectorSnapshot(null);
    setIsTimerRunning(false);
    setRehearsalRuntimeStatus("pausing");
    rehearsalRuntimeStatusRef.current = "pausing";

    const isRecordingPause = phase === "recording";
    const shouldPauseSpeech =
      isRecordingPause || isLiveDemoActive || isLiveSttActive;
    const p3Session = p3SessionRef.current;
    const pauseResult = await runRehearsalPauseSequence({
      pauseRecording: isRecordingPause
        ? async () => {
            await mediaSession.pauseRecording();
          }
        : undefined,
      pauseSpeech: async () => {
        if (!shouldPauseSpeech) {
          return;
        }
        if (p3Session) {
          try {
            await p3Session.pause();
          } finally {
            setP3SessionState(p3Session.getState());
          }
        } else {
          await liveSttSession.stopPort();
        }
      },
    });

    if (pauseResult.status === "paused") {
      mediaSession.setStreamEnabled(
        isRecordingPause ? "recording" : "live-demo",
        false,
      );
      liveSttSession.markStopped();
      setIsTimerRunning(false);
      setRehearsalRuntimeStatus("paused");
      rehearsalRuntimeStatusRef.current = "paused";
    } else {
      setIsTimerRunning(true);
      setRehearsalRuntimeStatus("running");
      rehearsalRuntimeStatusRef.current = "running";
    }

    if (pauseResult.error) {
      const error = liveSttSession.normalizeError(pauseResult.error);
      if (isRecordingPause) {
        setError(error.message);
      } else {
        liveSttSession.fail(error);
      }
    }
  }

  async function resumePausedRehearsal() {
    if (rehearsalRuntimeStatusRef.current !== "paused") {
      return;
    }

    const p3Session = p3SessionRef.current;
    let stream =
      phase === "recording"
        ? mediaSession.getStream("recording")
        : mediaSession.getStream("live-demo");
    setRehearsalRuntimeStatus("resuming");
    rehearsalRuntimeStatusRef.current = "resuming";
    try {
      if (phase === "recording" || p3Session) {
        if (
          !mediaSession.hasReusableStream(
            phase === "recording" ? "recording" : "live-demo",
          )
        ) {
          if (phase === "recording") {
            throw new LiveSttError(
              "start_failed",
              "녹음 마이크 연결이 종료되어 음성 인식을 다시 시작하지 못했습니다.",
            );
          }
          stream = await mediaSession.acquireStream("live-demo");
        }
        if (!stream) {
          throw new LiveSttError(
            "start_failed",
            "음성 인식에 사용할 마이크 연결을 찾지 못했습니다.",
          );
        }

        mediaSession.setStreamEnabled(
          phase === "recording" ? "recording" : "live-demo",
          true,
        );
        if (phase === "recording") {
          await mediaSession.resumeRecording();
        }
      }

      if (p3Session) {
        if (!stream) {
          throw new LiveSttError(
            "start_failed",
            "음성 인식에 사용할 마이크 연결을 찾지 못했습니다.",
          );
        }
        liveSttSession.markStarting();
        const resumedState = await p3Session.resume({ audioSource: stream });
        if (resumedState.status !== "running") {
          throw new LiveSttError(
            "start_failed",
            "음성 인식 세션을 다시 시작하지 못했습니다.",
          );
        }
        setP3SessionState(resumedState);
        liveSttSession.markListening();
      }

      setIsTimerRunning(true);
      setRehearsalRuntimeStatus("running");
      rehearsalRuntimeStatusRef.current = "running";
      setScriptAutoFollowKey((current) => current + 1);
    } catch (cause) {
      const error = liveSttSession.normalizeError(cause);
      await mediaSession.pauseRecording().catch(() => undefined);
      mediaSession.setStreamEnabled(
        phase === "recording" ? "recording" : "live-demo",
        false,
      );
      if (phase === "recording") {
        setError(error.message);
      } else {
        liveSttSession.fail(error);
      }
      setIsTimerRunning(false);
      setRehearsalRuntimeStatus("paused");
      rehearsalRuntimeStatusRef.current = "paused";
    }
  }

  async function handleTimePrimaryAction() {
    if (rehearsalRuntimeStatus === "paused") {
      await resumePausedRehearsal();
      return;
    }

    if (isTimerRunning) {
      await pauseActiveRehearsal();
      return;
    }

    await startRecording();
  }

  function handleSideTimerPrimaryAction() {
    if (rehearsalRuntimeStatus === "paused") {
      void resumePausedRehearsal();
      return;
    }

    if (phase === "recording") {
      void pauseActiveRehearsal();
      return;
    }

    if (canStopLiveDemo) {
      void pauseActiveRehearsal();
      return;
    }

    if (isTimerRunning) {
      setIsTimerRunning(false);
      setRehearsalRuntimeStatus("paused");
      return;
    }

    if (canRecord) {
      void startRecording();
      return;
    }

    if (deck) {
      setIsTimerRunning(true);
      setRehearsalRuntimeStatus("running");
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

    setTimerDurationSeconds(Math.min(nextSeconds, 60 * 60 * 24 - 1));
  }

  function getOrCreateSemanticMatcher() {
    if (semanticMatcherRef.current) {
      return semanticMatcherRef.current;
    }

    const servicePromise = getOrCreateSemanticEmbeddingService();
    semanticMatcherRef.current = createSemanticUtteranceMatcher({
      embeddingService: {
        embedQuery: async (text) => (await servicePromise).embedQuery(text),
        embedPassages: async (texts) =>
          (await servicePromise).embedPassages(texts),
      },
    });
    return semanticMatcherRef.current;
  }

  function createSemanticCueRuntimeFromFlags(
    mode: "rehearsal" | "presentation",
  ) {
    const flags = getSemanticCueRuntimeFlags(import.meta.env);
    const embeddingIndex = getOrCreateSemanticCueEmbeddingIndex();

    if (
      !isSemanticCueNliEnabledForMode(flags, mode) ||
      flags.provider === "off"
    ) {
      return createSemanticCueRuntime({
        enabled: false,
        embeddingIndex,
      });
    }

    if (flags.provider === "browser-transformersjs") {
      return createSemanticCueRuntime({
        provider: getOrCreateBrowserSemanticCueNliProvider(flags),
        enabled: true,
        nliMode: "shadow",
        embeddingIndex,
      });
    }

    if (flags.provider !== "mock") {
      return createSemanticCueRuntime({
        enabled: false,
        embeddingIndex,
      });
    }

    return createSemanticCueRuntime({
      provider: createMockSemanticCueNliProvider({
        modelId: flags.modelId,
      }),
      enabled: true,
      embeddingIndex,
    });
  }

  function getOrCreateBrowserSemanticCueNliProvider(
    flags: ReturnType<typeof getSemanticCueRuntimeFlags>,
  ) {
    const key = `${flags.provider}:${flags.modelId}:${flags.nliDevice ?? "none"}`;
    if (semanticCueNliProviderRef.current?.key !== key) {
      semanticCueNliProviderRef.current?.provider.dispose();
      semanticCueNliProviderRef.current = {
        key,
        provider: createBrowserTransformersSemanticCueNliProvider({
          modelId: flags.modelId,
          loadOnEvaluate: false,
          ...(flags.nliDevice === null
            ? {}
            : { deviceOverride: flags.nliDevice }),
        }),
      };
    }
    return semanticCueNliProviderRef.current.provider;
  }

  function getOrCreateSemanticCueEmbeddingIndex() {
    if (semanticCueEmbeddingIndexRef.current) {
      return semanticCueEmbeddingIndexRef.current;
    }
    semanticCueEmbeddingIndexRef.current = createSemanticCueEmbeddingIndex({
      embeddingService: {
        embedQuery: async (text) =>
          (await getOrCreateSemanticEmbeddingService()).embedQuery(text),
        embedPassages: async (texts) =>
          (await getOrCreateSemanticEmbeddingService()).embedPassages(texts),
      },
    });
    return semanticCueEmbeddingIndexRef.current;
  }

  function getOrCreateSemanticEmbeddingService() {
    semanticEmbeddingServicePromiseRef.current ??= getE5EmbeddingService(() => {
      setSemanticDebugState((current) =>
        createSemanticDebugState({
          ...current,
          status: "loading-model",
          error: null,
        }),
      );
    })
      .then((service) => {
        setSemanticDebugState(markSemanticModelReady);
        return service;
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        setSemanticDebugState((current) =>
          createSemanticDebugState({
            ...current,
            status: "error",
            error: message,
          }),
        );
        throw error;
      });
    return semanticEmbeddingServicePromiseRef.current;
  }

  async function startP3Tracking(
    stream: MediaStream,
    evaluationSnapshot?: RehearsalEvaluationSnapshot,
    shouldContinue: () => boolean = () => true,
  ) {
    const deckSnapshot = deckRef.current ?? deck;
    const startSlideIndex = currentSlideIndexRef.current;
    if (!deckSnapshot?.slides[startSlideIndex]) {
      return false;
    }

    const port = await liveSttSession.preparePort(
      {
        onError: handleLiveSttError,
        onResult: handleLiveSttResult,
      },
      shouldContinue,
    );
    if (!port) {
      resetAutoAdvanceRuntimeState(currentSlide?.slideId ?? null);
      return false;
    }
    pendingP3SlideIndexRef.current = null;

    let session: P3RehearsalSession | null = null;
    session = createP3RehearsalSession({
      slides: buildP3SessionSlides(
        deckSnapshot,
        evaluationSnapshot ?? createRehearsalEvaluationSnapshot(deckSnapshot),
      ),
      port,
      threshold: presenterSettings.advancePolicy.threshold,
      config: {
        ...presenterSettings.speechTracking,
        paceAdvice: {
          ...presenterSettings.paceAdvice,
          movingAverageWindowMs:
            defaultSpeechTrackingConfig.paceAdvice.movingAverageWindowMs,
        },
      },
      onEvents: (events) => {
        handleP3Events(events);
        if (session) {
          setP3SessionState(session.getState());
        }
      },
      onSnapshot: () => {
        if (session) {
          setP3SessionState(session.getState());
        }
      },
      semanticMatcher:
        import.meta.env.MODE === "test"
          ? undefined
          : getOrCreateSemanticMatcher(),
      semanticCueRuntime:
        import.meta.env.MODE === "test" || !ENABLE_REHEARSAL_NLI
          ? undefined
          : createSemanticCueRuntimeFromFlags("rehearsal"),
      isSemanticMatchingEnabled: () =>
        presenterSettings.advancePolicy.semanticMatching,
      onSemanticDebugState: setSemanticDebugState,
      onSemanticCueDebugEvent: (event) => {
        semanticCueDebugBufferRef.current.push(event);
        setSemanticCueDebugEvents(semanticCueDebugBufferRef.current.snapshot());
      },
      onSemanticCapabilityEvent: (event) => {
        setSemanticCapabilityEvents((current) =>
          [...current, event].slice(-100),
        );
        setSemanticCapabilityNowMs(Date.now());
      },
    });
    p3SessionRef.current = session;

    try {
      await session.start({
        audioSource: stream,
        slideIndex: startSlideIndex,
      });
      const isStaleRetry = !shouldContinue();
      if (p3SessionRef.current !== session || isStaleRetry) {
        if (isStaleRetry) {
          await session.stop().catch(() => null);
        }
        if (p3SessionRef.current === session) {
          liveSttSession.cleanupSubscriptions();
          p3SessionRef.current = null;
          pendingP3SlideIndexRef.current = null;
        }
        return false;
      }
      const latestSlideIndex =
        pendingP3SlideIndexRef.current ?? currentSlideIndexRef.current;
      pendingP3SlideIndexRef.current = null;
      if (
        latestSlideIndex !== startSlideIndex &&
        deckSnapshot.slides[latestSlideIndex]
      ) {
        session.enterSlide(latestSlideIndex);
      }
      syncP3AdviceState(session);
      p3RunMetaRef.current = null;
      pendingP3RunMetaRef.current = null;
      setP3RunMeta(null);
      setP3SessionState(session.getState());
      liveSttSession.markListening();
      return true;
    } catch (cause) {
      const isStaleRetry = !shouldContinue();
      if (p3SessionRef.current !== session || isStaleRetry) {
        if (isStaleRetry) {
          await session.stop().catch(() => null);
        }
        return false;
      }
      liveSttSession.cleanupSubscriptions();
      p3SessionRef.current = null;
      pendingP3SlideIndexRef.current = null;
      liveSttSession.fail(cause);
      resetAutoAdvanceRuntimeState(currentSlide?.slideId ?? null);
      return false;
    }
  }

  function syncP3AdviceState(p3Session: P3RehearsalSession) {
    p3Session.setAdviceState("slide-overtime", p3AdviceState.slideOvertime);
    p3Session.setAdviceState(
      "pace-too-fast",
      p3AdviceState.pace === "too-fast",
    );
    p3Session.setAdviceState(
      "pace-too-slow",
      p3AdviceState.pace === "too-slow",
    );
  }

  function handleSemanticCapabilityAction(item: SemanticCapabilityStatusItem) {
    if (item.actionLabel === "Cue 검토로 이동" && deck) {
      window.location.assign(`/project/${encodeURIComponent(deck.projectId)}`);
      return;
    }

    if (item.actionLabel === "서버 재평가" && run) {
      window.location.assign(getRehearsalReportPath(run.projectId, run.runId));
      return;
    }

    if (
      item.actionLabel === "마이크 권한 확인" ||
      item.actionLabel === "재시도"
    ) {
      setPracticeWithoutVoiceAt(null);
      void startLiveDemo();
    }
  }

  function ensurePauseDetector() {
    if (!pauseDetectorRef.current) {
      pauseDetectorRef.current = createPauseDetector({
        config: presenterSettings.pauseDetector,
        pauseMs: presenterSettings.advancePolicy.pauseMs,
      });
    }

    return pauseDetectorRef.current;
  }

  function updatePauseDetector(event: PauseDetectorEvent) {
    if (rehearsalRuntimeStatusRef.current === "paused") {
      return;
    }

    const atMs =
      "atMs" in event && typeof event.atMs === "number"
        ? event.atMs
        : Date.now();
    const detector = ensurePauseDetector();
    const outputs = detector.accept(event);
    for (const output of outputs) {
      if (output.type !== "pause-started") {
        continue;
      }
      const p3Session = p3SessionRef.current;
      if (p3Session?.acceptPrompterPauseBoundary(output.silenceDurationMs)) {
        setP3SessionState(p3Session.getState());
        setScriptAutoFollowKey((current) => current + 1);
      }
    }
    setPauseDetectorSnapshot(detector.snapshot(atMs));
    setAutoAdvanceNowMs(atMs);
  }

  function updateAdvanceControllerState(nextState: AdvanceControllerState) {
    advanceControllerStateRef.current = nextState;
    setAdvanceControllerState(nextState);
  }

  function resetAutoAdvanceRuntimeState(slideId: string | null) {
    pauseDetectorRef.current?.accept({ type: "reset" });
    setPauseDetectorSnapshot(null);
    setLastSentenceSpokenAtMs(null);
    lastSentenceSpokenAtMsRef.current = null;
    finalSentenceCommittedAtMsRef.current = null;
    updateAdvanceControllerState(
      slideId
        ? resetAdvanceControllerForSlide(slideId)
        : createInitialAdvanceControllerState(),
    );
  }

  function cancelAutoAdvanceForManualCommand() {
    const result = cancelAdvanceCountdown(
      advanceControllerStateRef.current,
      "manual",
    );
    updateAdvanceControllerState(result.state);
  }

  function handleP3Events(events: SpeechTrackingEvent[]) {
    if (events.some((event) => event.type === "last-sentence-spoken")) {
      const spokenAt = Date.now();
      lastSentenceSpokenAtMsRef.current = spokenAt;
      setLastSentenceSpokenAtMs(spokenAt);
    }
  }

  function runAdvanceControllerEvaluation(input: {
    effectiveCoverage: number;
    finalSentenceCommitted: boolean;
    finalSentenceSpoken: boolean;
    remainingTriggerSteps: number;
  }) {
    if (
      !deck ||
      !currentSlide ||
      rehearsalRuntimeStatusRef.current !== "running"
    ) {
      return;
    }

    const nowMs = Date.now();
    if (input.finalSentenceCommitted) {
      finalSentenceCommittedAtMsRef.current ??= nowMs;
    } else {
      finalSentenceCommittedAtMsRef.current = null;
    }
    const detector = ensurePauseDetector();
    const pause = pauseDetectorSnapshot ?? detector.snapshot(nowMs);
    const result = evaluateAdvanceController(
      advanceControllerStateRef.current,
      {
        effectiveCoverage: input.effectiveCoverage,
        finalSentenceCommitted: input.finalSentenceCommitted,
        finalSentenceCommittedAtMs: finalSentenceCommittedAtMsRef.current,
        finalSentenceSpoken: input.finalSentenceSpoken,
        finalSentenceSpokenAtMs: lastSentenceSpokenAtMsRef.current,
        isLastSlide: currentSlideIndex >= deck.slides.length - 1,
        mode: "rehearsal",
        nowMs,
        pause: {
          isPaused: pause.isPaused,
          silenceDurationMs: pause.silenceDurationMs,
        },
        policy: presenterSettings.advancePolicy,
        remainingTriggerSteps: input.remainingTriggerSteps,
        semanticAutoActionAllowed: isSemanticAutoActionAllowed(
          semanticCapabilityItems,
        ),
        slideId: currentSlide.slideId,
      },
      defaultAutoAdvanceConfig,
    );

    updateAdvanceControllerState(result.state);
    setAutoAdvanceNowMs(nowMs);

    for (const command of result.commands) {
      if (command.type !== "advance-slide") {
        continue;
      }

      const nextSlide = deck.slides[currentSlideIndex + 1];
      if (!nextSlide) {
        continue;
      }

      void requestPreparedSlideChange({
        source: "auto",
        stepIndex: 0,
        targetSlideIndex: currentSlideIndex + 1,
      }).then((result) => {
        if (result !== "committed") return;
        setLiveSlideAdvance({
          type: "slide-advance",
          fromSlideId: currentSlide.slideId,
          toSlideId: nextSlide.slideId,
          reason: "keyword-coverage",
          coverage: input.effectiveCoverage,
        });
      });
    }
  }

  function handleLiveSttError(error: LiveSttError) {
    if (rehearsalRuntimeStatusRef.current === "paused") {
      return;
    }

    if (!p3SessionRef.current) {
      return;
    }

    liveSttSession.fail(error);
    resetAutoAdvanceRuntimeState(currentSlide?.slideId ?? null);
  }

  function handleLiveSttResult(result: LiveSttResult) {
    if (
      !p3SessionRef.current ||
      rehearsalRuntimeStatusRef.current === "paused"
    ) {
      return;
    }

    if (result.text.trim()) {
      setScriptAutoFollowKey((current) => current + 1);
    }

    updatePauseDetector({
      type: "transcript-activity",
      atMs: Date.now(),
      isFinal: result.isFinal,
    });
    handleLivePartialTranscript({
      type: "partial-transcript",
      transcript: result.text,
      isFinal: result.isFinal,
      confidence: result.confidence ?? null,
    });
  }

  function handleLivePartialTranscript(event: LiveSttPartialTranscriptEvent) {
    if (rehearsalRuntimeStatusRef.current === "paused") {
      return;
    }

    const deckSnapshot = deckRef.current;
    const slideIndex = currentSlideIndexRef.current;
    const slide = deckSnapshot?.slides[slideIndex];
    if (!deckSnapshot || !slide) {
      return;
    }

    const previousTranscript = renderLiveTranscriptBuffer(
      liveTranscriptBufferRef.current,
    );
    const nextBuffer = applyLiveTranscriptEvent(
      liveTranscriptBufferRef.current,
      event,
    );
    liveTranscriptBufferRef.current = nextBuffer;

    const nextSessionBuffer = applyLiveTranscriptEvent(
      liveSessionTranscriptBufferRef.current,
      event,
    );
    liveSessionTranscriptBufferRef.current = nextSessionBuffer;
    setLiveSessionTranscript(renderLiveTranscriptBuffer(nextSessionBuffer));

    const transcript = renderLiveTranscriptBuffer(nextBuffer);
    const biasMode = getLiveSttBiasMode();
    const biasContext = liveSttSession.getBiasContext(
      deckSnapshot,
      slideIndex,
      {
        nearbySlides: getNearbySlides(deckSnapshot, slideIndex),
        pronunciationLexicon:
          runLifecycle.getActiveRun()?.evaluationSnapshot?.pronunciationLexicon,
      },
    );
    const matchingTranscript = shouldUseLiveSttPostprocessBias(biasMode)
      ? applyLiveTranscriptBias(transcript, biasContext)
      : transcript;
    const previousMatchingTranscript = shouldUseLiveSttPostprocessBias(biasMode)
      ? applyLiveTranscriptBias(previousTranscript, biasContext)
      : previousTranscript;
    const analysis = evaluateLiveTranscript(
      slide,
      matchingTranscript,
      runLifecycle.getActiveRun()?.evaluationSnapshot?.pronunciationLexicon,
    );
    const confirmedCommand = confirmRehearsalCommandCandidate(
      liveCommandConfirmationRef.current,
      detectRehearsalCommandCandidate(event),
    );
    const slideTriggerAnimationIds = getTriggerAnimationIdsForSlide(slide);
    const slideAnimationPlan = createSlideshowAnimationPlan({
      slide,
      triggerAnimationIds: slideTriggerAnimationIds,
    });
    const targetOccurrenceIds = getKeywordOccurrenceTriggerIdsForSlide(slide);
    const occurrenceState = getLiveKeywordOccurrenceStateForSlide(
      liveKeywordOccurrenceStateRef.current,
      slide.slideId,
    );
    const occurrenceMatches = matchKeywordOccurrenceTriggers({
      slide,
      targetOccurrenceIds,
      previousTranscript: previousMatchingTranscript,
      transcript: matchingTranscript,
      latestTranscript: event.transcript,
      confidence: event.confidence,
      confirmedOccurrenceIds: occurrenceState.confirmedOccurrenceIds,
    });

    for (const occurrenceMatch of occurrenceMatches) {
      setLiveCue(
        createKeywordOccurrenceAnimationCueEvent({
          match: occurrenceMatch,
          slideId: slide.slideId,
        }),
      );

      applyTriggeredSlideActions(
        slide,
        slideAnimationPlan,
        resolveKeywordOccurrenceTriggeredActions(
          slide,
          occurrenceMatch.keywordId,
          occurrenceMatch.occurrenceId,
        ),
        deckSnapshot.slides.length,
      );
    }
    liveKeywordOccurrenceStateRef.current = confirmKeywordOccurrenceMatches(
      occurrenceState,
      occurrenceMatches,
    );

    const previousDetectedIds = new Set(
      liveKeywordStateRef.current?.slideId === slide.slideId
        ? liveKeywordStateRef.current.detectedKeywords.map(
            (keyword) => keyword.keywordId,
          )
        : [],
    );
    const newlyDetected = analysis.detectedKeywords.find(
      (keyword) => !previousDetectedIds.has(keyword.keywordId),
    );

    if (newlyDetected) {
      setLiveCue({
        type: "animation-cue",
        slideId: slide.slideId,
        keywordId: newlyDetected.keywordId,
        cue: "emphasis",
        text: newlyDetected.text,
      });

      applyTriggeredSlideActions(
        slide,
        slideAnimationPlan,
        resolveKeywordTriggeredActions(slide, newlyDetected.keywordId),
        deckSnapshot.slides.length,
      );
    }

    if (isEmphasisCommand(confirmedCommand)) {
      setLiveCue({
        type: "animation-cue",
        slideId: slide.slideId,
        keywordId: "command-emphasis",
        cue: "emphasis",
        text: confirmedCommand.phrase,
      });

      applyTriggeredSlideActions(
        slide,
        slideAnimationPlan,
        resolveCueTriggeredActions(slide, "emphasis"),
        deckSnapshot.slides.length,
      );
    }

    setLiveKeywordState(analysis);
    liveKeywordStateRef.current = analysis;
    liveSttSession.markListening();

    if (isAdvanceSlideCommand(confirmedCommand)) {
      cancelAutoAdvanceForManualCommand();
      goNext();
    }
  }

  function applyTriggeredSlideActions(
    slide: Slide,
    slideAnimationPlan: ReturnType<typeof createSlideshowAnimationPlan>,
    actions: Slide["actions"],
    slideCount: number,
  ) {
    if (actions.length === 0) {
      return;
    }

    const playbackUpdate = resolveTriggeredActionPlaybackUpdate({
      actions,
      playbackState: slidePlaybackStateRef.current,
      presenterStepIndex: presenterStepIndexRef.current,
      slide,
      slideAnimationPlan,
    });

    if (playbackUpdate.playbackState !== slidePlaybackStateRef.current) {
      slidePlaybackStateRef.current = playbackUpdate.playbackState;
      setSlidePlaybackState(playbackUpdate.playbackState);
    }

    if (playbackUpdate.shouldAdvanceSlide) {
      cancelAutoAdvanceForManualCommand();
      void requestPreparedSlideChange({
        source: "auto",
        stepIndex: 0,
        targetSlideIndex: Math.min(
          slideCount - 1,
          currentSlideIndexRef.current + 1,
        ),
      });
      return;
    }

    if (playbackUpdate.presenterStepIndex !== presenterStepIndexRef.current) {
      commitPresenterStep(playbackUpdate.presenterStepIndex);
    }
  }

  function resetLivePlaybackForSlide(slide: Slide | null) {
    speechTracking.resetSlideTranscript(slide);
    setLiveCue(null);
    const nextSlidePlaybackState = createSlidePlaybackState();
    slidePlaybackStateRef.current = nextSlidePlaybackState;
    setSlidePlaybackState(nextSlidePlaybackState);
    setLiveSlideAdvance(null);
  }

  function restoreLivePlaybackAtStep(slide: Slide, stepIndex: number) {
    speechTracking.resetSlideTranscript(slide);
    setLiveCue(null);
    const restored = restoreSlidePlaybackAtStep({
      slide,
      slideAnimationPlan: createSlideshowAnimationPlan({
        slide,
        triggerAnimationIds: getTriggerAnimationIdsForSlide(slide),
      }),
      stepIndex,
    });
    slidePlaybackStateRef.current = restored.playbackState;
    setSlidePlaybackState(restored.playbackState);
    liveKeywordOccurrenceStateRef.current = {
      confirmedOccurrenceIds: restored.consumedOccurrenceIds,
      slideId: slide.slideId,
    };
    setLiveSlideAdvance(null);
  }

  const goPrevious = () => {
    cancelAutoAdvanceForManualCommand();
    void requestPreparedSlideChange({
      source: "manual",
      stepIndex: 0,
      targetSlideIndex: currentSlideIndexRef.current - 1,
    });
  };
  const handleAnimationFlowNavigation = (
    navigation: AnimationFlowNavigation,
  ) => {
    if (!deck) return;
    cancelAutoAdvanceForManualCommand();
    const targetSlide = deck.slides[navigation.targetSlideIndex];
    if (!targetSlide) return;
    const stepIndex =
      targetSlide.kind === "activity" || targetSlide.kind === "activity-results"
        ? 0
        : navigation.stepIndex;

    if (navigation.targetSlideIndex === currentSlideIndexRef.current) {
      pendingFlowRestoreRef.current = null;
      restoreLivePlaybackAtStep(targetSlide, stepIndex);
    } else {
      pendingFlowRestoreRef.current = {
        slideId: targetSlide.slideId,
        stepIndex,
      };
    }
    void requestPreparedSlideChange({
      source: "flow-navigator",
      stepIndex,
      targetSlideIndex: navigation.targetSlideIndex,
    });
  };
  const goNext = () => {
    if (!deck) return;
    cancelAutoAdvanceForManualCommand();
    void requestPreparedSlideChange({
      source: "manual",
      stepIndex: 0,
      targetSlideIndex: currentSlideIndexRef.current + 1,
    });
  };
  const handleNextPresenterStep = () => {
    if (!deck || !slideshowAnimationPlan) return;
    cancelAutoAdvanceForManualCommand();

    const nextState = getNextPresenterStepState({
      currentSlideIndex,
      currentStepIndex: presenterStepIndex,
      maxStepIndex: slideshowAnimationPlan.maxStepIndex,
      slideCount: deck.slides.length,
    });
    void requestPreparedSlideChange({
      source: "manual",
      stepIndex: nextState.stepIndex,
      targetSlideIndex: nextState.slideIndex,
    });
  };
  const finishRehearsal = () => {
    const projectId = deck?.projectId ?? props.projectId ?? demoIds.projectId;
    void closeRehearsalCompanionSession().catch(() => undefined);

    if (phase === "recording") {
      setHasLocalCompletion(true);
      runLifecycle.requestFinishAfterReport();
      setIsCompletionModalOpen(true);
      stopRecording();
      return;
    }

    if (phase === "uploading" || phase === "processing") {
      setHasLocalCompletion(true);
      runLifecycle.requestFinishAfterReport();
      setIsCompletionModalOpen(true);
      return;
    }

    if (isLiveDemoActive || isLiveSttActive) {
      stopLiveDemo({ showCompletionModal: true });
      return;
    }

    if (isTimerRunning) {
      setIsTimerRunning(false);
      setHasLocalCompletion(true);
      return;
    }

    void leaveRehearsal(getRehearsalFinishPath(projectId, run));
  };
  const finishCompletedRehearsal = () => {
    const projectId = deck?.projectId ?? props.projectId ?? demoIds.projectId;
    setIsCompletionModalOpen(false);
    void leaveRehearsal(
      run?.runId
        ? getRehearsalReportPath(projectId, run.runId)
        : getRehearsalFinishPath(projectId, run),
    );
  };

  function ensureRehearsalCompanionSession() {
    const sessionKey = deck ? `${deck.deckId}:${deck.version}` : null;
    if (
      companionSessionRef.current &&
      deck &&
      companionSessionRef.current.deckId === deck.deckId &&
      companionSessionRef.current.deckVersion === deck.version
    ) {
      return Promise.resolve(companionSessionRef.current);
    }
    if (
      companionSessionPromiseRef.current &&
      companionSessionPromiseKeyRef.current === sessionKey
    ) {
      return companionSessionPromiseRef.current;
    }
    if (!deck) {
      return Promise.reject(new Error("리허설 자료가 준비되지 않았습니다."));
    }
    companionSessionRef.current = null;
    companionSessionPromiseKeyRef.current = sessionKey;
    const promise = ensurePresenterCompanionSession({
      deckId: deck.deckId,
      projectId: deck.projectId,
      sessionPurpose: "rehearsal",
    })
      .then((session) => {
        if (companionSessionPromiseKeyRef.current === sessionKey) {
          companionSessionRef.current = session;
          setCompanionSession(session);
        }
        return session;
      })
      .finally(() => {
        if (companionSessionPromiseKeyRef.current === sessionKey) {
          companionSessionPromiseRef.current = null;
          companionSessionPromiseKeyRef.current = null;
        }
      });
    companionSessionPromiseRef.current = promise;
    return promise;
  }

  function closeRehearsalCompanionSession() {
    if (closeCompanionSessionPromiseRef.current) {
      return closeCompanionSessionPromiseRef.current;
    }
    const session = companionSessionRef.current;
    if (!session || !deck) {
      return Promise.resolve();
    }
    const promise = closePresenterCompanionSession({
      projectId: deck.projectId,
      sessionId: session.sessionId,
    })
      .then(() => {
        if (companionSessionRef.current?.sessionId === session.sessionId) {
          companionSessionRef.current = null;
          setCompanionSession(null);
        }
      })
      .finally(() => {
        closeCompanionSessionPromiseRef.current = null;
      });
    closeCompanionSessionPromiseRef.current = promise;
    return promise;
  }

  async function leaveRehearsal(path: string) {
    await closeRehearsalCompanionSession().catch(() => undefined);
    navigateToPath(path);
  }
  const resetRehearsalAttemptToBeginning = () => {
    const firstSlide = deck?.slides[0] ?? null;

    resetSlideDisplayToBeginning();
    speechTracking.resetSessionTranscript();
    resetLivePlaybackForSlide(firstSlide);
    resetAutoAdvanceRuntimeState(firstSlide?.slideId ?? null);
    if (deck) {
      speechTracking.resetSlideTranscriptSnapshots(deck, 0);
    }
    setScriptAutoFollowKey((current) => current + 1);
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

      if (result.ok) {
        return { ok: true, screens: result.value };
      }

      return { code: result.code, ok: false };
    };
  const resolveAutoPlacementScreen = (
    options: SlideDisplayOptions,
  ): {
    placementCode?: DisplayManagerErrorCode;
    targetScreen: DisplayScreenDescriptor | null;
  } => {
    if (!options.autoPlace) {
      return { targetScreen: null };
    }

    return { targetScreen: options.targetScreen ?? null };
  };
  const buildPresenterRemoteWindowPath = (state: {
    slideIndex: number;
    stepIndex: number;
  }) =>
    props.projectId
      ? getRehearsalPresenterWindowPath(
          props.projectId,
          presentationChannel.sessionId,
          state,
        )
      : getCurrentRehearsalPresenterWindowPath(
          presentationChannel.sessionId,
          state,
        );
  const closeSlideWindow = (windowRef: SlideWindowRef | null) => {
    if (windowRef && !windowRef.closed) {
      windowRef.close?.();
    }
  };
  const closeExistingSlideWindow = () => {
    closeSlideWindow(slideWindowRef.current);
    slideWindowRef.current = null;
  };
  const requestSlideWindowFullscreen =
    async (): Promise<RequestSlideWindowFullscreenResult> => {
      if (!slideWindowRef.current || slideWindowRef.current.closed) {
        return { code: "fullscreen-blocked", ok: false };
      }

      const result = displayManager.delegateSlideWindowFullscreen(
        slideWindowRef.current,
      );
      if (!result.ok) {
        return { code: result.code, ok: false };
      }

      return { ok: true };
    };
  const openSurfaceSwapDisplay = async (
    options: SlideDisplayOptions,
    targetScreen: DisplayScreenDescriptor,
    placementCode?: DisplayManagerErrorCode,
  ) => {
    if (!slideReceiverIdentity) {
      return {
        autoPlaced: false,
        displayOpened: false,
        fullscreenStarted: false,
        placementCode,
        placementTargetLabel: targetScreen.label,
      };
    }

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
      buildPresenterRemoteWindowPath({
        slideIndex: currentSlideIndexRef.current,
        stepIndex: presenterStepIndexRef.current,
      }),
      {
        screen: presenterScreen,
        target: `orbit-presenter-${presentationChannel.sessionId}-${Date.now()}`,
      },
    );

    setSlideReceiverMessage(
      remoteWindowResult.ok
        ? ""
        : "팝업이 차단되었습니다. 발표는 계속 진행됩니다. 이 화면의 제어 버튼으로 진행해주세요.",
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
  const openSlideWindowForDisplay = async (options: SlideDisplayOptions) => {
    if (!slideReceiverIdentity) {
      closeExistingSlideWindow();
      return {
        autoPlaced: false,
        displayOpened: false,
        fullscreenStarted: false,
        placementCode: undefined,
        placementTargetLabel: undefined,
      };
    }

    if (options.startFromBeginning) {
      resetSlideDisplayToBeginning();
    }

    const { placementCode, targetScreen } = resolveAutoPlacementScreen(options);
    if (
      options.presenterView &&
      options.fullscreen &&
      options.autoPlace &&
      targetScreen
    ) {
      const surfaceSwapResult = await openSurfaceSwapDisplay(
        options,
        targetScreen,
        placementCode,
      );
      if (surfaceSwapResult.fullscreenStarted) {
        return surfaceSwapResult;
      }
    }

    const previousSlideWindow = slideWindowRef.current;
    const openResult = displayManager.openSlideWindow(slideReceiverIdentity, {
      screen: targetScreen,
      target: `orbit-slide-${presentationChannel.sessionId}-${Date.now()}`,
    });
    if (!openResult.ok) {
      return {
        autoPlaced: false,
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
      displayOpened: true,
      fullscreenStarted: false,
      placementCode,
      placementTargetLabel: targetScreen?.label,
    };
  };
  const openCurrentWindowSlideDisplay = async (
    options: SlideDisplayOptions,
  ) => {
    if (options.startFromBeginning) {
      resetSlideDisplayToBeginning();
    }

    const fullscreenStarted = options.fullscreen
      ? await requestPresentWindowFullscreen(
          typeof document === "undefined" ? null : document.documentElement,
        )
      : false;

    setSlideReceiverMessage(
      options.fullscreen && !fullscreenStarted
        ? "전체화면 전환이 차단되었습니다. 아래 전체화면 버튼을 눌러주세요."
        : "",
    );
    setDisplayRole("slide-receiver");
    return fullscreenStarted;
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

    if (options.displayMode === "current-window") {
      return {
        displayMode: "current-window" as const,
        displayOpened: true,
        fullscreenStarted: await openCurrentWindowSlideDisplay(options),
      };
    }

    const slideWindowResult = await openSlideWindowForDisplay(options);

    return {
      autoPlaced: slideWindowResult.autoPlaced,
      displayMode: "slide-window" as const,
      displayOpened: slideWindowResult.displayOpened,
      fullscreenStarted: slideWindowResult.fullscreenStarted,
      placementCode: slideWindowResult.placementCode,
      placementTargetLabel: slideWindowResult.placementTargetLabel,
    };
  };

  const checklistKeywords = getChecklistKeywords(currentSlide);
  const highlightedKeywordOccurrences = useMemo(() => {
    return getHighlightedKeywordOccurrencesForSlide(currentSlide);
  }, [currentSlide]);
  const hasDeletedRawAudio = Boolean(run?.rawAudioDeletedAt);
  const nextSlide = deck?.slides[currentSlideIndex + 1] ?? null;
  const prompterRows = getRehearsalPrompterRows(
    p3Sentences,
    p3PanelSnapshot.coveredSentenceIds,
    currentSlide?.speakerNotes ?? "",
    p3PanelSnapshot.prompterProgress,
  );
  const rehearsalTimingProgressItems: PresenterTimingProgressItem[] = [
    {
      currentLabel: `현재 ${formatClock(p3TimingSnapshot.elapsedSeconds)}`,
      label: "총 발표 시간",
      percent: totalTimingProgress.percent,
      targetLabel: `예상 ${formatClock(p3TimingSnapshot.deckTargetSeconds)}`,
      tone: totalTimingProgress.tone,
    },
    {
      currentLabel: `현재 ${formatClock(p3TimingSnapshot.currentSlideElapsedSeconds)}`,
      label: "현재 슬라이드",
      percent: slideTimingProgress.percent,
      targetLabel: `예상 ${formatClock(p3TimingSnapshot.currentSlideTargetSeconds)}`,
      tone: slideTimingProgress.tone,
    },
  ];
  const rehearsalSummary = buildRehearsalCompletionSummary({
    deck,
    elapsedSeconds,
    meta: p3RunMeta,
    previousSummary: previousPracticeSummary,
    snapshot: p3PanelSnapshot,
    targetSeconds: timerDurationSeconds,
  });
  const isRehearsalRuntimeActive =
    phase === "recording" ||
    isLiveSttActive ||
    isTimerRunning ||
    rehearsalRuntimeStatus === "paused";
  const sanitizedLiveError = sanitizeLiveSttErrorMessage(liveError);
  const canRetryRecordingLiveStt = liveSttSession.canRetryRecording({
    hasActiveSession: p3SessionRef.current !== null,
    hasReusableStream: mediaSession.hasReusableStream("recording"),
    isRecording: phase === "recording",
  });
  const comparisonModel = runComparison
    ? buildRehearsalRunComparisonViewModel(
        runComparison,
        deck,
        deck?.projectId ?? props.projectId ?? demoIds.projectId,
      )
    : null;
  const nextSlideHint = nextSlide?.keywords?.[0]
    ? `"${nextSlide.keywords[0].text}"를 말하면 바로 이어집니다`
    : "마지막 문장을 정리하고 마무리하세요";
  const shouldShowRehearsalPreflight =
    Boolean(deck) &&
    !shouldAutoStartRef.current &&
    phase === "idle" &&
    liveStatus === "idle" &&
    !isLiveDemoActive &&
    !isTimerRunning &&
    rehearsalRuntimeStatus !== "paused" &&
    !p3RunMeta &&
    !hasLocalCompletion;
  useEffect(() => {
    if (!isRehearsalCompletionVisible) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isRehearsalCompletionVisible]);
  useEffect(() => {
    if (!isRehearsalRuntimeActive || !currentSlide) {
      setComparisonReminderState((state) =>
        state.active ? { ...state, active: null } : state,
      );
      return;
    }

    setComparisonReminderState((state) =>
      enterComparisonSlide(state, runComparison, currentSlide.slideId),
    );
  }, [currentSlide?.slideId, isRehearsalRuntimeActive, runComparison]);

  const returnToPreflight = () => {
    setIsLiveStopModalOpen(false);
    setP3RunMeta(null);
    setP3SessionState(null);
    p3RunMetaRef.current = null;
    pendingP3RunMetaRef.current = null;
    setRun(null);
    setHasLocalCompletion(false);
    liveSttSession.reset();
    setError("");
    setPracticeWithoutVoiceAt(null);
    setSemanticCapabilityEvents([]);
    setComparisonReminderState(createComparisonReminderState());
    setComparisonRefreshVersion((version) => version + 1);
    resetRehearsalTimerState({
      setElapsedSeconds,
      setSlideElapsedSeconds,
      setIsTimerRunning,
    });
    if (phase !== "uploading" && phase !== "processing") {
      setPhase("idle");
    }
  };
  const startPracticeWithoutVoice = () => {
    const disabledAt = Date.now();
    setError("");
    setPhase("idle");
    setElapsedSeconds(0);
    setSlideElapsedSeconds(0);
    setHasLocalCompletion(false);
    setIsTimerRunning(true);
    setPracticeWithoutVoiceAt(disabledAt);
    setSemanticCapabilityNowMs(disabledAt);
  };
  const persistCurrentPracticeSummary = () => {
    if (!deck) {
      return;
    }

    const nextSummary = createRehearsalPracticeSummary(deck, rehearsalSummary);
    writeRehearsalPracticeSummary(nextSummary);
    setPreviousPracticeSummary(nextSummary);
  };
  const handleCompletionPracticeAgain = () => {
    const shouldPracticeWithoutVoice = practiceWithoutVoiceAt !== null;

    persistCurrentPracticeSummary();
    returnToPreflight();
    resetRehearsalAttemptToBeginning();

    if (shouldPracticeWithoutVoice) {
      startPracticeWithoutVoice();
      return;
    }

    shouldAutoStartRef.current = "starting";
    void startRecording({ allowDuringReport: true }).finally(() => {
      shouldAutoStartRef.current = null;
    });
  };
  const handleCompletionPrimaryAction = () => {
    persistCurrentPracticeSummary();

    if (phase === "uploading" || phase === "processing") {
      runLifecycle.requestFinishAfterReport();
      return;
    }

    if (run?.runId) {
      finishRehearsal();
      return;
    }

    returnToPreflight();
  };

  useEffect(() => {
    if (!isP3TrackingActive || !liveAudioLevel) {
      return;
    }

    updatePauseDetector({
      type: "audio-level",
      atMs: Date.now(),
      rmsDb: liveAudioLevel.rmsDb,
    });
  }, [isP3TrackingActive, liveAudioLevel?.rmsDb]);

  useEffect(() => {
    if (!isP3TrackingActive) {
      resetAutoAdvanceRuntimeState(currentSlide?.slideId ?? null);
      return;
    }

    const timer = window.setInterval(() => {
      updatePauseDetector({ type: "tick", atMs: Date.now() });
    }, 250);

    return () => window.clearInterval(timer);
  }, [currentSlide?.slideId, isP3TrackingActive]);

  useEffect(() => {
    if (!deck || !currentSlide || !isP3TrackingActive) {
      return;
    }

    runAdvanceControllerEvaluation({
      effectiveCoverage: p3PanelSnapshot.effectiveCoverage,
      finalSentenceCommitted: p3PanelSnapshot.finalSentenceCommitted === true,
      finalSentenceSpoken: p3PanelSnapshot.finalSentenceSpoken,
      remainingTriggerSteps,
    });
  }, [
    currentSlide?.slideId,
    currentSlideIndex,
    deck?.slides.length,
    isP3TrackingActive,
    lastSentenceSpokenAtMs,
    pauseDetectorSnapshot?.isPaused,
    pauseDetectorSnapshot?.silenceDurationMs,
    p3PanelSnapshot.effectiveCoverage,
    p3PanelSnapshot.finalSentenceCommitted,
    p3PanelSnapshot.finalSentenceSpoken,
    presenterSettings.advancePolicy.countdownMs,
    presenterSettings.advancePolicy.live,
    presenterSettings.advancePolicy.pauseMs,
    presenterSettings.advancePolicy.rehearsal,
    presenterSettings.advancePolicy.threshold,
    presenterStepIndex,
    remainingTriggerSteps,
  ]);

  const { presenterScale, presenterStageRef } = usePresenterStageScale(deck);
  const slideReceiverIdentity = useMemo(
    () => (deck ? audienceScreenShareIdentity : null),
    [audienceScreenShareIdentity, deck],
  );
  const slideReceiverSnapshot = useMemo(
    () =>
      deck && presentationChannelState
        ? {
            deck: createSlideWindowDeckSnapshot(deck),
            state: createAudiencePresenterState(presentationChannelState),
            triggerAnimationIds,
          }
        : null,
    [deck, presentationChannelState, triggerAnimationIds],
  );

  if (phase === "failed" && error) {
    return (
      <RehearsalFailureScreen
        error={error}
        onPracticeWithoutVoice={deck ? startPracticeWithoutVoice : undefined}
        onRetry={deck ? returnToPreflight : () => window.location.reload()}
        projectId={deck?.projectId ?? props.projectId}
      />
    );
  }

  if (
    props.presenterWindow &&
    (!deck || !slideReceiverIdentity || !presentationChannelState)
  ) {
    return (
      <main className="presenter-remote-shell" aria-label="발표자 제어 창">
        <section className="presenter-remote-status" role="status">
          발표자 제어를 준비하는 중입니다.
        </section>
      </main>
    );
  }

  if (
    props.presenterWindow &&
    deck &&
    slideReceiverIdentity &&
    presentationChannelState
  ) {
    return (
      <PresenterRemoteWindow
        deck={deck}
        identity={slideReceiverIdentity}
        initialState={presentationChannelState}
      />
    );
  }

  if (
    (displayRole === "slide-receiver" || displayRole === "slide-surface") &&
    slideReceiverIdentity &&
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
        onNextStep={handleNextPresenterStep}
        onPreviousSlide={goPrevious}
        onReconnectPresenter={(snapshot) => {
          const presenterWindowPath = props.projectId
            ? getRehearsalPresenterWindowPath(
                props.projectId,
                presentationChannel.sessionId,
                {
                  slideIndex: snapshot.state.slideIndex,
                  stepIndex: snapshot.state.stepIndex,
                },
              )
            : getCurrentRehearsalPresenterWindowPath(
                presentationChannel.sessionId,
                {
                  slideIndex: snapshot.state.slideIndex,
                  stepIndex: snapshot.state.stepIndex,
                },
              );
          const presenterWindow =
            typeof window === "undefined"
              ? null
              : window.open(
                  presenterWindowPath,
                  `orbit-presenter-${presentationChannel.sessionId}`,
                  "popup=yes,width=1512,height=900",
                );
          presenterWindow?.focus();
          if (presenterWindow) return setSlideReceiverMessage("");

          setSlideReceiverMessage(
            "팝업이 차단되었습니다. 브라우저 팝업을 허용한 뒤 발표자 창 다시 열기를 눌러주세요.",
          );
        }}
        onExit={() => {
          if (typeof document !== "undefined" && document.fullscreenElement) {
            void document.exitFullscreen();
          }
          setDisplayRole("presenter");
          setSlideReceiverMessage("");
        }}
      />
    );
  }

  if (isSingleScreenOpen && deck && currentSlide) {
    return (
      <SingleScreenPresenter
        deck={deck}
        onExit={() => setIsSingleScreenOpen(false)}
        onNextStep={handleNextPresenterStep}
        slideElapsedLabel={formatClock(slideElapsedSeconds)}
        slideId={currentSlide.slideId}
        slideTargetLabel={formatClock(currentSlideTargetSeconds)}
        stepIndex={presenterStepIndex}
        totalTimeLabel={formatClock(displayedTimeSeconds)}
        triggerAnimationIds={triggerAnimationIds}
      />
    );
  }

  if (shouldShowRehearsalPreflight && deck) {
    return (
      <RehearsalPreflightScreen
        banner={buildRehearsalPreflightBanner(deck, previousPracticeSummary)}
        canStart={canRecord}
        companionSetup={
          presenterCompanionEnabled && companionSession ? (
            <PresenterCompanionSetup
              projectId={deck.projectId}
              sessionId={companionSession.sessionId}
              sessionPurpose={companionSession.sessionPurpose}
              variant="preflight"
            />
          ) : undefined
        }
        comparisonModel={comparisonModel}
        createLiveSttPort={(engineId) =>
          createDefaultLiveSttPort({
            engineId,
            legacyAdapter: props.liveSttAdapter,
            projectId: deck.projectId,
          })
        }
        deck={deck}
        resolveLiveSttEngine={liveSttSession.resolveEffectiveEngine}
        onPracticeWithoutVoice={startPracticeWithoutVoice}
        onStart={() => void startRecording()}
      />
    );
  }

  const showSemanticCueDebugPanel = shouldShowSemanticCueDebugPanel({
    flagEnabled: getSemanticCueRuntimeFlags(import.meta.env).debugPanelEnabled,
    locationSearch: typeof window === "undefined" ? "" : window.location.search,
  });

  function copySemanticCueDebugJson(json: string) {
    void navigator.clipboard?.writeText(json);
  }

  function exportSemanticCueDebugJson(json: string) {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "semantic-cue-debug-events.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="rehearsal-presenter-shell">
      {isRehearsalCompletionVisible && deck ? (
        <RehearsalCompletionScreen
          hasReportTarget={Boolean(run?.runId)}
          isReportPending={phase === "uploading" || phase === "processing"}
          onClose={() => void leaveRehearsal("/")}
          onGoHome={() => void leaveRehearsal("/")}
          onOpenProject={() =>
            void leaveRehearsal(
              `/project/${encodeURIComponent(deck.projectId)}`,
            )
          }
          onPrimaryAction={handleCompletionPrimaryAction}
          onPracticeAgain={handleCompletionPracticeAgain}
        />
      ) : null}
      {isLiveStopModalOpen && !isRehearsalCompletionVisible ? (
        <div className="rehearsal-live-stop-modal-backdrop" role="presentation">
          <section
            aria-labelledby="rehearsal-live-stop-modal-title"
            aria-modal="true"
            className="rehearsal-live-stop-modal"
            role="dialog"
          >
            <span className="rehearsal-live-stop-modal-icon" aria-hidden="true">
              <CheckCircle2 size={28} />
            </span>
            <h2 id="rehearsal-live-stop-modal-title">
              Live STT가 종료되었습니다
            </h2>
            <p>
              {run?.runId
                ? `현재 리허설 runId는 ${run.runId}입니다.`
                : "Live STT 단독 실행은 runId를 만들지 않습니다. 리포트 녹음 흐름에서 runId가 생성됩니다."}
            </p>
            <button
              className="primary-action"
              type="button"
              onClick={() => setIsLiveStopModalOpen(false)}
            >
              확인
            </button>
          </section>
        </div>
      ) : null}
      {shouldShowCompletionModal && !isRehearsalCompletionVisible ? (
        <div
          className="rehearsal-completion-modal-backdrop"
          role="presentation"
        >
          <section
            aria-labelledby="rehearsal-completion-modal-title"
            aria-modal="true"
            className="rehearsal-completion-modal"
            role="dialog"
          >
            {phase === "succeeded" ? (
              <>
                <span
                  className="rehearsal-completion-modal-icon"
                  aria-hidden="true"
                >
                  <CheckCircle2 size={28} />
                </span>
                <h2 id="rehearsal-completion-modal-title">
                  리포트 생성이 완료되었습니다
                </h2>
                <JobProgressDisplay
                  progress={completionProgress}
                  message={completionMessage}
                />
                <button
                  className="primary-action"
                  type="button"
                  onClick={finishCompletedRehearsal}
                >
                  리허설 마치기
                </button>
              </>
            ) : (
              <>
                <h2 id="rehearsal-completion-modal-title">
                  리포트를 생성하고 있습니다
                </h2>
                <p>음성 업로드와 AI 분석이 끝나면 리허설을 마칠 수 있습니다.</p>
                <JobProgressDisplay
                  progress={completionProgress}
                  message={completionMessage}
                />
              </>
            )}
          </section>
        </div>
      ) : null}
      <PresenterTopbar
        exitButtonClassName={`rehearsal-exit-button ${
          advanceControllerState.status === "finish-suggested"
            ? "auto-advance-finish-highlight"
            : ""
        }`}
        exitButtonContent={
          <>
            <Presentation size={16} />
            {"\ub9ac\ud5c8\uc124 \ub9c8\uce58\uae30"}
          </>
        }
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
        onExit={finishRehearsal}
        onPrimaryAction={() => void handleTimePrimaryAction()}
        onReset={() => {
          resetRehearsalTimerState({
            setElapsedSeconds,
            setSlideElapsedSeconds,
            setIsTimerRunning,
          });
        }}
        onTimeModeChange={(value) => {
          setTimeMode(value as RehearsalTimeMode);
          resetRehearsalTimerState({
            setElapsedSeconds,
            setSlideElapsedSeconds,
            setIsTimerRunning,
          });
        }}
        primaryActionAriaLabel={
          rehearsalRuntimeStatus === "paused"
            ? "리허설 다시 시작"
            : isTimerRunning
              ? "리허설 일시정지"
              : "리허설 시작"
        }
        primaryActionDisabled={
          rehearsalRuntimeStatus !== "paused" && !isTimerRunning && !canRecord
        }
        primaryActionRunning={
          rehearsalRuntimeStatus !== "paused" && isTimerRunning
        }
        timeMode={timeMode}
        timerDurationInput={timerDurationInput}
        title="리허설"
        toolbar={
          deck ? (
            <div className="rehearsal-display-toolbar">
              <DisplayControls
                channelStatus={presentationChannel.status}
                onOpenSlideDisplay={openSlideDisplay}
                onRequestDisplayScreens={requestDisplayScreens}
                onRequestSlideWindowFullscreen={requestSlideWindowFullscreen}
              />
              {presenterCompanionEnabled && companionSession ? (
                <PresenterCompanionStatus
                  projectId={deck.projectId}
                  sessionId={companionSession.sessionId}
                  sessionPurpose={companionSession.sessionPurpose}
                />
              ) : null}
            </div>
          ) : null
        }
        totalElapsedInput={elapsedTimeInput}
      />
      <div
        className="rehearsal-smoke-controls"
        aria-label="리허설 smoke controls"
      >
        <button
          type="button"
          onClick={() => void startRecording()}
          disabled={!canRecord}
        >
          리포트 녹음 시작
        </button>
        <button
          type="button"
          onClick={stopRecording}
          disabled={phase !== "recording"}
        >
          리포트 녹음 종료
        </button>
        {hasDeletedRawAudio ? <span>raw audio 삭제 완료</span> : null}
      </div>

      <PracticeGoalReminder
        projectId={props.projectId ?? demoIds.projectId}
        sourceFullRunId={props.sourceFullRunId}
        slideId={currentSlide?.slideId}
      />

      <section className="rehearsal-presenter-layout">
        <PresenterStageSection
          currentIndex={currentSlideIndex}
          emptyStageLabel={"\ubc1c\ud45c\uc790\ub8cc \ub85c\ub529 \uc911"}
          leftPanel={
            <AnimationFlowNavigator
              currentSlideIndex={currentSlideIndex}
              currentStepIndex={presenterStepIndex}
              deck={deck}
              navigationPending={isSlidePreparationPending}
              onNavigate={handleAnimationFlowNavigation}
              placement="drawer"
            />
          }
          navigationPending={isSlidePreparationPending}
          nextHint={nextSlideHint}
          nextSlideTitle={
            nextSlide ? getSlideTitle(nextSlide) : "다음 슬라이드 없음"
          }
          onNext={handleNextPresenterStep}
          onPrevious={goPrevious}
          onStageAdvance={handleNextPresenterStep}
          previousDisabled={currentSlideIndex === 0}
          renderStage={
            deck && currentSlide && presenterScale !== null ? (
              <SlideshowRenderer
                deck={deck}
                scale={presenterScale}
                slideId={currentSlide.slideId}
                stepIndex={presenterStepIndex}
                triggerAnimationIds={triggerAnimationIds}
              />
            ) : null
          }
          stageIndexLabel={
            deck
              ? `${String(currentSlideIndex + 1).padStart(2, "0")} / ${String(
                  deck.slides.length,
                ).padStart(2, "0")}`
              : undefined
          }
          stageAdvanceDisabled={
            currentSlide?.kind === "activity" ||
            currentSlide?.kind === "activity-results"
          }
          stageRef={presenterStageRef}
          totalSlides={deck?.slides.length ?? 0}
        />

        <aside className="rehearsal-presenter-side">
          <PresenterTimerCard
            ariaLabel="리허설 타이머"
            currentTimeLabel="경과 발표 시간"
            meterPercent={liveAudioLevelPercent}
            onPrimaryAction={handleSideTimerPrimaryAction}
            onReset={() => {
              resetRehearsalTimerState({
                setElapsedSeconds,
                setSlideElapsedSeconds,
                setIsTimerRunning,
              });
            }}
            onTimeInputBlur={(value) => {
              setTimeMode("timer");
              commitTimerDurationInput(value);
            }}
            onTimeInputChange={(value) => {
              setEditingTimeField("duration");
              setTimerDurationInput(value);
            }}
            onTimeInputFocus={() => {
              setEditingTimeField("duration");
              setTimerDurationInput(formatClock(timerDurationSeconds));
            }}
            primaryActionAriaLabel={
              rehearsalRuntimeStatus === "paused"
                ? "리허설 다시 시작"
                : phase === "recording"
                  ? "리허설 일시정지"
                  : canStopLiveDemo
                    ? "Live STT 일시정지"
                    : isTimerRunning
                      ? "타이머 일시정지"
                      : "리포트 녹음 시작"
            }
            primaryActionDisabled={!deck && !isTimerRunning}
            primaryActionRunning={
              rehearsalRuntimeStatus !== "paused" &&
              (canStopLiveDemo || isTimerRunning)
            }
            progressItems={rehearsalTimingProgressItems}
            progressPercent={rehearsalProgressPercent}
            resetAriaLabel="스톱워치 초기화"
            timeInputValue={formatClock(displayedTimeSeconds)}
            timeMetaLeft={`현재 ${formatClock(p3TimingSnapshot.currentSlideElapsedSeconds)}`}
            timeMetaRight={`예상 ${formatClock(p3TimingSnapshot.currentSlideTargetSeconds)}`}
            timeReadOnly
            title="발표 스톱워치"
          />

          {currentSlide?.kind === "activity" && deck ? (
            <ActivityPresenterPanel
              autoStart
              deckId={deck.deckId}
              deckVersion={deck.version}
              projectId={deck.projectId}
              slide={currentSlide}
            />
          ) : (
            <RehearsalPanel
              mode="rehearsal"
              timing={p3TimingSnapshot}
              wordsPerMinute={p3WordsPerMinute}
              adviceState={p3AdviceState}
              highlightedKeywordOccurrences={highlightedKeywordOccurrences}
              keywords={checklistKeywords}
              scriptAutoFollowKey={scriptAutoFollowKey}
              sentences={p3Sentences}
              showAdvicePanel={false}
              showScriptPanel={true}
              speakerNotes={currentSlide?.speakerNotes ?? ""}
              snapshot={p3PanelSnapshot}
              semanticCapabilityItems={semanticCapabilityItems}
              semanticCueItems={
                ENABLE_REHEARSAL_NLI &&
                p3SessionState?.slideIndex === currentSlideIndex
                  ? p3SessionState.semanticCueProgress
                  : []
              }
              onSemanticCapabilityAction={handleSemanticCapabilityAction}
              comparisonReminder={comparisonReminderState.active}
              onDismissComparisonReminder={() =>
                setComparisonReminderState(dismissComparisonReminder)
              }
              liveSlot={
                <section className="rehearsal-assist-card checklist-card">
                  <header>
                    <span>
                      <Mic size={16} />
                      Live STT
                    </span>
                    <button type="button" aria-label="More checklist options">
                      <MoreHorizontal size={18} />
                    </button>
                  </header>

                  <div
                    className={`rehearsal-live-status rehearsal-live-status-${liveStatus}`}
                  >
                    <strong>{liveStatus}</strong>
                    <span>
                      {p3RunMeta
                        ? `로컬 메타 ${p3RunMeta.slideTimeline.length}개 슬라이드`
                        : advanceControllerState.status === "countdown"
                          ? "자동 전환 카운트다운"
                          : advanceControllerState.status ===
                              "blocked-by-builds"
                            ? "빌드 대기"
                            : advanceControllerState.status ===
                                "finish-suggested"
                              ? "종료 제안"
                              : "자동 전환 활성"}
                    </span>
                  </div>

                  <AutoAdvanceStatus
                    countdownMs={presenterSettings.advancePolicy.countdownMs}
                    nowMs={autoAdvanceNowMs}
                    onFinish={finishRehearsal}
                    state={advanceControllerState}
                  />

                  <AutoAdvanceSettings
                    policy={presenterSettings.advancePolicy}
                    saveSettings={savePresenterSettings}
                  />

                  <div className="rehearsal-live-actions rehearsal-live-actions-legacy">
                    <button
                      className="primary-action"
                      type="button"
                      onClick={() => void startLiveDemo()}
                      disabled={!canStartLiveDemo}
                    >
                      <Mic size={18} />
                      Live STT 시작
                    </button>
                    <button
                      className="secondary-action"
                      type="button"
                      onClick={() =>
                        stopLiveDemo({ showCompletionModal: true })
                      }
                      disabled={!canStopLiveDemo}
                    >
                      <Square size={18} />
                      Live STT 종료
                    </button>
                  </div>

                  <div
                    className={`rehearsal-live-audio-meter rehearsal-live-audio-meter-${liveAudioMeterState}`}
                  >
                    <div className="rehearsal-live-audio-meter-header">
                      <span>Mic input</span>
                      <strong>{liveAudioLevelLabel}</strong>
                    </div>
                    <div
                      className="rehearsal-live-audio-meter-track"
                      role="meter"
                      aria-label="Mic input level"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(liveAudioLevelPercent)}
                      aria-valuetext={liveAudioLevelLabel}
                    >
                      <span style={{ width: `${liveAudioLevelPercent}%` }} />
                    </div>
                    <small>
                      {liveAudioLevel
                        ? `${Math.round(liveAudioLevel.rmsDb)} dB RMS`
                        : "-100 dB RMS"}
                    </small>
                  </div>
                  {canDownloadLiveSttDebugPcm ? (
                    <button
                      className="secondary-action"
                      type="button"
                      onClick={liveSttSession.downloadDebugPcm}
                    >
                      <Download size={16} />
                      모델 입력 WAV 다운로드
                    </button>
                  ) : null}

                  {liveCue && (
                    <div className="job-status" aria-live="polite">
                      <div>
                        <strong>emphasis</strong>
                        <span>{liveCue.text}</span>
                      </div>
                      <p>현재 슬라이드에서 키워드를 감지했습니다.</p>
                    </div>
                  )}

                  {liveSlideAdvance && (
                    <div className="project-status-message project-status-success">
                      <CheckCircle2 size={18} />
                      <span>
                        키워드 {Math.round(liveSlideAdvance.coverage * 100)}%
                        감지로 자동 전환
                      </span>
                    </div>
                  )}

                  {sanitizedLiveError && (
                    <div
                      className="project-status-message project-status-danger"
                      role="status"
                    >
                      <AlertCircle size={18} />
                      <span>{sanitizedLiveError}</span>
                      {canRetryRecordingLiveStt ? (
                        <button
                          className="secondary-action"
                          disabled={isLiveSttRetrying}
                          type="button"
                          onClick={() => void retryInitialRecordingLiveStt()}
                        >
                          {isLiveSttRetrying
                            ? "다시 연결 중"
                            : "음성 인식 다시 연결"}
                        </button>
                      ) : null}
                    </div>
                  )}
                </section>
              }
            />
          )}
        </aside>

        <RehearsalTeleprompter
          countdownMs={presenterSettings.advancePolicy.countdownMs}
          focusScopeId={currentSlide?.slideId ?? "fallback"}
          nowMs={autoAdvanceNowMs}
          onCancel={cancelAutoAdvanceForManualCommand}
          rows={prompterRows}
          scriptProgressPercent={Math.round(
            (p3PanelSnapshot.scriptProgress?.ratio ?? 0) * 100,
          )}
          state={advanceControllerState}
        />
      </section>
      {showSemanticDebugPanel ? (
        <SemanticSpeechDebugPanel
          liveTranscript={liveSessionTranscript}
          semanticMatchingEnabled={
            presenterSettings.advancePolicy.semanticMatching
          }
          state={semanticDebugState}
        />
      ) : null}
      {showSemanticCueDebugPanel ? (
        <SemanticCueDebugPanel
          capabilityEvents={semanticCapabilityEvents}
          events={semanticCueDebugEvents}
          onCopyJson={copySemanticCueDebugJson}
          onExportJson={exportSemanticCueDebugJson}
        />
      ) : null}
    </main>
  );
}

function getSemanticDebugPanelStorage(): Pick<
  Storage,
  "getItem" | "setItem"
> | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function writeSemanticDebugPanelPreference(enabled: boolean) {
  try {
    getSemanticDebugPanelStorage()?.setItem(
      semanticSpeechDebugPanelStorageKey,
      enabled ? "1" : "0",
    );
  } catch {
    // The shortcut still works for the current page when storage is blocked.
  }
}

type RehearsalCompletionSummary = {
  comparisonLabel: string;
  coverageLabel: string;
  coveragePercent: number;
  durationLabel: string;
  durationSeconds: number;
  hasSpeechTrackingData: boolean;
  missedKeywordRows: Array<{
    key: string;
    label: string;
    slideLabel: string;
  }>;
  missedKeywordCount: number;
  missedKeywordCountLabel: string;
  missedKeywordEmptyLabel: string;
  targetDeltaLabel: string;
  targetLabel: string;
  targetSeconds: number;
};

function RehearsalTeleprompter(props: {
  countdownMs: number;
  focusScopeId: string;
  nowMs: number;
  onCancel: () => void;
  rows: RehearsalPrompterRows;
  scriptProgressPercent: number;
  state: AdvanceControllerState;
}) {
  const countdownSeconds = getAutoAdvanceCountdownSeconds(
    props.state,
    props.countdownMs,
    props.nowMs,
  );

  return (
    <RehearsalScriptTeleprompter
      focusScopeId={props.focusScopeId}
      progressPercent={props.scriptProgressPercent}
      rows={props.rows.items.map((row) => ({
        id: row.sentenceId,
        isFocusTarget: row.isFocusTarget,
        status: row.status,
        text: row.text,
      }))}
    >
      {countdownSeconds !== null ? (
        <div className="rehearsal-auto-advance-card" role="status">
          <strong>{countdownSeconds}</strong>
          <span>다음으로 자동 전환</span>
          <button type="button" onClick={props.onCancel}>
            취소
          </button>
        </div>
      ) : props.state.status === "blocked-by-builds" ? (
        <div
          className="rehearsal-auto-advance-card rehearsal-auto-advance-card-muted"
          role="status"
        >
          <strong>{props.state.remainingTriggerSteps}</strong>
          <span>빌드가 남아 있어요</span>
        </div>
      ) : props.state.status === "finish-suggested" ? (
        <div
          className="rehearsal-auto-advance-card rehearsal-auto-advance-card-muted"
          role="status"
        >
          <CheckCircle2 size={22} />
          <span>발표 종료 준비됨</span>
        </div>
      ) : null}
    </RehearsalScriptTeleprompter>
  );
}

function buildRehearsalCompletionSummary(options: {
  deck: Deck | null;
  elapsedSeconds: number;
  meta: RehearsalRunMeta | null;
  previousSummary: RehearsalPracticeSummary | null;
  snapshot: SpeechTrackerSnapshot;
  targetSeconds: number;
}): RehearsalCompletionSummary {
  const targetSeconds =
    options.targetSeconds > 0
      ? options.targetSeconds
      : getTargetDurationSeconds(options.deck);
  const elapsedSeconds =
    options.elapsedSeconds > 0 ? options.elapsedSeconds : targetSeconds;
  const missedKeywordRows = buildLocalMissedKeywordRows(
    options.deck,
    options.meta,
  );
  const hasSpeechTrackingData = Boolean(options.meta);
  const coveragePercent =
    hasSpeechTrackingData && options.snapshot.matchableSentenceCount > 0
      ? Math.round(options.snapshot.effectiveCoverage * 100)
      : hasSpeechTrackingData && missedKeywordRows.length > 0
        ? 0
        : hasSpeechTrackingData
          ? 100
          : 0;
  const missedKeywordCount = options.meta?.missedKeywords.length ?? 0;

  return {
    comparisonLabel: buildRehearsalComparisonLabel(
      elapsedSeconds,
      targetSeconds,
      options.previousSummary,
    ),
    coverageLabel: hasSpeechTrackingData
      ? `${clamp(coveragePercent, 0, 100)}%`
      : "측정 안 됨",
    coveragePercent: clamp(coveragePercent, 0, 100),
    durationLabel: formatClock(elapsedSeconds),
    durationSeconds: elapsedSeconds,
    hasSpeechTrackingData,
    missedKeywordRows,
    missedKeywordCount,
    missedKeywordCountLabel: hasSpeechTrackingData
      ? String(missedKeywordCount)
      : "-",
    missedKeywordEmptyLabel: hasSpeechTrackingData
      ? "놓친 핵심 항목이 없습니다."
      : "음성 추적 데이터가 없습니다.",
    targetDeltaLabel: formatTargetDeltaLabel(targetSeconds - elapsedSeconds),
    targetLabel: formatClock(targetSeconds),
    targetSeconds,
  };
}

function buildLocalMissedKeywordRows(
  deck: Deck | null,
  meta: RehearsalRunMeta | null,
): RehearsalCompletionSummary["missedKeywordRows"] {
  if (!deck || !meta) {
    return [];
  }

  const slidesById = new Map(
    deck.slides.map((slide) => [slide.slideId, slide]),
  );
  return meta.missedKeywords.slice(0, 2).map((missedKeyword) => {
    const slide = slidesById.get(missedKeyword.slideId);
    const keyword = slide?.keywords?.find(
      (candidate) => candidate.keywordId === missedKeyword.keywordId,
    );

    return {
      key: `${missedKeyword.slideId}-${missedKeyword.keywordId}`,
      label: keyword?.text ?? missedKeyword.keywordId,
      slideLabel: slide ? `슬라이드 ${slide.order}` : missedKeyword.slideId,
    };
  });
}

function createRehearsalPracticeSummary(
  deck: Deck,
  summary: RehearsalCompletionSummary,
): RehearsalPracticeSummary {
  return {
    completedAt: new Date().toISOString(),
    coveragePercent: summary.coveragePercent,
    deckId: deck.deckId,
    durationSeconds: summary.durationSeconds,
    missedKeywordCount: summary.missedKeywordCount,
    projectId: deck.projectId,
    targetSeconds: summary.targetSeconds,
  };
}

function buildRehearsalPreflightBanner(
  deck: Deck,
  previousSummary: RehearsalPracticeSummary | null,
) {
  const targetLabel = formatDuration(getTargetDurationSeconds(deck));
  if (!previousSummary) {
    return `이번 목표는 ${targetLabel}입니다. 슬라이드와 음성 트리거를 확인하고 시작하세요.`;
  }

  return `지난 리허설은 ${formatDuration(
    previousSummary.durationSeconds,
  )}였습니다. 이번엔 ${targetLabel} 목표로 가볼까요?`;
}

function buildRehearsalComparisonLabel(
  elapsedSeconds: number,
  targetSeconds: number,
  previousSummary: RehearsalPracticeSummary | null,
) {
  if (previousSummary) {
    const previousDelta = previousSummary.durationSeconds - elapsedSeconds;
    if (previousDelta > 0) {
      return `지난번보다 ${formatDuration(previousDelta)} 빨랐어요`;
    }
    if (previousDelta < 0) {
      return `지난번보다 ${formatDuration(Math.abs(previousDelta))} 늦었어요`;
    }
    return "지난번과 같은 시간이에요";
  }

  const targetDelta = targetSeconds - elapsedSeconds;
  if (targetDelta > 0) {
    return `목표보다 ${formatDuration(targetDelta)} 빨랐어요`;
  }
  if (targetDelta < 0) {
    return `목표보다 ${formatDuration(Math.abs(targetDelta))} 초과했어요`;
  }
  return "목표 시간에 맞췄어요";
}

function readRehearsalPracticeSummary(
  projectId: string,
  deckId: string,
  storage: Pick<Storage, "getItem"> | null = readBrowserLocalStorage(),
): RehearsalPracticeSummary | null {
  try {
    const raw = storage?.getItem(
      getRehearsalPracticeSummaryStorageKey(projectId, deckId),
    );
    if (!raw) {
      return null;
    }

    return parseRehearsalPracticeSummary(JSON.parse(raw), projectId, deckId);
  } catch {
    return null;
  }
}

function writeRehearsalPracticeSummary(
  summary: RehearsalPracticeSummary,
  storage: Pick<Storage, "setItem"> | null = readBrowserLocalStorage(),
) {
  try {
    storage?.setItem(
      getRehearsalPracticeSummaryStorageKey(summary.projectId, summary.deckId),
      JSON.stringify(summary),
    );
  } catch {
    // Summary persistence is best-effort; the rehearsal flow must keep working.
  }
}

function getRehearsalPracticeSummaryStorageKey(
  projectId: string,
  deckId: string,
) {
  return `${rehearsalPracticeSummaryStoragePrefix}:${projectId}:${deckId}`;
}

function parseRehearsalPracticeSummary(
  value: unknown,
  projectId: string,
  deckId: string,
): RehearsalPracticeSummary | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<RehearsalPracticeSummary>;
  if (
    candidate.projectId !== projectId ||
    candidate.deckId !== deckId ||
    typeof candidate.completedAt !== "string" ||
    typeof candidate.durationSeconds !== "number" ||
    typeof candidate.targetSeconds !== "number" ||
    typeof candidate.coveragePercent !== "number" ||
    typeof candidate.missedKeywordCount !== "number"
  ) {
    return null;
  }

  return {
    completedAt: candidate.completedAt,
    coveragePercent: clamp(Math.round(candidate.coveragePercent), 0, 100),
    deckId,
    durationSeconds: Math.max(0, Math.round(candidate.durationSeconds)),
    missedKeywordCount: Math.max(0, Math.round(candidate.missedKeywordCount)),
    projectId,
    targetSeconds: Math.max(0, Math.round(candidate.targetSeconds)),
  };
}

function formatTargetDeltaLabel(deltaSeconds: number) {
  const absDelta = Math.abs(deltaSeconds);
  if (deltaSeconds >= 0) {
    return `${formatDuration(absDelta)} 여유`;
  }

  return `${formatDuration(absDelta)} 초과`;
}

function getTargetDurationSeconds(deck: Deck | null) {
  return deck ? getRehearsalDeckTargetSeconds(deck) : 0;
}

function formatDuration(totalSeconds: number) {
  const boundedSeconds = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(boundedSeconds / 60);
  const seconds = Math.floor(boundedSeconds % 60)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function getAutoAdvanceCountdownSeconds(
  state: AdvanceControllerState,
  countdownMs: number,
  nowMs: number,
) {
  if (state.status !== "countdown" || state.countdownStartedAtMs === null) {
    return null;
  }

  const remainingMs = Math.max(
    countdownMs - (nowMs - state.countdownStartedAtMs),
    0,
  );
  return Math.max(1, Math.ceil(remainingMs / 1000));
}

function getChecklistKeywords(slide: Slide | null): Keyword[] {
  return slide?.keywords ?? [];
}

function createEmptySpeechTrackerSnapshot(options: {
  slideId: string;
  matchableSentenceCount: number;
}): SpeechTrackerSnapshot {
  return {
    slideId: options.slideId,
    coveredSentenceIds: [],
    coveredSentenceMatchKinds: {},
    matchableSentenceCount: options.matchableSentenceCount,
    sentenceCoverage: 0,
    wordCoverage: 0,
    effectiveCoverage: 0,
    finalSentenceSpoken: false,
    hitKeywordIds: [],
    provisionalMissingKeywordIds: [],
  };
}

function getNearbySlides(deck: Deck, currentSlideIndex: number) {
  return deck.slides.filter(
    (_slide, index) =>
      index !== currentSlideIndex && Math.abs(index - currentSlideIndex) <= 2,
  );
}

function isEmphasisCommand(
  candidate: RehearsalCommandCandidate | null,
): candidate is RehearsalCommandCandidate & { cue: "emphasis" } {
  return candidate?.action === "animation-cue" && candidate.cue === "emphasis";
}

function isAdvanceSlideCommand(
  candidate: RehearsalCommandCandidate | null,
): candidate is RehearsalCommandCandidate & { action: "advance-slide" } {
  return candidate?.action === "advance-slide";
}

function getSlideTargetSeconds(deck: Deck, slide: Slide) {
  if (slide.estimatedSeconds) {
    return slide.estimatedSeconds;
  }

  return Math.max(
    1,
    Math.round((deck.targetDurationMinutes * 60) / deck.slides.length),
  );
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

function usePresenterStageScale(deck: Deck | null) {
  const [presenterStageElement, setPresenterStageElement] =
    useState<HTMLDivElement | null>(null);
  const [presenterScale, setPresenterScale] = useState<number | null>(null);
  const presenterStageRef = useCallback((node: HTMLDivElement | null) => {
    setPresenterStageElement(node);
  }, []);

  useLayoutEffect(() => {
    const stage = presenterStageElement;
    if (!stage || !deck) {
      setPresenterScale(null);
      return;
    }

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
          current === null || Math.abs(current - nextScale) > 0.001
            ? nextScale
            : current,
        );
      }
    };
    updateScale();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateScale);
      return () => {
        window.removeEventListener("resize", updateScale);
      };
    }

    const observer = new ResizeObserver(updateScale);
    observer.observe(stage);
    window.addEventListener("resize", updateScale);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateScale);
    };
  }, [deck, presenterStageElement]);

  return { presenterScale, presenterStageRef };
}

function parseClockInput(value: string): number | null {
  const normalizedValue = value.trim();
  const match = normalizedValue.match(/^(\d{1,3})(?::([0-5]?\d))?$/);

  if (!match) {
    return null;
  }

  const minutes = Number(match[1]);
  const seconds = Number(match[2] ?? 0);

  if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) {
    return null;
  }

  return minutes * 60 + seconds;
}

function navigateToPath(path: string) {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function toMicrophoneErrorMessage(cause: unknown) {
  if (cause instanceof DOMException && cause.name === "NotAllowedError") {
    return "마이크 접근 권한이 거부되었습니다.";
  }

  if (cause instanceof DOMException && cause.name === "NotFoundError") {
    return "사용 가능한 마이크를 찾지 못했습니다.";
  }

  return "마이크를 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.";
}

function toErrorMessage(cause: unknown) {
  return cause instanceof Error ? cause.message : "요청을 처리하지 못했습니다.";
}
