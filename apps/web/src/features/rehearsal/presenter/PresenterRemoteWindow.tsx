import type { Deck } from "@orbit/shared";
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  ListChecks,
  Maximize2,
  Monitor,
  PauseCircle,
  PlayCircle,
  Power,
  RotateCcw,
  Timer,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityPresenterPanel,
  ActivitySlidePreview,
} from "../../activity-slides";
import {
  SemanticSpeechDebugPanel,
  shouldShowSemanticSpeechDebugPanel,
} from "../panel/SemanticSpeechDebugPanel";
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
import { PresenterScriptList, type PresenterScriptListRow } from "./PresenterScriptList";
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

  const requestRemoteFullscreen = () => {
    const request = document.documentElement.requestFullscreen?.();
    if (request) {
      void request.catch(() => undefined);
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
  const { nextSlide, slide, slideNumber } = slideContext;
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
  const currentCueText =
    currentSentenceIndex >= 0
      ? noteSentences[currentSentenceIndex]
      : "현재 큐가 없습니다.";
  const keywordRows = useMemo(
    () => getPresenterRemoteKeywordRows(slide, state.stepIndex),
    [slide, state.stepIndex],
  );
  const remainingTime = formatPresenterRemoteDuration(
    getEstimatedRemainingSeconds(slide, noteSentences.length, state.stepIndex),
  );
  const timing = getPresenterRemoteTimingState(deck, slide, state);
  const isTimerActive = timing.isRunning || timing.isLiveSttActive;
  const timerPrimaryAction = isTimerActive ? "timer-pause" : "timer-start";
  const timerPrimaryLabel = timing.isPaused
    ? "다시 시작"
    : isTimerActive
      ? "일시정지"
      : "시작";
  const timerProgressPercent = getPresenterRemoteTimerProgressPercent(timing);
  const previewScale = getPresenterRemotePreviewScale(deck);
  const visibleSlides = getPresenterRemoteVisibleSlides(deck, state.slideIndex);
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
      <header className="presenter-remote-header">
        <span>
          <Monitor size={16} />
          발표자 제어
        </span>
        <strong>{deck.title}</strong>
        <span className="presenter-remote-connection">
          {channelError
            ? "채널 오류"
            : isOwnerConnected
              ? "팝업 연결됨"
              : "팝업 연결 대기"}
        </span>
      </header>
      {visibleCapabilityItems.map((item) => (
        <section
          aria-label="발표자 시스템 상태"
          className={`presenter-semantic-status presenter-semantic-status--${item.severity}`}
          key={item.key}
          tabIndex={0}
        >
          <AlertCircle aria-hidden="true" size={15} />
          <strong>{item.shortLabel}</strong>
          {hiddenCapabilityCount > 0 ? <span>+{hiddenCapabilityCount}</span> : null}
          <p>{item.detail}</p>
        </section>
      ))}
      {channelError ? (
        <section className="presenter-remote-status" role="status">
          {channelError}
        </section>
      ) : null}

      {slide?.kind === "activity" ? (
        <ActivityPresenterPanel
          deckId={deck.deckId}
          deckVersion={deck.version}
          projectId={deck.projectId}
          slide={slide}
        />
      ) : null}

      <section
        className="presenter-remote-stage"
        aria-label="발표자 모드 큐 보드"
      >
        <aside
          className="presenter-remote-preview-rail"
          aria-label="슬라이드 미리보기"
        >
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
          <nav
            className="presenter-remote-slide-list"
            aria-label="슬라이드 이동"
          >
            {visibleSlides.map(({ slide: candidate, index }) => (
              <button
                aria-current={index === state.slideIndex ? "true" : undefined}
                key={candidate.slideId}
                type="button"
                onClick={() =>
                  sendCommand({ action: "goto", slideIndex: index })
                }
              >
                <span>{index + 1}</span>
                {candidate.title || `Slide ${index + 1}`}
              </button>
            ))}
          </nav>
        </aside>

        <section className="presenter-remote-script" aria-label="발표자 대본">
          <div className="presenter-remote-section-heading">
            <span>대본</span>
            <strong>
              현재 문장 {cueProgressCurrent} / {cueProgressTotal}
            </strong>
          </div>
          <PresenterScriptList
            emptyLabel="대본 없음"
            rows={noteSentences.map((sentence, index): PresenterScriptListRow => {
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
                content: sentence,
                id: sentenceId,
                label:
                  committed
                    ? "체크됨"
                    : matchKind === "paraphrased"
                    ? "의미 전달"
                    : undefined,
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
              };
            })}
          />
        </section>

        <aside
          className="presenter-remote-cue-sidebar"
          aria-label="키워드 및 큐 상태"
        >
          <section
            className="presenter-remote-timer-panel"
            aria-label="타이머 및 음성인식 제어"
          >
            <div className="presenter-remote-section-heading">
              <span>타이머</span>
              <strong>
                {timing.isPaused
                  ? "일시정지됨"
                  : timing.isLiveSttActive
                    ? "음성인식 중"
                    : "음성인식 대기"}
              </strong>
            </div>
            <strong
              className="presenter-remote-timer-display"
              aria-live="polite"
            >
              {formatPresenterRemoteDuration(timing.displayedSeconds)}
            </strong>
            <div className="presenter-remote-timer-progress" aria-hidden="true">
              <span style={{ width: `${timerProgressPercent}%` }} />
            </div>
            <div className="presenter-remote-timer-meta">
              <span>
                슬라이드 경과
                <strong>
                  {formatPresenterRemoteDuration(
                    timing.currentSlideElapsedSeconds,
                  )}
                </strong>
              </span>
              <span>
                슬라이드 목표
                <strong>
                  {formatPresenterRemoteDuration(
                    timing.currentSlideTargetSeconds,
                  )}
                </strong>
              </span>
            </div>
            <div className="presenter-remote-timer-actions">
              <button
                type="button"
                aria-label={`리허설 ${timerPrimaryLabel}`}
                onClick={() => sendCommand({ action: timerPrimaryAction })}
              >
                {isTimerActive ? (
                  <PauseCircle size={16} />
                ) : (
                  <PlayCircle size={16} />
                )}
                {timerPrimaryLabel}
              </button>
              <button
                type="button"
                onClick={() => sendCommand({ action: "timer-reset" })}
              >
                <RotateCcw size={15} />
                리셋
              </button>
            </div>
          </section>

          <section
            className="presenter-remote-cue-panel"
            aria-label="핵심 키워드"
          >
            <div className="presenter-remote-section-heading">
              <span>핵심 키워드</span>
              <strong>
                <ListChecks size={15} />
                {
                  keywordRows.filter((keyword) => keyword.status === "done")
                    .length
                }
                /{keywordRows.length}
              </strong>
            </div>
            <ul className="presenter-remote-keyword-list">
              {keywordRows.map((keyword) => (
                <li
                  className={`presenter-remote-keyword-row presenter-remote-keyword-row--${keyword.status}`}
                  key={keyword.keywordId}
                >
                  {keyword.status === "done" ? (
                    <CheckCircle2 aria-hidden="true" size={17} />
                  ) : (
                    <Circle aria-hidden="true" size={17} />
                  )}
                  <span>{keyword.text}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="presenter-remote-cue-panel" aria-label="현재 큐">
            <div className="presenter-remote-section-heading">
              <span>현재 큐</span>
              <strong>
                Step {Math.max(0, state.stepIndex) + 1} / {cueProgressTotal}
              </strong>
            </div>
            <div className="presenter-remote-current-cue">
              <ChevronRight size={20} />
              <p>{currentCueText}</p>
            </div>
          </section>

          <section
            className="presenter-remote-timing"
            aria-label="발표 시간 상태"
          >
            <div>
              <Timer size={16} />
              <span>남은 시간</span>
              <strong>{remainingTime}</strong>
            </div>
            <div>
              <Monitor size={16} />
              <span>현재 슬라이드</span>
              <strong>
                {slideNumber} / {deck.slides.length}
              </strong>
            </div>
          </section>
        </aside>
      </section>

      <AudienceOutputControls
        connected={isAudienceSurfaceConnected}
        error={audienceScreenShare.error}
        onReturnToSlide={audienceScreenShare.returnToSlide}
        onShowBlack={audienceScreenShare.showBlack}
        onStartMonitor={audienceScreenShare.startMonitor}
        onStartTabOrWindow={audienceScreenShare.startTabOrWindow}
        outputMode={state.audienceOutputMode}
        status={audienceScreenShare.status}
      />

      <div className="presenter-remote-command-dock" aria-label="발표 제어">
        <button
          className="presenter-remote-command"
          type="button"
          onClick={() => sendCommand({ action: "prev" })}
        >
          <ChevronLeft size={17} />
          이전
        </button>
        <button
          className="presenter-remote-command presenter-remote-command--primary"
          type="button"
          onClick={() => sendCommand({ action: "next-step" })}
        >
          다음
          <ChevronRight size={17} />
        </button>
        <button
          className="presenter-remote-command"
          type="button"
          onClick={requestRemoteFullscreen}
        >
          <Maximize2 size={17} />
          전체 화면
        </button>
        <button
          className="presenter-remote-command presenter-remote-command--danger"
          type="button"
          onClick={() => window.close()}
        >
          <Power size={17} />
          발표 종료
        </button>
      </div>
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
          {slideNumber ? `${slideNumber}`.padStart(2, "0") : "--"}
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
          <div className="presenter-remote-preview-empty">마지막 슬라이드</div>
        )}
      </div>
      <p>{slide?.title || (slide ? slide.slideId : "다음 슬라이드 없음")}</p>
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

function getPresenterRemoteTimerProgressPercent(
  timing: PresenterRemoteTimingState,
) {
  if (timing.mode === "timer") {
    if (timing.timerDurationSeconds <= 0) {
      return 0;
    }

    return Math.min(
      100,
      Math.max(0, (timing.elapsedSeconds / timing.timerDurationSeconds) * 100),
    );
  }

  if (timing.currentSlideTargetSeconds <= 0) {
    return 0;
  }

  return Math.min(
    100,
    Math.max(
      0,
      (timing.currentSlideElapsedSeconds / timing.currentSlideTargetSeconds) *
        100,
    ),
  );
}

function getPresenterRemoteVisibleSlides(
  deck: Deck,
  currentSlideIndex: number,
) {
  const start = Math.max(
    0,
    Math.min(currentSlideIndex - 2, deck.slides.length - 5),
  );
  return deck.slides.slice(start, start + 5).map((slide, offset) => ({
    index: start + offset,
    slide,
  }));
}

function getPresenterRemotePreviewScale(deck: Deck) {
  const maxPreviewWidth = 220;
  return Math.min(0.22, maxPreviewWidth / deck.canvas.width);
}

function getEstimatedRemainingSeconds(
  slide: PresenterRemoteSlide | undefined,
  sentenceCount: number,
  stepIndex: number,
) {
  const estimatedSeconds = slide?.estimatedSeconds ?? 60;
  const totalSteps = Math.max(sentenceCount, 1);
  const completedRatio =
    Math.min(Math.max(stepIndex, 0), totalSteps) / totalSteps;
  return Math.max(0, Math.round(estimatedSeconds * (1 - completedRatio)));
}

function formatPresenterRemoteDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}
