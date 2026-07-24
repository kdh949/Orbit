import type { Deck } from "@orbit/shared";
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  CircleSlash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityPresenterPanel,
  ActivitySlidePreview,
} from "../../activity-slides";
import {
  getPresenterTimingProgress,
  PresenterTimerCard,
  type PresenterTimingProgressItem,
} from "../../presenter-shell/PresenterScaffold";
import {
  SemanticSpeechDebugPanel,
  shouldShowSemanticSpeechDebugPanel,
} from "../panel/SemanticSpeechDebugPanel";
import {
  RehearsalPanelTopGrid,
} from "../panel/RehearsalPanel";
import { splitSpeakerNotesIntoSentences } from "../speech/phraseExtractor";
import {
  createPresenterCommandMessage,
  createPresenterRemoteHeartbeatMessage,
  createPresenterRemoteReadyMessage,
  getPresenterRemoteChannelName,
  matchesPresentationChannelIdentity,
  parsePresentationChannelMessage,
  type PresentationChannelIdentity,
  type PresentationChannelMessage,
  type PresenterRemoteCommand,
} from "./presentationChannel";
import type { PresenterSlideshowState } from "./presenterStateStore";
import { RehearsalScriptTeleprompter } from "./RehearsalScriptTeleprompter";
import { SlideshowRenderer } from "./SlideshowRenderer";
import { usePresenterKeyboard } from "./usePresenterKeyboard";
import { getPresenterAidPolicy } from "./presenterAidPolicy";
import { AudienceOutputControls } from "./AudienceOutputControls";
import { useAudienceScreenShare } from "./useAudienceScreenShare";
import type { AudienceStreamBridgeWindow } from "./audienceStreamBridge";

type ChannelLike = Pick<BroadcastChannel, "close" | "postMessage"> & {
  onmessage: ((event: MessageEvent) => void) | null;
};

type PendingAudienceOutputMode = {
  mode: PresenterSlideshowState["audienceOutputMode"];
  sentAt: number;
};

export type PresenterRemoteChannelFactory = (
  channelName: string,
) => ChannelLike;

export function scrollPresenterRemoteScriptRowIntoView(
  viewport: {
    getBoundingClientRect: () => { height: number; top: number };
    scrollTo: (options: ScrollToOptions) => void;
    scrollTop: number;
  },
  currentRow: {
    getBoundingClientRect: () => { height: number; top: number };
  },
  behavior: ScrollBehavior,
) {
  const viewportBounds = viewport.getBoundingClientRect();
  const currentRowBounds = currentRow.getBoundingClientRect();
  viewport.scrollTo({
    behavior,
    top: Math.max(
      0,
      viewport.scrollTop +
        currentRowBounds.top -
        viewportBounds.top -
        (viewportBounds.height - currentRowBounds.height) / 2,
    ),
  });
}

export function PresenterRemoteWindow(props: {
  channelFactory?: PresenterRemoteChannelFactory;
  deck: Deck;
  identity: PresentationChannelIdentity;
  initialState: PresenterSlideshowState;
}) {
  const {
    channelFactory = createBroadcastChannel,
    deck,
    identity,
    initialState,
  } = props;
  const [state, setState] = useState(initialState);
  const [channelError, setChannelError] = useState("");
  const [dismissedCapabilityKey, setDismissedCapabilityKey] = useState<
    string | null
  >(null);
  const [isOwnerConnected, setOwnerConnected] = useState(false);
  const channelRef = useRef<ChannelLike | null>(null);
  const commandRetryTimersRef = useRef<number[]>([]);
  const lastOwnerSeenAtRef = useRef<number | null>(null);
  const pendingAudienceOutputModeRef = useRef<PendingAudienceOutputMode | null>(
    null,
  );

  useEffect(() => {
    let channel: ChannelLike;
    try {
      channel = channelFactory(getPresenterRemoteChannelName(identity));
    } catch {
      setChannelError("발표자 제어 채널을 열 수 없습니다.");
      return;
    }

    channelRef.current = channel;
    channel.onmessage = (event) => {
      const message = parsePresentationChannelMessage(event.data);
      if (!message) {
        return;
      }
      if (!matchesPresentationChannelIdentity(message, identity)) {
        return;
      }

      lastOwnerSeenAtRef.current = Date.now();
      setOwnerConnected(true);
      setState((current) => {
        const reconciled = reconcilePresenterRemoteOutputMode({
          current,
          message,
          now: Date.now(),
          pending: pendingAudienceOutputModeRef.current,
        });
        pendingAudienceOutputModeRef.current = reconciled.pending;
        return reconciled.state;
      });
    };
    channel.postMessage(createPresenterRemoteReadyMessage(identity));
    const heartbeatTimer = window.setInterval(() => {
      channel.postMessage(createPresenterRemoteHeartbeatMessage(identity));
      const lastOwnerSeenAt = lastOwnerSeenAtRef.current;
      if (isPresenterRemoteOwnerStale(lastOwnerSeenAt, Date.now())) {
        setOwnerConnected(false);
      }
    }, 1000);

    return () => {
      window.clearInterval(heartbeatTimer);
      clearPresenterRemoteCommandRetryTimers(commandRetryTimersRef.current);
      channel.close();
      if (channelRef.current === channel) {
        channelRef.current = null;
      }
      lastOwnerSeenAtRef.current = null;
    };
  }, [channelFactory, identity]);

  const sendCommand = (command: PresenterRemoteCommand) => {
    clearPresenterRemoteCommandRetryTimers(commandRetryTimersRef.current);
    commandRetryTimersRef.current = [];

    for (const delayMs of getPresenterRemoteCommandDispatchDelays(command)) {
      if (delayMs === 0) {
        postPresenterRemoteCommand(channelRef.current, command, identity);
        continue;
      }

      const timerId = window.setTimeout(() => {
        postPresenterRemoteCommand(channelRef.current, command, identity);
      }, delayMs);
      commandRetryTimersRef.current.push(timerId);
    }
  };

  const updateAudienceOutputMode = (mode: PresenterSlideshowState["audienceOutputMode"]) => {
    pendingAudienceOutputModeRef.current = { mode, sentAt: Date.now() };
    setState((current) => ({ ...current, audienceOutputMode: mode }));
    sendCommand({ action: "set-audience-output", mode });
  };
  const isAudienceSurfaceConnected =
    isOwnerConnected &&
    !channelError &&
    typeof window !== "undefined" &&
    Boolean(window.opener && !window.opener.closed);
  const audienceScreenShare = useAudienceScreenShare({
    connected: isAudienceSurfaceConnected,
    getTargetWindow: () =>
      typeof window === "undefined"
        ? null
        : (window.opener as AudienceStreamBridgeWindow | null),
    identity,
    onOutputModeChange: updateAudienceOutputMode,
    outputMode: state.audienceOutputMode,
  });

  useEffect(() => {
    if (!isOwnerConnected || channelError) {
      audienceScreenShare.handlePeerUnavailable();
    }
  }, [channelError, isOwnerConnected]);

  usePresenterKeyboard({
    onNextStep: () => sendCommand({ action: "next-step" }),
    onPreviousSlide: () => sendCommand({ action: "prev" }),
  });

  const slideContext = useMemo(
    () => getPresenterRemoteSlideContext(deck, state),
    [deck, state],
  );
  const { nextSlide, previousSlide, slide, slideNumber } = slideContext;
  const notes = slide?.speakerNotes?.trim() || "발표자 노트가 없습니다.";
  const noteSentences = useMemo(
    () => splitPresenterRemoteNotes(notes),
    [notes],
  );
  const currentSentenceIndex = getPresenterRemoteCurrentSentenceIndex(
    noteSentences,
    state,
  );
  const nextSentenceIndex = getPresenterRemoteNextSentenceIndex(
    noteSentences,
    state,
    currentSentenceIndex,
  );
  const keywordRows = useMemo(
    () => getPresenterRemoteKeywordRows(slide, state.stepIndex),
    [slide, state.stepIndex],
  );
  const panelKeywords = useMemo(
    () => (slide?.keywords ?? []).slice(0, 5),
    [slide],
  );
  const hitKeywordIds = useMemo(
    () =>
      new Set(
        keywordRows
          .filter((keyword) => keyword.status === "done")
          .map((keyword) => keyword.keywordId),
      ),
    [keywordRows],
  );
  const timing = getPresenterRemoteTimingState(deck, slide, state);
  const isTimerActive = timing.isRunning || timing.isLiveSttActive;
  const timerPrimaryAction = isTimerActive ? "timer-pause" : "timer-start";
  const timerPrimaryLabel = timing.isPaused
    ? "다시 시작"
    : isTimerActive
      ? "일시정지"
      : "시작";
  const totalTimingProgress = getPresenterTimingProgress(
    timing.elapsedSeconds,
    timing.timerDurationSeconds,
  );
  const slideTimingProgress = getPresenterTimingProgress(
    timing.currentSlideElapsedSeconds,
    timing.currentSlideTargetSeconds,
  );
  const timerProgressItems: PresenterTimingProgressItem[] = [
    {
      currentLabel: `현재 ${formatPresenterRemoteDuration(timing.elapsedSeconds)}`,
      label: "총 발표 시간",
      percent: totalTimingProgress.percent,
      targetLabel: `예상 ${formatPresenterRemoteDuration(timing.timerDurationSeconds)}`,
      tone: totalTimingProgress.tone,
    },
    {
      currentLabel: `현재 ${formatPresenterRemoteDuration(timing.currentSlideElapsedSeconds)}`,
      label: "현재 슬라이드",
      percent: slideTimingProgress.percent,
      targetLabel: `예상 ${formatPresenterRemoteDuration(timing.currentSlideTargetSeconds)}`,
      tone: slideTimingProgress.tone,
    },
  ];
  const previewScale = getPresenterRemotePreviewScale(deck);
  const cueProgressCurrent =
    noteSentences.length > 0
      ? Math.min(currentSentenceIndex + 1, noteSentences.length)
      : 0;
  const cueProgressTotal = Math.max(noteSentences.length, 1);
  const shouldShowSemanticDebugPanel = shouldShowSemanticSpeechDebugPanel({
    isDevelopment: import.meta.env.DEV,
    storage: typeof window === "undefined" ? null : window.localStorage,
  });
  const capabilityItems = state.speech?.semanticCapabilityItems ?? [];
  const liveAidPolicy = getPresenterAidPolicy("live");
  const visibleCapabilityItems = [...capabilityItems]
    .sort(
      (left, right) =>
        getCapabilitySeverityRank(right.severity) -
        getCapabilitySeverityRank(left.severity),
    )
    .slice(0, liveAidPolicy.maxCapabilityItems);
  const hiddenCapabilityCount = Math.max(
    capabilityItems.length - visibleCapabilityItems.length,
    0,
  );

  return (
    <main className="presenter-remote-shell" aria-label="발표자 제어 창">
      {visibleCapabilityItems.map((item) =>
        item.key === dismissedCapabilityKey ? null : (
          <section
            aria-label="발표자 시스템 상태"
            className="presenter-display-message presenter-remote-capability-warning"
            key={item.key}
            role="status"
          >
            <AlertCircle aria-hidden="true" size={18} />
            <span>
              <strong>{item.shortLabel}:</strong> {item.detail}
              {hiddenCapabilityCount > 0 ? ` +${hiddenCapabilityCount}` : ""}
            </span>
            <button
              aria-label="음성 체크 알림 닫기"
              title="음성 체크 알림 닫기"
              type="button"
              onClick={() => setDismissedCapabilityKey(item.key)}
            >
              <X aria-hidden="true" size={14} />
            </button>
          </section>
        ),
      )}
      {channelError ? (
        <section className="presenter-remote-status" role="status">
          {channelError}
        </section>
      ) : null}

      <AudienceOutputControls
        collapsible
        connected={isAudienceSurfaceConnected}
        error={audienceScreenShare.error}
        onEndPresentation={() => {
          if (!window.confirm("발표를 종료할까요?")) {
            return;
          }
          sendCommand({ action: "finish" });
          window.close();
        }}
        onReturnToSlide={audienceScreenShare.returnToSlide}
        onShowBlack={audienceScreenShare.showBlack}
        onStartMonitor={audienceScreenShare.startMonitor}
        onStartTabOrWindow={audienceScreenShare.startTabOrWindow}
        outputMode={state.audienceOutputMode}
        status={audienceScreenShare.status}
      />

      <section
        className="presenter-remote-stage"
        aria-label="발표자 모드 큐 보드"
      >
        <aside
          className="presenter-remote-preview-rail"
          aria-label="슬라이드 미리보기"
        >
          <button
            aria-label="이전 슬라이드"
            className="presenter-remote-preview-control"
            disabled={state.slideIndex <= 0}
            type="button"
            onClick={() => sendCommand({ action: "prev" })}
          >
            <ChevronLeft aria-hidden="true" size={20} />
            <span>이전</span>
          </button>
          <PresenterSlidePreview
            deck={deck}
            label="이전 슬라이드"
            previewScale={previewScale}
            slide={previousSlide}
            slideNumber={previousSlide ? slideNumber - 1 : null}
            stepIndex={0}
          />
          <PresenterSlidePreview
            deck={deck}
            label="현재 슬라이드"
            previewScale={previewScale}
            slide={slide}
            slideNumber={slideNumber}
            stepIndex={state.stepIndex}
          />
          <PresenterSlidePreview
            deck={deck}
            label="다음 슬라이드"
            previewScale={previewScale}
            slide={nextSlide}
            slideNumber={nextSlide ? slideNumber + 1 : null}
            stepIndex={0}
          />
          <button
            aria-label="다음 슬라이드"
            className="presenter-remote-preview-control"
            disabled={!nextSlide}
            type="button"
            onClick={() => sendCommand({ action: "next-step" })}
          >
            <span>다음</span>
            <ChevronRight aria-hidden="true" size={20} />
          </button>
        </aside>

        <section className="presenter-remote-script" aria-label="발표자 대본">
          <RehearsalScriptTeleprompter
            focusScopeId={slide?.slideId ?? "presenter-remote"}
            progressPercent={Math.round(
              (cueProgressCurrent / cueProgressTotal) * 100,
            )}
            rows={noteSentences.map((sentence, index) => {
              const sentenceId = getPresenterRemoteSentenceId(index);
              const covered = Boolean(
                state.speech?.coveredSentenceIds.includes(sentenceId),
              );
              const committed = Boolean(
                state.speech?.snapshot?.prompterProgress?.committedSentenceIds.includes(
                  sentenceId,
                ) ?? covered,
              );
              const matchKind =
                state.speech?.coveredSentenceMatchKinds[sentenceId];
              return {
                id: sentenceId,
                isFocusTarget: index === currentSentenceIndex,
                status:
                  index === currentSentenceIndex
                    ? "current"
                    : committed
                      ? matchKind === "paraphrased"
                        ? "paraphrased"
                        : "covered"
                      : index === nextSentenceIndex
                        ? "next"
                        : "pending",
                text: sentence,
              };
            })}
          />
        </section>

        <aside
          className="presenter-remote-cue-sidebar"
          aria-label="키워드 및 큐 상태"
        >
          <PresenterTimerCard
            ariaLabel="리허설 타이머"
            currentTimeLabel="경과 발표 시간"
            meterPercent={0}
            onPrimaryAction={() =>
              sendCommand({ action: timerPrimaryAction })
            }
            onReset={() => sendCommand({ action: "timer-reset" })}
            onTimeInputBlur={() => undefined}
            onTimeInputChange={() => undefined}
            onTimeInputFocus={() => undefined}
            primaryActionAriaLabel={`리허설 ${timerPrimaryLabel}`}
            primaryActionRunning={isTimerActive}
            progressItems={timerProgressItems}
            progressPercent={totalTimingProgress.percent}
            resetAriaLabel="스톱워치 초기화"
            timeInputValue={formatPresenterRemoteDuration(
              timing.displayedSeconds,
            )}
            timeMetaLeft=""
            timeMetaRight=""
            timeReadOnly
            title="발표 스톱워치"
          />

          <section
            className="rehearsal-panel presenter-remote-progress-panel"
            aria-label="발표 진행 패널"
          >
            <RehearsalPanelTopGrid
              hitKeywordIds={hitKeywordIds}
              keywords={panelKeywords}
              provisionalMissingKeywordIds={new Set()}
            />
          </section>
          {slide?.kind === "activity" ? (
            <ActivityPresenterPanel
              deckId={deck.deckId}
              deckVersion={deck.version}
              projectId={deck.projectId}
              slide={slide}
            />
          ) : null}
        </aside>
      </section>
      {state.speech && shouldShowSemanticDebugPanel ? (
        <SemanticSpeechDebugPanel
          semanticMatchingEnabled={state.speech.semanticMatchingEnabled}
          state={state.speech.semanticDebug}
        />
      ) : null}
    </main>
  );
}

function getCapabilitySeverityRank(severity: "info" | "warning" | "error") {
  switch (severity) {
    case "error":
      return 2;
    case "warning":
      return 1;
    case "info":
      return 0;
  }
}

export function applyPresenterRemoteMessage(
  current: PresenterSlideshowState,
  message: PresentationChannelMessage,
): PresenterSlideshowState {
  if (
    message.type === "presenter-remote-snapshot" ||
    message.type === "presenter-remote-state" ||
    message.type === "presenter-snapshot" ||
    message.type === "presenter-state"
  ) {
    return message.state;
  }

  return current;
}

export function isPresenterRemoteOwnerStale(
  lastOwnerSeenAt: number | null,
  now: number,
  staleAfterMs = 5000,
) {
  return lastOwnerSeenAt !== null && now - lastOwnerSeenAt > staleAfterMs;
}

export function reconcilePresenterRemoteOutputMode(args: {
  current: PresenterSlideshowState;
  message: PresentationChannelMessage;
  now: number;
  pending: PendingAudienceOutputMode | null;
}): {
  pending: PendingAudienceOutputMode | null;
  state: PresenterSlideshowState;
} {
  const next = applyPresenterRemoteMessage(args.current, args.message);
  if (!args.pending) return { pending: null, state: next };
  if (next.audienceOutputMode === args.pending.mode) {
    return { pending: null, state: next };
  }
  if (args.now - args.pending.sentAt <= 2000) {
    return {
      pending: args.pending,
      state: {
        ...next,
        audienceOutputMode: args.current.audienceOutputMode,
      },
    };
  }
  return { pending: null, state: next };
}

function createBroadcastChannel(channelName: string): ChannelLike {
  return new BroadcastChannel(channelName);
}

function clearPresenterRemoteCommandRetryTimers(timerIds: number[]) {
  for (const timerId of timerIds) {
    window.clearTimeout(timerId);
  }
  timerIds.length = 0;
}

export function getPresenterRemoteCommandDispatchDelays(
  command: PresenterRemoteCommand,
) {
  return command.action === "timer-pause" || command.action === "timer-reset"
    ? [0, 150, 500]
    : [0];
}

function postPresenterRemoteCommand(
  channel: ChannelLike | null,
  command: PresenterRemoteCommand,
  identity: PresentationChannelIdentity,
) {
  channel?.postMessage(createPresenterCommandMessage({ command, identity }));
}

type PresenterRemoteSlide = Deck["slides"][number];

type PresenterRemoteKeywordRow = {
  keywordId: string;
  status: "active" | "done" | "pending";
  text: string;
};

type PresenterRemoteTimingState = NonNullable<
  PresenterSlideshowState["timing"]
>;

function PresenterSlidePreview(props: {
  deck: Deck;
  label: string;
  previewScale: number;
  slide: PresenterRemoteSlide | undefined;
  slideNumber: number | null;
  stepIndex: number;
}) {
  const { deck, label, previewScale, slide, slideNumber, stepIndex } = props;

  return (
    <section className="presenter-remote-preview" aria-label={label}>
      <div className="presenter-remote-preview-title">
        <span>{label}</span>
        <strong>
          {slideNumber ? `${slideNumber}`.padStart(2, "0") : "없음"}
        </strong>
      </div>
      <div className="presenter-remote-preview-frame">
        {slide ? (
          slide.kind === "activity" ? (
            <ActivitySlidePreview
              role="presenter"
              slide={slide}
              theme={deck.theme}
            />
          ) : (
            <SlideshowRenderer
              deck={deck}
              playInitialEntryAnimations={false}
              renderMode="presenter"
              scale={previewScale}
              slideId={slide.slideId}
              stepIndex={stepIndex}
            />
          )
        ) : (
          <div className="presenter-remote-preview-empty" aria-label="마지막 슬라이드">
            <CircleSlash2 aria-hidden="true" />
          </div>
        )}
      </div>
      {slide ? <p>{slide.title || slide.slideId}</p> : null}
    </section>
  );
}

export function getPresenterRemoteSlideContext(
  deck: Deck,
  state: PresenterSlideshowState,
) {
  const slide =
    deck.slides[state.slideIndex] ??
    deck.slides.find((candidate) => candidate.slideId === state.slideId) ??
    deck.slides[0];
  const slideIndex = slide
    ? deck.slides.findIndex((candidate) => candidate.slideId === slide.slideId)
    : 0;
  const normalizedSlideIndex = slideIndex >= 0 ? slideIndex : 0;

  return {
    nextSlide: deck.slides[normalizedSlideIndex + 1],
    previousSlide: deck.slides[normalizedSlideIndex - 1],
    slide,
    slideNumber: deck.slides.length > 0 ? normalizedSlideIndex + 1 : 0,
  };
}

export function splitPresenterRemoteNotes(notes: string) {
  const sentences = splitSpeakerNotesIntoSentences(notes);
  return sentences.length > 0 ? sentences : [notes.trim()].filter(Boolean);
}

export function getPresenterRemoteCurrentSentenceIndex(
  sentences: readonly string[],
  state: PresenterSlideshowState,
) {
  if (sentences.length === 0) {
    return -1;
  }

  const prompterProgress = state.speech?.snapshot?.prompterProgress;
  if (prompterProgress) {
    if (prompterProgress.currentSentenceId) {
      const trackedSentenceIndex = sentences.findIndex(
        (_sentence, index) =>
          getPresenterRemoteSentenceId(index) ===
          prompterProgress.currentSentenceId,
      );
      if (trackedSentenceIndex >= 0) {
        const shouldShowLeadingDisplaySentence =
          trackedSentenceIndex > 0 &&
          !prompterProgress.hasCurrentLexicalEvidence &&
          prompterProgress.candidateSentenceId === null &&
          prompterProgress.committedSentenceIds.length === 0;
        return shouldShowLeadingDisplaySentence ? 0 : trackedSentenceIndex;
      }
    }

    if (prompterProgress.finalSentenceCommitted) {
      return sentences.length - 1;
    }

    const committedSet = new Set(prompterProgress.committedSentenceIds);
    const nextUncommittedIndex = sentences.findIndex(
      (_sentence, index) =>
        !committedSet.has(getPresenterRemoteSentenceId(index)),
    );
    return nextUncommittedIndex >= 0
      ? nextUncommittedIndex
      : sentences.length - 1;
  }

  const coveredSentenceIds = state.speech?.coveredSentenceIds;
  if (!coveredSentenceIds) {
    return Math.min(Math.max(state.stepIndex, 0), sentences.length - 1);
  }

  const coveredSet = new Set(coveredSentenceIds);
  const nextUncoveredIndex = sentences.findIndex(
    (_sentence, index) => !coveredSet.has(getPresenterRemoteSentenceId(index)),
  );
  if (nextUncoveredIndex >= 0) {
    return nextUncoveredIndex;
  }

  return sentences.length - 1;
}

export function getPresenterRemoteNextSentenceIndex(
  sentences: readonly string[],
  state: PresenterSlideshowState,
  currentSentenceIndex: number,
) {
  if (currentSentenceIndex < 0) {
    return -1;
  }

  const prompterProgress = state.speech?.snapshot?.prompterProgress;
  if (prompterProgress) {
    if (prompterProgress.finalSentenceCommitted) {
      return -1;
    }

    const trackedSentenceIndex = prompterProgress.currentSentenceId
      ? sentences.findIndex(
          (_sentence, index) =>
            getPresenterRemoteSentenceId(index) ===
            prompterProgress.currentSentenceId,
        )
      : -1;
    if (trackedSentenceIndex > currentSentenceIndex) {
      return trackedSentenceIndex;
    }

    const committedSet = new Set(prompterProgress.committedSentenceIds);
    return sentences.findIndex(
      (_sentence, index) =>
        index > currentSentenceIndex &&
        !committedSet.has(getPresenterRemoteSentenceId(index)),
    );
  }

  const coveredSet = new Set(state.speech?.coveredSentenceIds ?? []);
  return sentences.findIndex(
    (_sentence, index) =>
      index > currentSentenceIndex &&
      !coveredSet.has(getPresenterRemoteSentenceId(index)),
  );
}

function getPresenterRemoteSentenceId(index: number) {
  return `sentence_${index + 1}`;
}

export function getPresenterRemoteKeywordRows(
  slide: PresenterRemoteSlide | undefined,
  stepIndex: number,
): PresenterRemoteKeywordRow[] {
  const keywords = slide?.keywords ?? [];

  if (keywords.length === 0) {
    return [
      {
        keywordId: "no-keywords",
        status: "pending",
        text: "등록된 키워드 없음",
      },
    ];
  }

  const activeIndex = Math.min(Math.max(stepIndex, 0), keywords.length - 1);

  return keywords.slice(0, 5).map((keyword, index) => ({
    keywordId: keyword.keywordId,
    status:
      index < activeIndex
        ? "done"
        : index === activeIndex
          ? "active"
          : "pending",
    text: keyword.text,
  }));
}

export function getPresenterRemoteTimingState(
  deck: Deck,
  slide: PresenterRemoteSlide | undefined,
  state: PresenterSlideshowState,
): PresenterRemoteTimingState {
  if (state.timing) {
    return state.timing;
  }

  const currentSlideTargetSeconds =
    slide?.estimatedSeconds ??
    Math.max(
      0,
      Math.round(
        ((deck.targetDurationMinutes ?? 0) * 60) /
          Math.max(1, deck.slides.length),
      ),
    );

  return {
    canStartLiveStt: true,
    currentSlideElapsedSeconds: 0,
    currentSlideTargetSeconds,
    displayedSeconds: currentSlideTargetSeconds,
    elapsedSeconds: 0,
    isLiveSttActive: false,
    isPaused: false,
    isRunning: false,
    liveStatus: "idle",
    mode: "timer",
    timerDurationSeconds: Math.max(
      currentSlideTargetSeconds,
      Math.round((deck.targetDurationMinutes ?? 0) * 60),
    ),
  };
}

function getPresenterRemotePreviewScale(deck: Deck) {
  const maxPreviewWidth = 220;
  return Math.min(0.22, maxPreviewWidth / deck.canvas.width);
}

function formatPresenterRemoteDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}
