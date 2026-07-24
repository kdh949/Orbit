import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { createActivitySlide, createDemoDeck } from "@orbit/editor-core";
import { p0AnimationDeck } from "./__fixtures__/animationDeck";
import {
  AudienceOutputRenderer,
  attachAudienceVideoStream,
} from "./AudienceOutputRenderer";
import { createPresenterSlideshowState } from "./presenterStateStore";

vi.mock("./SlideshowRenderer", () => ({
  SlideshowRenderer: (props: {
    activityElementRuntime?: { passcodeState: { status: string } };
  }) => (
    <div
      data-passcode-status={
        props.activityElementRuntime?.passcodeState.status
      }
    >
      Slideshow Renderer
    </div>
  ),
}));

const audienceOutputRendererSourcePath = fileURLToPath(
  new URL("./AudienceOutputRenderer.tsx", import.meta.url),
);

describe("AudienceOutputRenderer", () => {
  it("keeps the existing slide renderer for slide output", () => {
    const html = renderToStaticMarkup(
      <AudienceOutputRenderer
        deck={p0AnimationDeck}
        scale={0.5}
        state={createPresenterSlideshowState(p0AnimationDeck)}
        triggerAnimationIds={[]}
      />,
    );

    expect(html).toContain("Slideshow Renderer");
    expect(html).not.toContain("첫 문장입니다");
  });

  it("renders editable Activity design with the injected runtime", () => {
    const base = createDemoDeck();
    const activitySlide = createActivitySlide(base, "poll", {
      preset: "spotlight",
    });
    const deck = {
      ...base,
      slides: [...base.slides, activitySlide],
    };
    const html = renderToStaticMarkup(
      <AudienceOutputRenderer
        activityElementRuntime={{
          audienceUrl: "https://orbit.example/audience/session_live",
          passcodeState: {
            status: "private",
            displayPasscode: "4821",
          },
        }}
        deck={deck}
        scale={0.5}
        state={{
          ...createPresenterSlideshowState(deck),
          slideId: activitySlide.slideId,
          slideIndex: deck.slides.length - 1,
        }}
        triggerAnimationIds={[]}
      />,
    );

    expect(html).toContain("Slideshow Renderer");
    expect(html).toContain('data-passcode-status="private"');
    expect(html).not.toContain("청중 참여 장표");
  });

  it("renders only a black surface and small logo in black mode", () => {
    const html = renderToStaticMarkup(
      <AudienceOutputRenderer
        deck={p0AnimationDeck}
        scale={1}
        state={{
          ...createPresenterSlideshowState(p0AnimationDeck),
          audienceOutputMode: "black",
        }}
        triggerAnimationIds={[]}
      />,
    );

    expect(html).toContain("audience-output-black");
    expect(html).toContain('alt="ORBIT"');
    expect(html).not.toContain("Slideshow Renderer");
    expect(html).not.toContain("첫 문장입니다");
  });

  it("shows a stable connecting surface until the stream arrives", () => {
    const html = renderToStaticMarkup(
      <AudienceOutputRenderer
        deck={p0AnimationDeck}
        scale={1}
        state={{
          ...createPresenterSlideshowState(p0AnimationDeck),
          audienceOutputMode: "screen-share",
        }}
        triggerAnimationIds={[]}
      />,
    );

    expect(html).toContain("공유 화면을 연결하는 중입니다");
    expect(html).not.toContain("Slideshow Renderer");
    expect(html).not.toContain("첫 문장입니다");
  });

  it("renders a muted inline video without capture metadata", () => {
    const html = renderToStaticMarkup(
      <AudienceOutputRenderer
        deck={p0AnimationDeck}
        scale={1}
        state={{
          ...createPresenterSlideshowState(p0AnimationDeck),
          audienceOutputMode: "screen-share",
        }}
        stream={{} as MediaStream}
        triggerAnimationIds={[]}
      />,
    );

    expect(html).toContain("<video");
    expect(html).toContain("muted");
    expect(html).toContain("playsInline");
    expect(html).not.toContain("speakerNotes");
    expect(html).not.toContain("transcript");
    expect(html).not.toContain("rawAudio");
  });

  it("clears srcObject during video cleanup", () => {
    const stream = {} as MediaStream;
    const video = {
      muted: false,
      play: vi.fn().mockResolvedValue(undefined),
      readyState: 0,
      srcObject: null as MediaProvider | null,
    };

    const cleanup = attachAudienceVideoStream(video, stream);
    expect(video.srcObject).toBe(stream);
    expect(video.muted).toBe(true);
    cleanup();
    expect(video.srcObject).toBeNull();
  });

  it("ignores a rejected play promise after video frames are ready", async () => {
    vi.useFakeTimers();
    const stream = {} as MediaStream;
    const onPlaybackFailed = vi.fn();
    const video = {
      muted: false,
      play: vi.fn().mockRejectedValue(new Error("play rejected")),
      readyState: 4,
      srcObject: null as MediaProvider | null,
    };

    attachAudienceVideoStream(video, stream, onPlaybackFailed);
    await Promise.resolve();
    vi.runAllTimers();

    expect(onPlaybackFailed).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("reports playback failure while the video still has no frame", async () => {
    vi.useFakeTimers();
    const stream = {} as MediaStream;
    const onPlaybackFailed = vi.fn();
    const video = {
      muted: false,
      play: vi.fn().mockRejectedValue(new Error("play rejected")),
      readyState: 0,
      srcObject: null as MediaProvider | null,
    };

    attachAudienceVideoStream(video, stream, onPlaybackFailed);
    await Promise.resolve();
    vi.runAllTimers();

    expect(onPlaybackFailed).toHaveBeenCalledWith("playback-failed");
    vi.useRealTimers();
  });

  it("does not restart the stream-missing timeout when only the callback changes", () => {
    const source = fs.readFileSync(audienceOutputRendererSourcePath, "utf8");

    expect(source).toContain("screenShareFailureRef.current");
    expect(source).toContain(
      "[state.audienceOutputMode, stream]",
    );
  });
});
