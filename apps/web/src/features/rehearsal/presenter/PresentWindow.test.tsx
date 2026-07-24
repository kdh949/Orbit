import fs from "node:fs";
import { fileURLToPath } from "node:url";
import type { ReactNode } from "react";
import { forwardRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Deck } from "@orbit/shared";
import { p0AnimationDeck } from "./__fixtures__/animationDeck";
import {
  applyPresentWindowScreenShareFailure,
  applyPresentWindowMessage,
  getSlideWindowScale,
  isPresentWindowPresenterStale,
  PresentWindow,
  PresentWindowContent,
  PresentWindowReceiver,
  requestPresentWindowFullscreen,
} from "./PresentWindow";
import { createPresenterSlideshowState } from "./presenterStateStore";
import {
  createPresenterAnnotationDeltaMessage,
  createPresenterAnnotationSnapshotMessage,
  createPresenterLaserMessage,
  createPresenterSnapshotMessage,
  createPresenterStateMessage,
} from "./presentationChannel";

vi.mock("react-konva", () => {
  function attrs(props: Record<string, unknown>) {
    return {
      "data-element-id":
        typeof props["data-element-id"] === "string"
          ? props["data-element-id"]
          : undefined,
      "data-testid":
        typeof props["data-testid"] === "string"
          ? props["data-testid"]
          : undefined,
    };
  }

  type MockKonvaProps = { children?: ReactNode; [key: string]: any };

  const Group = forwardRef<HTMLDivElement, MockKonvaProps>(
    ({ children, ...props }, ref) => (
      <div ref={ref} {...attrs(props)}>
        {children}
      </div>
    ),
  );
  const Stage = forwardRef<HTMLDivElement, MockKonvaProps>(
    ({ children, ...props }, ref) => (
      <div ref={ref} {...attrs(props)}>
        {children}
      </div>
    ),
  );
  const Text = ({ text }: { text?: string }) => <span>{text}</span>;

  return {
    Arrow: () => <span data-konva-arrow="true" />,
    Circle: () => <span data-konva-circle="true" />,
    Group,
    Image: () => <span data-konva-image="true" />,
    Layer: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    Line: () => <span data-konva-line="true" />,
    Rect: (props: Record<string, unknown>) => <span {...attrs(props)} />,
    RegularPolygon: () => <span data-konva-polygon="true" />,
    Shape: () => <span data-konva-shape="true" />,
    Star: () => <span data-konva-star="true" />,
    Stage,
    Text,
  };
});

const identity = {
  deckId: p0AnimationDeck.deckId,
  sessionId: "session-presenter-1",
};
const presentWindowSourcePath = fileURLToPath(
  new URL("./PresentWindow.tsx", import.meta.url),
);

describe("PresentWindow", () => {
  it("shows a Korean error state when opened without a presenter session", () => {
    const html = renderToStaticMarkup(
      <PresentWindow deckId={p0AnimationDeck.deckId} />,
    );

    expect(html).toContain("발표자 화면에서 슬라이드 창을 열어주세요");
    expect(html).toContain('alt="ORBIT"');
    expect(html).toContain("SLIDE DISPLAY");
    expect(html).not.toContain("첫 문장입니다");
    expect(html).not.toContain("Partial transcript");
    expectNoAutoAdvancePresenterStatus(html);
  });

  it("renders a received sanitized snapshot without presenter-only content", () => {
    const privateDeck = createDeckWithPrivateOccurrence();
    const snapshotMessage = createPresenterSnapshotMessage({
      deck: privateDeck,
      identity,
      sentAt: 10,
      state: {
        ...createPresenterSlideshowState(privateDeck),
        stepIndex: 1,
      },
      triggerAnimationIds: ["anim_image_zoom_in"],
    });
    const html = renderToStaticMarkup(
      <PresentWindowContent
        identity={identity}
        snapshot={{
          deck: snapshotMessage.deck,
          state: snapshotMessage.state,
          triggerAnimationIds: snapshotMessage.triggerAnimationIds,
        }}
      />,
    );

    expect(html).toContain('data-deck-id="deck_p0_animation"');
    expect(html).toContain('data-session-id="session-presenter-1"');
    expect(html).toContain('data-step-index="1"');
    expect(html).toContain("Slideshow Renderer");
    expect(html).toContain("전체화면");
    expect(html).not.toContain("첫 문장입니다");
    expect(html).not.toContain("AI 첫 번째 위치");
    expect(html).not.toContain("kwo_slide_p0_1_kw_private_ai_32_34");
    expect(html).not.toContain("두 번째 슬라이드입니다");
    expect(html).not.toContain("Partial transcript");
    expectNoAutoAdvancePresenterStatus(html);
  });

  it("does not render presenter speech state in the slide display window", () => {
    const snapshotMessage = createPresenterSnapshotMessage({
      deck: p0AnimationDeck,
      identity,
      sentAt: 10,
      state: {
        ...createPresenterSlideshowState(p0AnimationDeck),
        speech: createPresenterSpeechState(),
      },
      triggerAnimationIds: [],
    });
    const html = renderToStaticMarkup(
      <PresentWindowContent
        identity={identity}
        snapshot={{
          deck: snapshotMessage.deck,
          state: snapshotMessage.state,
          triggerAnimationIds: snapshotMessage.triggerAnimationIds,
        }}
      />,
    );

    expect(html).not.toContain("비공개 final transcript");
    expect(html).not.toContain("비공개 speaker note sentence");
    expect(html).not.toContain("Semantic STT");
    expect(html).not.toContain("topMatches");
    expect(html).not.toContain("semanticDebug");
  });

  it("renders a slide receiver from an initial snapshot without presenter-only content", () => {
    const snapshotMessage = createPresenterSnapshotMessage({
      deck: p0AnimationDeck,
      identity,
      sentAt: 10,
      state: createPresenterSlideshowState(p0AnimationDeck),
      triggerAnimationIds: [],
    });
    const html = renderToStaticMarkup(
      <PresentWindowReceiver
        controlOverlayMode="always"
        fullscreenMessage="현재 창 전체화면을 자동으로 시작하지 못했습니다."
        identity={identity}
        initialSnapshot={{
          deck: snapshotMessage.deck,
          state: snapshotMessage.state,
          triggerAnimationIds: snapshotMessage.triggerAnimationIds,
        }}
        onExit={() => {}}
      />,
    );

    expect(html).toContain('data-deck-id="deck_p0_animation"');
    expect(html).toContain("현재 창 전체화면");
    expect(html).toContain("발표자 화면으로 돌아가기");
    expect(html).not.toContain("첫 문장입니다");
    expect(html).not.toContain("Partial transcript");
    expectNoAutoAdvancePresenterStatus(html);
  });

  it("applies state updates to an initial slide receiver snapshot", () => {
    const initialState = createPresenterSlideshowState(p0AnimationDeck);
    const snapshotMessage = createPresenterSnapshotMessage({
      deck: p0AnimationDeck,
      identity,
      sentAt: 10,
      state: initialState,
      triggerAnimationIds: [],
    });
    const current = {
      deck: snapshotMessage.deck,
      state: snapshotMessage.state,
      triggerAnimationIds: snapshotMessage.triggerAnimationIds,
    };
    const next = applyPresentWindowMessage(
      current,
      createPresenterStateMessage({
        identity,
        sentAt: 20,
        state: {
          ...initialState,
          slideId: "slide_p0_2",
          slideIndex: 1,
          stepIndex: 0,
        },
        triggerAnimationIds: ["anim_image_zoom_in"],
      }),
    );

    expect(next?.state.slideId).toBe("slide_p0_2");
    expect(next?.triggerAnimationIds).toEqual(["anim_image_zoom_in"]);
  });

  it("returns a screen-share receiver to its latest slide exactly once", () => {
    const current = {
      deck: p0AnimationDeck,
      state: {
        ...createPresenterSlideshowState(p0AnimationDeck),
        audienceOutputMode: "screen-share" as const,
        slideId: "slide_p0_2",
        slideIndex: 1,
        stepIndex: 2,
      },
      triggerAnimationIds: ["anim_image_zoom_in"],
    };

    const recovered = applyPresentWindowScreenShareFailure(current);

    expect(recovered?.state).toMatchObject({
      audienceOutputMode: "slide",
      slideId: "slide_p0_2",
      slideIndex: 1,
      stepIndex: 2,
    });
    expect(applyPresentWindowScreenShareFailure(recovered)).toBeNull();
  });

  it("does not import presenter-only auto advance status UI", () => {
    const source = fs.readFileSync(presentWindowSourcePath, "utf8");

    expect(source).not.toContain("AutoAdvanceStatus");
    expect(source).not.toContain("auto-advance-status");
  });

  it("applies full snapshots before state-only updates", () => {
    const initialState = createPresenterSlideshowState(p0AnimationDeck);
    const snapshotMessage = createPresenterSnapshotMessage({
      deck: p0AnimationDeck,
      identity,
      sentAt: 10,
      state: initialState,
      triggerAnimationIds: [],
    });
    const stateMessage = createPresenterStateMessage({
      identity,
      sentAt: 20,
      state: {
        ...initialState,
        slideId: "slide_p0_2",
        slideIndex: 1,
        stepIndex: 0,
      },
      triggerAnimationIds: ["anim_image_zoom_in"],
    });

    const snapshot = applyPresentWindowMessage(null, snapshotMessage);
    const updated = applyPresentWindowMessage(snapshot, stateMessage);

    expect(snapshot?.deck.deckId).toBe("deck_p0_animation");
    expect(updated?.state).toMatchObject({
      slideId: "slide_p0_2",
      slideIndex: 1,
      stepIndex: 0,
    });
    expect(updated?.triggerAnimationIds).toEqual(["anim_image_zoom_in"]);
  });

  it("ignores state-only updates before a full snapshot", () => {
    const message = createPresenterStateMessage({
      identity,
      sentAt: 20,
      state: createPresenterSlideshowState(p0AnimationDeck),
      triggerAnimationIds: [],
    });

    expect(applyPresentWindowMessage(null, message)).toBeNull();
  });

  it("calculates the largest viewport scale that preserves the deck aspect", () => {
    expect(
      getSlideWindowScale(p0AnimationDeck, { height: 540, width: 960 }),
    ).toBe(0.5);
    expect(
      getSlideWindowScale(p0AnimationDeck, { height: 1080, width: 960 }),
    ).toBe(0.5);
  });

  it("renders slide-window scale from the current viewport", () => {
    const snapshotMessage = createPresenterSnapshotMessage({
      deck: p0AnimationDeck,
      identity,
      sentAt: 10,
      state: createPresenterSlideshowState(p0AnimationDeck),
      triggerAnimationIds: [],
    });
    const html = renderToStaticMarkup(
      <PresentWindowContent
        identity={identity}
        snapshot={{
          deck: snapshotMessage.deck,
          state: snapshotMessage.state,
          triggerAnimationIds: [],
        }}
        viewport={{ height: 540, width: 960 }}
      />,
    );

    expect(html).toContain('data-scale="0.5"');
  });

  it("hides the fullscreen CTA once the slide window is fullscreen", () => {
    const snapshotMessage = createPresenterSnapshotMessage({
      deck: p0AnimationDeck,
      identity,
      sentAt: 10,
      state: createPresenterSlideshowState(p0AnimationDeck),
      triggerAnimationIds: [],
    });
    const html = renderToStaticMarkup(
      <PresentWindowContent
        identity={identity}
        isFullscreen={true}
        snapshot={{
          deck: snapshotMessage.deck,
          state: snapshotMessage.state,
          triggerAnimationIds: [],
        }}
      />,
    );

    expect(html).not.toContain("전체화면");
    expect(html).not.toContain("present-window-fullscreen");
  });

  it("hides presenter reconnect controls while the presenter is healthy", () => {
    const snapshotMessage = createPresenterSnapshotMessage({
      deck: p0AnimationDeck,
      identity,
      sentAt: 10,
      state: createPresenterSlideshowState(p0AnimationDeck),
      triggerAnimationIds: [],
    });
    const html = renderToStaticMarkup(
      <PresentWindowContent
        identity={identity}
        isFullscreen={true}
        onReconnectPresenter={() => {}}
        snapshot={{
          deck: snapshotMessage.deck,
          state: snapshotMessage.state,
          triggerAnimationIds: [],
        }}
      />,
    );

    expect(html).not.toContain("발표자 창 다시 열기");
    expect(html).not.toContain("present-window-reconnect");
  });

  it("keeps the fullscreen CTA visible before fullscreen is active", () => {
    const snapshotMessage = createPresenterSnapshotMessage({
      deck: p0AnimationDeck,
      identity,
      sentAt: 10,
      state: createPresenterSlideshowState(p0AnimationDeck),
      triggerAnimationIds: [],
    });
    const html = renderToStaticMarkup(
      <PresentWindowContent
        identity={identity}
        isFullscreen={false}
        snapshot={{
          deck: snapshotMessage.deck,
          state: snapshotMessage.state,
          triggerAnimationIds: [],
        }}
      />,
    );

    expect(html).toContain("전체화면");
  });

  it("renders current-window navigation controls when enabled", () => {
    const snapshotMessage = createPresenterSnapshotMessage({
      deck: p0AnimationDeck,
      identity,
      sentAt: 10,
      state: createPresenterSlideshowState(p0AnimationDeck),
      triggerAnimationIds: [],
    });
    const html = renderToStaticMarkup(
      <PresentWindowContent
        controlOverlayMode="always"
        identity={identity}
        isFullscreen={true}
        onNextStep={() => {}}
        onPreviousSlide={() => {}}
        snapshot={{
          deck: snapshotMessage.deck,
          state: snapshotMessage.state,
          triggerAnimationIds: [],
        }}
      />,
    );

    expect(html).toContain("present-window-previous");
    expect(html).toContain("present-window-next");
    expect(html).toContain("이전");
    expect(html).toContain("다음");
  });

  it("hides slide-surface navigation controls while the presenter remote is healthy", () => {
    const snapshotMessage = createPresenterSnapshotMessage({
      deck: p0AnimationDeck,
      identity,
      sentAt: 10,
      state: createPresenterSlideshowState(p0AnimationDeck),
      triggerAnimationIds: [],
    });
    const html = renderToStaticMarkup(
      <PresentWindowContent
        controlOverlayMode="fallback"
        identity={identity}
        isFullscreen={true}
        onExit={() => {}}
        onNextStep={() => {}}
        onPreviousSlide={() => {}}
        snapshot={{
          deck: snapshotMessage.deck,
          state: snapshotMessage.state,
          triggerAnimationIds: [],
        }}
      />,
    );

    expect(html).not.toContain("present-window-actions");
    expect(html).not.toContain("present-window-previous");
    expect(html).not.toContain("present-window-next");
    expect(html).not.toContain("present-window-exit");
  });

  it("shows slide-surface navigation controls when the presenter remote fallback is active", () => {
    const snapshotMessage = createPresenterSnapshotMessage({
      deck: p0AnimationDeck,
      identity,
      sentAt: 10,
      state: createPresenterSlideshowState(p0AnimationDeck),
      triggerAnimationIds: [],
    });
    const html = renderToStaticMarkup(
      <PresentWindowContent
        controlOverlayMode="fallback"
        fullscreenMessage="팝업이 차단되었습니다."
        identity={identity}
        isFullscreen={true}
        onExit={() => {}}
        onNextStep={() => {}}
        onPreviousSlide={() => {}}
        snapshot={{
          deck: snapshotMessage.deck,
          state: snapshotMessage.state,
          triggerAnimationIds: [],
        }}
      />,
    );

    expect(html).toContain("present-window-previous");
    expect(html).toContain("present-window-next");
    expect(html).toContain("present-window-exit");
  });

  it("accepts same-origin delegated fullscreen requests from the presenter window", () => {
    const source = fs.readFileSync(presentWindowSourcePath, "utf8");
    const start = source.indexOf("const onMessage = (event: MessageEvent)");
    const end = source.indexOf("return (", start);
    const messageHandlerBody = source.slice(start, end);

    expect(messageHandlerBody).toContain(
      "event.origin !== window.location.origin",
    );
    expect(messageHandlerBody).toContain(
      "isSlideWindowFullscreenRequestMessage(event.data)",
    );
    expect(messageHandlerBody).toContain(
      "requestPresentWindowFullscreen(rootRef.current)",
    );
  });

  it("shows presenter reconnect guidance when presenter heartbeat is stale", () => {
    const snapshotMessage = createPresenterSnapshotMessage({
      deck: p0AnimationDeck,
      identity,
      sentAt: 10,
      state: createPresenterSlideshowState(p0AnimationDeck),
      triggerAnimationIds: [],
    });
    const html = renderToStaticMarkup(
      <PresentWindowContent
        identity={identity}
        isFullscreen={true}
        isPresenterStale={true}
        onReconnectPresenter={() => {}}
        snapshot={{
          deck: snapshotMessage.deck,
          state: snapshotMessage.state,
          triggerAnimationIds: [],
        }}
      />,
    );

    expect(html).toContain("발표자 창 응답이 끊겼습니다");
    expect(html).toContain("발표자 창 다시 열기");
    expect(html).not.toContain("present-window-fullscreen");
  });

  it("marks presenter heartbeat stale only after the timeout boundary", () => {
    expect(isPresentWindowPresenterStale(null, 6001)).toBe(false);
    expect(isPresentWindowPresenterStale(1000, 6000)).toBe(false);
    expect(isPresentWindowPresenterStale(1000, 6001)).toBe(true);
  });

  it("applies ordered annotation delta and rejects a reordered delta", () => {
    const state = createPresenterSlideshowState(p0AnimationDeck);
    const presenterSnapshot = createPresenterSnapshotMessage({
      deck: p0AnimationDeck,
      identity,
      state,
    });
    const initial = applyPresentWindowMessage(null, presenterSnapshot);
    const annotationMessage = createPresenterAnnotationSnapshotMessage({
      annotation: {
        sessionId: "persisted_session_1",
        authorityEpochId: "epoch_1",
        surfaceId: "surface_1",
        surfaceRevision: 0,
        strokes: [],
      },
      identity,
    });
    const withAnnotation = applyPresentWindowMessage(
      initial,
      annotationMessage,
    );
    const delta = createPresenterAnnotationDeltaMessage({
      command: {
        sessionId: "persisted_session_1",
        authorityEpochId: "epoch_1",
        surfaceId: "surface_1",
        clientOperationId: "op_1",
        baseRevision: 0,
        sequence: 0,
        kind: "stroke-begin",
        strokeId: "stroke_1",
        tool: "pen",
        color: "ink-blue",
        width: 0.01,
        point: { x: 0.1, y: 0.2, pressure: 0.5, t: 0 },
      },
      identity,
      surfaceRevision: 1,
    });
    const accepted = applyPresentWindowMessage(withAnnotation, delta);

    expect(accepted?.annotation).toMatchObject({
      surfaceRevision: 1,
      strokes: [{ strokeId: "stroke_1" }],
    });
    expect(
      applyPresentWindowMessage(accepted, {
        ...delta,
        command: {
          ...delta.command,
          clientOperationId: "op_gap",
          baseRevision: 4,
        },
        surfaceRevision: 5,
      }),
    ).toBe(accepted);
  });

  it("applies only the latest laser sequence and removes a hidden laser", () => {
    const presenterSnapshot = createPresenterSnapshotMessage({
      deck: p0AnimationDeck,
      identity,
      state: createPresenterSlideshowState(p0AnimationDeck),
    });
    const initial = applyPresentWindowMessage(null, presenterSnapshot);
    const move = createPresenterLaserMessage({
      identity,
      laser: {
        sessionId: "persisted_session_1",
        authorityEpochId: "epoch_1",
        surfaceId: "surface_1",
        sequence: 2,
        kind: "move",
        x: 0.2,
        y: 0.4,
      },
    });
    const withLaser = applyPresentWindowMessage(initial, move);

    expect(withLaser?.laser).toEqual(move.laser);
    expect(
      applyPresentWindowMessage(
        withLaser,
        createPresenterLaserMessage({
          identity,
          laser: {
            sessionId: "persisted_session_1",
            authorityEpochId: "epoch_1",
            surfaceId: "surface_1",
            sequence: 1,
            kind: "move",
            x: 0.9,
            y: 0.4,
          },
        }),
      ),
    ).toBe(withLaser);

    const hidden = applyPresentWindowMessage(
      withLaser,
      createPresenterLaserMessage({
        identity,
        laser: {
          sessionId: "persisted_session_1",
          authorityEpochId: "epoch_1",
          surfaceId: "surface_1",
          sequence: 3,
          kind: "hide",
        },
      }),
    );

    expect(hidden?.laser).toBeNull();
  });

  it("handles blocked fullscreen requests without leaking a rejected promise", async () => {
    const requestFullscreen = vi.fn().mockRejectedValue(new Error("blocked"));

    await expect(
      requestPresentWindowFullscreen({
        requestFullscreen,
      } as unknown as HTMLElement),
    ).resolves.toBe(false);
    expect(requestFullscreen).toHaveBeenCalled();
  });
});

function expectNoAutoAdvancePresenterStatus(html: string) {
  expect(html).not.toContain("자동 전환까지");
  expect(html).not.toContain("빌드 2개 남음");
  expect(html).not.toContain("발표 종료 준비됨");
  expect(html).not.toContain("수동으로 넘겨주세요");
  expect(html).not.toContain("auto-advance-status");
}

function createPresenterSpeechState() {
  return {
    coveredSentenceIds: ["sentence_1"],
    coveredSentenceMatchKinds: {
      sentence_1: "covered" as const,
    },
    matchableSentenceCount: 2,
    semanticDebug: {
      status: "ready" as const,
      slideId: "slide_p0_1",
      transcript: "비공개 final transcript",
      isFinal: true,
      topMatches: [
        {
          rank: 1,
          sentenceId: "sentence_1",
          sentenceIndex: 0,
          text: "비공개 speaker note sentence",
          similarity: 0.91,
          covered: true,
        },
      ],
      decision: null,
      error: null,
    },
    semanticMatchingEnabled: true,
    snapshot: {
      slideId: "slide_p0_1",
      coveredSentenceIds: ["sentence_1"],
      coveredSentenceMatchKinds: {
        sentence_1: "covered" as const,
      },
      matchableSentenceCount: 2,
      sentenceCoverage: 0.5,
      wordCoverage: 0.1,
      effectiveCoverage: 0.5,
      finalSentenceSpoken: false,
      hitKeywordIds: [],
      provisionalMissingKeywordIds: [],
    },
  };
}

function createDeckWithPrivateOccurrence(): Deck {
  return {
    ...p0AnimationDeck,
    slides: p0AnimationDeck.slides.map((slide, index) =>
      index === 0
        ? {
            ...slide,
            speakerNotes:
              "AI 첫 번째 위치는 트리거가 아닙니다. 마지막 AI 위치만 트리거입니다.",
            actions: [
              ...slide.actions,
              {
                actionId: "act_private_occurrence",
                trigger: {
                  kind: "keyword-occurrence",
                  keywordId: "kw_private_ai",
                  occurrenceId: "kwo_slide_p0_1_kw_private_ai_32_34",
                },
                effect: {
                  kind: "play-animation",
                  animationId: "anim_image_zoom_in",
                },
              },
            ],
          }
        : slide,
    ),
  };
}
