import type { Deck } from "@orbit/shared";
import { useEffect, useRef, useState } from "react";
import orbitLogoWhite from "../../../assets/orbit-logo-white.png";
import {
  ActivityAudienceRuntime,
  ActivityResultRuntime
} from "../../activity-slides";
import type { ScreenShareEndedReason } from "./presentationChannel";
import type { PresenterSlideshowState } from "./presenterStateStore";
import { SlideshowRenderer } from "./SlideshowRenderer";

export const audienceStreamWaitTimeoutMs = 5000;

export function AudienceOutputRenderer(props: {
  deck: Deck;
  onScreenShareFailure?: (reason: ScreenShareEndedReason) => void;
  scale: number;
  state: PresenterSlideshowState;
  stream?: MediaStream | null;
  triggerAnimationIds: string[];
}) {
  const {
    deck,
    onScreenShareFailure,
    scale,
    state,
    stream = null,
    triggerAnimationIds,
  } = props;
  const screenShareFailureRef = useRef(onScreenShareFailure);
  screenShareFailureRef.current = onScreenShareFailure;

  useEffect(() => {
    if (state.audienceOutputMode !== "screen-share" || stream) return;
    const timeoutId = window.setTimeout(
      () => screenShareFailureRef.current?.("stream-missing"),
      audienceStreamWaitTimeoutMs,
    );
    return () => window.clearTimeout(timeoutId);
  }, [state.audienceOutputMode, stream]);

  if (state.audienceOutputMode === "black") {
    return (
      <section aria-label="청중 화면 가림" className="audience-output-black">
        <img alt="ORBIT" src={orbitLogoWhite} />
      </section>
    );
  }

  if (state.audienceOutputMode === "screen-share") {
    return stream ? (
      <AudienceScreenShareVideo
        onPlaybackFailed={(reason) =>
          screenShareFailureRef.current?.(reason)
        }
        stream={stream}
      />
    ) : (
      <section
        aria-label="공유 화면 연결 중"
        className="audience-output-connecting"
        role="status"
      >
        공유 화면을 연결하는 중입니다
      </section>
    );
  }

  const slide =
    deck.slides.find((candidate) => candidate.slideId === state.slideId) ??
    deck.slides[state.slideIndex];

  if (slide?.kind === "activity") {
    return (
      <ActivityAudienceRuntime
        activity={slide.activity}
        deckId={deck.deckId}
        projectId={deck.projectId}
        scale={scale}
        slideStyle={slide.style}
        theme={deck.theme}
      />
    );
  }

  if (slide?.kind === "activity-results") {
    return (
      <ActivityResultRuntime
        deck={deck}
        role="audience"
        scale={scale}
        slide={slide}
      />
    );
  }

  return (
    <SlideshowRenderer
      deck={deck}
      highlights={state.highlights}
      renderMode="slide-window"
      scale={scale}
      slideId={state.slideId}
      stepIndex={state.stepIndex}
      triggerAnimationIds={triggerAnimationIds}
    />
  );
}

export function AudienceScreenShareVideo(props: {
  onPlaybackFailed?: (reason: "playback-failed") => void;
  stream: MediaStream;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playbackFailureRef = useRef(props.onPlaybackFailed);
  playbackFailureRef.current = props.onPlaybackFailed;
  const [playbackFailed, setPlaybackFailed] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    return attachAudienceVideoStream(video, props.stream, (reason) => {
      setPlaybackFailed(true);
      playbackFailureRef.current?.(reason);
    });
  }, [props.stream]);

  return (
    <section className="audience-output-screen-share">
      <video
        aria-label="공유 중인 웹 또는 실습 화면"
        autoPlay
        muted
        onCanPlay={() => setPlaybackFailed(false)}
        onPlaying={() => setPlaybackFailed(false)}
        playsInline
        ref={videoRef}
      />
      {playbackFailed ? (
        <span className="audience-output-video-error" role="status">
          공유 화면을 재생하지 못했습니다
        </span>
      ) : null}
    </section>
  );
}

export function attachAudienceVideoStream(
  video: Pick<
    HTMLVideoElement,
    "muted" | "play" | "readyState" | "srcObject"
  >,
  stream: MediaStream,
  onPlaybackFailed?: (reason: "playback-failed") => void,
) {
  let failureTimer: ReturnType<typeof setTimeout> | undefined;
  video.srcObject = stream;
  video.muted = true;
  void video.play().catch(() => {
    failureTimer = setTimeout(() => {
      if (video.srcObject === stream && video.readyState < 2) {
        onPlaybackFailed?.("playback-failed");
      }
    }, 1000);
  });

  return () => {
    if (failureTimer) clearTimeout(failureTimer);
    if (video.srcObject === stream) video.srcObject = null;
  };
}
