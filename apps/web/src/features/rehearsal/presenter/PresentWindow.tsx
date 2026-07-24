import type {
  Deck,
  PresentationCompanionAnnotationSnapshot,
  PresentationCompanionLaser,
} from "@orbit/shared";
import {
  IconArrowsMaximize,
  IconChevronLeft,
  IconChevronRight,
  IconX,
} from "@tabler/icons-react";
import type { ReactNode, Ref } from "react";
import { shouldAdvancePresentationFromClick } from "../../presenter-shell/presentationClickAdvance";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import orbitLogoWhite from "../../../assets/orbit-logo-white.png";
import "../../presentation/orbit-live-presentation.css";
import { AudienceOutputRenderer } from "./AudienceOutputRenderer";
import { AudienceAnnotationOverlay } from "./AudienceAnnotationOverlay";
import type { SurfaceSize } from "../../presenter-companion/surfaceGeometry";
import {
  applyAnnotationCommand,
  createAnnotationSnapshot,
  restoreAnnotationSurface,
} from "../../presenter-companion/annotationReducer";
import {
  registerAudienceStreamBridge,
  type AudienceStreamBridgeRegistration,
} from "./audienceStreamBridge";
import {
  slideWindowFullscreenRequestType,
  type SlideWindowFullscreenRequestMessage,
} from "./displayManager";
import type { PresenterSlideshowState } from "./presenterStateStore";
import {
  createSlideWindowHeartbeatMessage,
  createSlideWindowReadyMessage,
  createScreenShareEndedMessage,
  getPresentationChannelName,
  matchesPresentationChannelIdentity,
  parsePresentationChannelMessage,
  type PresentationChannelIdentity,
  type PresentationChannelMessage,
  type ScreenShareEndedReason,
} from "./presentationChannel";

export type PresentWindowSnapshot = {
  annotation?: PresentationCompanionAnnotationSnapshot | null;
  deck: Deck;
  state: PresenterSlideshowState;
  triggerAnimationIds: string[];
  laser?: PresentationCompanionLaser | null;
};

type ViewportSize = {
  height: number;
  width: number;
};

type ChannelLike = Pick<BroadcastChannel, "close" | "postMessage"> & {
  onmessage: ((event: MessageEvent) => void) | null;
};

export type PresentWindowChannelFactory = (channelName: string) => ChannelLike;

export function PresentWindow(props: {
  channelFactory?: PresentWindowChannelFactory;
  deckId: string;
  sessionId?: string;
}) {
  const { channelFactory = createBroadcastChannel, deckId, sessionId } = props;
  const identity = useMemo(
    () => (sessionId ? { deckId, sessionId } : null),
    [deckId, sessionId],
  );

  if (!identity) {
    return (
      <PresentWindowShell>
        <PresentWindowStatus
          title="발표자 화면에서 슬라이드 창을 열어주세요"
          message="이 주소는 발표자 화면이 만든 세션 정보가 있어야 슬라이드를 표시합니다."
        />
      </PresentWindowShell>
    );
  }

  return (
    <PresentWindowReceiver
      channelFactory={channelFactory}
      identity={identity}
    />
  );
}

export function PresentWindowReceiver(props: {
  channelFactory?: PresentWindowChannelFactory;
  controlOverlayMode?: "always" | "fallback" | "hidden";
  fullscreenMessage?: string;
  identity: PresentationChannelIdentity;
  initialSnapshot?: PresentWindowSnapshot | null;
  isFullscreen?: boolean;
  onExit?: () => void;
  onNextStep?: () => void;
  onPreviousSlide?: () => void;
  onReconnectPresenter?: (snapshot: PresentWindowSnapshot) => void;
}) {
  const {
    channelFactory = createBroadcastChannel,
    controlOverlayMode = "hidden",
    fullscreenMessage,
    identity,
    initialSnapshot = null,
    isFullscreen,
    onExit,
    onNextStep,
    onPreviousSlide,
    onReconnectPresenter,
  } = props;
  const [snapshot, setSnapshot] = useState<PresentWindowSnapshot | null>(
    initialSnapshot,
  );
  const [channelError, setChannelError] = useState("");
  const [isPresenterStale, setIsPresenterStale] = useState(false);
  const [audienceStream, setAudienceStream] = useState<MediaStream | null>(null);
  const channelRef = useRef<ChannelLike | null>(null);
  const streamBridgeRef = useRef<AudienceStreamBridgeRegistration | null>(null);
  const snapshotRef = useRef<PresentWindowSnapshot | null>(initialSnapshot);
  const screenShareFailureHandledRef = useRef(false);
  const hasSnapshotRef = useRef(Boolean(initialSnapshot));
  const lastPresenterSeenAtRef = useRef<number | null>(
    initialSnapshot ? Date.now() : null,
  );

  useEffect(() => {
    setSnapshot(initialSnapshot);
    snapshotRef.current = initialSnapshot;
    hasSnapshotRef.current = Boolean(initialSnapshot);
    lastPresenterSeenAtRef.current = initialSnapshot ? Date.now() : null;
    setIsPresenterStale(false);
  }, [identity.deckId, identity.sessionId, initialSnapshot]);

  useEffect(() => {
    const registration = registerAudienceStreamBridge({
      identity,
      onAttach: setAudienceStream,
      onDetach: () => setAudienceStream(null),
    });
    if (!registration.ok) return;
    streamBridgeRef.current = registration;

    return () => {
      registration.unregister();
      if (streamBridgeRef.current === registration) {
        streamBridgeRef.current = null;
      }
    };
  }, [identity]);

  useEffect(() => {
    let channel: ChannelLike;
    try {
      channel = channelFactory(getPresentationChannelName(identity));
    } catch {
      setChannelError("슬라이드 창 동기화 채널을 열 수 없습니다.");
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

      const current = snapshotRef.current;
      const next = applyPresentWindowMessage(current, message);
      if (
        message.type === "presenter-annotation-delta" &&
        next === current
      ) {
        channel.postMessage(createSlideWindowReadyMessage(identity));
      }
      snapshotRef.current = next;
      hasSnapshotRef.current = Boolean(next);
      setSnapshot(next);
      if (
        message.type === "presenter-heartbeat" ||
        message.type === "presenter-snapshot" ||
        message.type === "presenter-state"
      ) {
        lastPresenterSeenAtRef.current = Date.now();
        setIsPresenterStale(false);
      }
    };
    channel.postMessage(createSlideWindowReadyMessage(identity));
    const heartbeatTimer = window.setInterval(() => {
      channel.postMessage(createSlideWindowHeartbeatMessage(identity));
    }, 1000);
    const staleTimer = window.setInterval(() => {
      if (
        hasSnapshotRef.current &&
        isPresentWindowPresenterStale(
          lastPresenterSeenAtRef.current,
          Date.now(),
        )
      ) {
        setIsPresenterStale(true);
      }
    }, 1000);

    return () => {
      window.clearInterval(heartbeatTimer);
      window.clearInterval(staleTimer);
      channel.close();
      if (channelRef.current === channel) channelRef.current = null;
    };
  }, [channelFactory, identity]);

  useEffect(() => {
    if (snapshot?.state.audienceOutputMode === "screen-share") return;
    streamBridgeRef.current?.detach();
    setAudienceStream(null);
  }, [snapshot?.state.audienceOutputMode]);

  useEffect(() => {
    if (snapshot?.state.audienceOutputMode === "screen-share") {
      screenShareFailureHandledRef.current = false;
    }
  }, [audienceStream, snapshot?.state.audienceOutputMode]);

  const handleScreenShareFailure = useCallback(
    (reason: ScreenShareEndedReason) => {
      if (screenShareFailureHandledRef.current) return;
      const recovered = applyPresentWindowScreenShareFailure(
        snapshotRef.current,
      );
      if (!recovered) return;

      screenShareFailureHandledRef.current = true;
      snapshotRef.current = recovered;
      setSnapshot(recovered);
      streamBridgeRef.current?.detach();
      setAudienceStream(null);
      channelRef.current?.postMessage(
        createScreenShareEndedMessage({
          identity,
          reason,
        }),
      );
    },
    [identity.deckId, identity.sessionId],
  );

  if (channelError) {
    return (
      <PresentWindowShell>
        <PresentWindowStatus
          title="슬라이드 창을 연결하지 못했습니다"
          message={channelError}
        />
      </PresentWindowShell>
    );
  }

  if (!snapshot) {
    return (
      <PresentWindowShell>
        <PresentWindowStatus
          title="발표자 화면을 기다리는 중..."
        />
      </PresentWindowShell>
    );
  }

  return (
    <PresentWindowContent
      controlOverlayMode={controlOverlayMode}
      fullscreenMessage={fullscreenMessage}
      identity={identity}
      isFullscreen={isFullscreen}
      isPresenterStale={isPresenterStale}
      onExit={onExit}
      onNextStep={onNextStep}
      onPreviousSlide={onPreviousSlide}
      onReconnectPresenter={onReconnectPresenter}
      onScreenShareFailure={handleScreenShareFailure}
      snapshot={snapshot}
      stream={audienceStream}
    />
  );
}

export function PresentWindowContent(props: {
  controlOverlayMode?: "always" | "fallback" | "hidden";
  fullscreenMessage?: string;
  identity: PresentationChannelIdentity;
  isFullscreen?: boolean;
  isPresenterStale?: boolean;
  onExit?: () => void;
  onNextStep?: () => void;
  onPreviousSlide?: () => void;
  onReconnectPresenter?: (snapshot: PresentWindowSnapshot) => void;
  onScreenShareFailure?: (reason: ScreenShareEndedReason) => void;
  snapshot: PresentWindowSnapshot;
  stream?: MediaStream | null;
  viewport?: ViewportSize;
}) {
  const {
    controlOverlayMode = "hidden",
    fullscreenMessage,
    identity,
    isPresenterStale = false,
    onExit,
    onNextStep,
    onPreviousSlide,
    onReconnectPresenter,
    onScreenShareFailure,
    snapshot,
    stream = null,
  } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const [screenShareContentSize, setScreenShareContentSize] =
    useState<SurfaceSize | null>(null);
  const liveViewport = usePresentWindowViewport();
  const liveIsFullscreen = usePresentWindowFullscreenState();
  const isFullscreen = props.isFullscreen ?? liveIsFullscreen;
  const scale = getSlideWindowScale(
    snapshot.deck,
    props.viewport ?? liveViewport,
  );
  const viewport = props.viewport ?? liveViewport;
  const actionMessages = [
    fullscreenMessage,
    isPresenterStale
      ? "발표자 창 응답이 끊겼습니다. 발표자 창을 다시 열거나 이 화면을 종료해주세요."
      : "",
  ].filter(Boolean);
  const shouldShowReconnect = Boolean(
    onReconnectPresenter && (fullscreenMessage || isPresenterStale),
  );
  const shouldShowFallbackControls =
    controlOverlayMode === "fallback" &&
    (actionMessages.length > 0 || isPresenterStale);
  const shouldShowPresenterControls =
    controlOverlayMode === "always" || shouldShowFallbackControls;
  const isBlackOutput = snapshot.state.audienceOutputMode === "black";
  const currentSlide = snapshot.deck.slides.find(
    (slide) => slide.slideId === snapshot.state.slideId,
  );
  const canAdvanceStage =
    Boolean(onNextStep) &&
    !isBlackOutput &&
    currentSlide?.kind !== "activity" &&
    currentSlide?.kind !== "activity-results";

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) {
        return;
      }
      if (!isSlideWindowFullscreenRequestMessage(event.data)) {
        return;
      }

      void requestPresentWindowFullscreen(rootRef.current);
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <PresentWindowShell ref={rootRef}>
      <div
        aria-label="슬라이드 전용 창"
        className="present-window-stage"
        data-deck-id={identity.deckId}
        data-scale={scale}
        data-session-id={identity.sessionId}
        onClick={(event) => {
          if (canAdvanceStage && shouldAdvancePresentationFromClick(event.target)) {
            onNextStep?.();
          }
        }}
      >
        <AudienceOutputRenderer
          deck={snapshot.deck}
          onScreenShareContentSizeChange={setScreenShareContentSize}
          onScreenShareFailure={onScreenShareFailure}
          scale={scale}
          state={snapshot.state}
          stream={stream}
          triggerAnimationIds={snapshot.triggerAnimationIds}
        />
        <AudienceAnnotationOverlay
          canvas={snapshot.deck.canvas}
          containerSize={viewport}
          contentSize={screenShareContentSize}
          mode={snapshot.state.audienceOutputMode}
          laser={snapshot.laser}
          scale={scale}
          snapshot={snapshot.annotation}
        />
      </div>
      {!isBlackOutput &&
      (!isFullscreen ||
        actionMessages.length > 0 ||
        shouldShowReconnect ||
        (shouldShowPresenterControls &&
          (onPreviousSlide || onNextStep || onExit))) ? (
        <div className="present-window-actions">
          {actionMessages.map((message) => (
            <span className="present-window-action-message" key={message}>
              {message}
            </span>
          ))}
          {!isFullscreen ? (
            <button
              className="present-window-fullscreen"
              type="button"
              onClick={() => {
                void requestPresentWindowFullscreen(rootRef.current);
              }}
            >
              <IconArrowsMaximize size={18} stroke={1.8} />
              전체화면
            </button>
          ) : null}
          {shouldShowPresenterControls && onPreviousSlide ? (
            <button
              className="present-window-previous"
              type="button"
              onClick={onPreviousSlide}
            >
              <IconChevronLeft size={18} stroke={1.8} />
              이전
            </button>
          ) : null}
          {shouldShowPresenterControls && onNextStep ? (
            <button
              className="present-window-next"
              type="button"
              onClick={onNextStep}
            >
              다음
              <IconChevronRight size={18} stroke={1.8} />
            </button>
          ) : null}
          {shouldShowReconnect && onReconnectPresenter ? (
            <button
              className="present-window-reconnect"
              type="button"
              onClick={() => onReconnectPresenter(snapshot)}
            >
              <IconArrowsMaximize size={18} stroke={1.8} />
              발표자 창 다시 열기
            </button>
          ) : null}
          {shouldShowPresenterControls && onExit ? (
            <button
              className="present-window-exit"
              type="button"
              onClick={onExit}
            >
              <IconX size={18} stroke={1.8} />
              발표자 화면으로 돌아가기
            </button>
          ) : null}
        </div>
      ) : null}
    </PresentWindowShell>
  );
}

export function isPresentWindowPresenterStale(
  lastPresenterSeenAt: number | null,
  now: number,
  staleAfterMs = 5000,
) {
  return (
    lastPresenterSeenAt !== null && now - lastPresenterSeenAt > staleAfterMs
  );
}

export function applyPresentWindowMessage(
  current: PresentWindowSnapshot | null,
  message: PresentationChannelMessage,
): PresentWindowSnapshot | null {
  if (message.type === "presenter-snapshot") {
    return {
      deck: message.deck,
      state: message.state,
      triggerAnimationIds: message.triggerAnimationIds,
    };
  }

  if (message.type === "presenter-state" && current) {
    return {
      ...current,
      state: message.state,
      triggerAnimationIds: message.triggerAnimationIds,
    };
  }

  if (message.type === "presenter-annotation-snapshot" && current) {
    const previous = current.annotation;
    if (
      previous &&
      previous.surfaceId === message.annotation.surfaceId &&
      previous.surfaceRevision > message.annotation.surfaceRevision
    ) {
      return current;
    }
    return { ...current, annotation: message.annotation };
  }

  if (message.type === "presenter-annotation-delta" && current) {
    const previous = current.annotation;
    if (
      !previous ||
      previous.authorityEpochId !== message.command.authorityEpochId ||
      previous.surfaceId !== message.command.surfaceId ||
      previous.surfaceRevision !== message.command.baseRevision ||
      message.surfaceRevision !== previous.surfaceRevision + 1
    ) {
      return current;
    }
    const applied = applyAnnotationCommand(
      restoreAnnotationSurface(previous),
      message.command,
    );
    if (
      !applied.accepted ||
      applied.surfaceRevision !== message.surfaceRevision
    ) {
      return current;
    }
    return {
      ...current,
      annotation: createAnnotationSnapshot({
        authorityEpochId: previous.authorityEpochId,
        sessionId: previous.sessionId,
        state: applied.state,
      }),
    };
  }

  if (message.type === "presenter-laser" && current) {
    const previous = current.laser;
    if (
      previous &&
      previous.authorityEpochId === message.laser.authorityEpochId &&
      previous.surfaceId === message.laser.surfaceId &&
      message.laser.sequence <= previous.sequence
    ) {
      return current;
    }
    return {
      ...current,
      laser: message.laser.kind === "hide" ? null : message.laser,
    };
  }

  return current;
}

export function applyPresentWindowScreenShareFailure(
  current: PresentWindowSnapshot | null,
): PresentWindowSnapshot | null {
  if (current?.state.audienceOutputMode !== "screen-share") {
    return null;
  }

  return {
    ...current,
    state: { ...current.state, audienceOutputMode: "slide" },
  };
}

export function getSlideWindowScale(deck: Deck, viewport = readViewportSize()) {
  if (viewport.width <= 0 || viewport.height <= 0) {
    return 1;
  }

  return Math.min(
    viewport.width / deck.canvas.width,
    viewport.height / deck.canvas.height,
  );
}

function PresentWindowStatus(props: { message?: string; title: string }) {
  return (
    <section
      className={`present-window-status${props.message ? "" : " present-window-status-waiting"}`}
      role="status"
    >
      <img src={orbitLogoWhite} alt="ORBIT" />
      {props.message ? <span>SLIDE DISPLAY</span> : null}
      <h1>{props.title}</h1>
      {props.message ? <p>{props.message}</p> : null}
    </section>
  );
}

const PresentWindowShell = (props: {
  children: ReactNode;
  ref?: Ref<HTMLDivElement>;
}) => (
  <main className="present-window-shell" ref={props.ref}>
    {props.children}
  </main>
);

function usePresentWindowViewport() {
  const [viewport, setViewport] = useState(readViewportSize);

  useEffect(() => {
    const updateViewport = () => setViewport(readViewportSize());

    window.addEventListener("resize", updateViewport);
    document.addEventListener("fullscreenchange", updateViewport);

    return () => {
      window.removeEventListener("resize", updateViewport);
      document.removeEventListener("fullscreenchange", updateViewport);
    };
  }, []);

  return viewport;
}

function usePresentWindowFullscreenState() {
  const [isFullscreen, setIsFullscreen] = useState(
    readPresentWindowFullscreenState,
  );

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const updateFullscreenState = () => {
      setIsFullscreen(readPresentWindowFullscreenState());
    };

    document.addEventListener("fullscreenchange", updateFullscreenState);

    return () => {
      document.removeEventListener("fullscreenchange", updateFullscreenState);
    };
  }, []);

  return isFullscreen;
}

function readViewportSize(): ViewportSize {
  if (typeof window === "undefined") {
    return { height: 0, width: 0 };
  }

  return {
    height: window.innerHeight,
    width: window.innerWidth,
  };
}

function readPresentWindowFullscreenState() {
  return typeof document !== "undefined" && Boolean(document.fullscreenElement);
}

export async function requestPresentWindowFullscreen(
  target: HTMLElement | null,
) {
  if (!target || typeof target.requestFullscreen !== "function") {
    return false;
  }

  try {
    await target.requestFullscreen();
    return true;
  } catch {
    return false;
  }
}

function isSlideWindowFullscreenRequestMessage(
  value: unknown,
): value is SlideWindowFullscreenRequestMessage {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    (value as { type?: unknown }).type === slideWindowFullscreenRequestType
  );
}

function createBroadcastChannel(channelName: string): ChannelLike {
  return new BroadcastChannel(channelName);
}
