import fs from "node:fs";
import { fileURLToPath } from "node:url";
import type { ReactNode } from "react";
import { forwardRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Deck } from "@orbit/shared";
import { p0AnimationDeck } from "../../../runtime/presentation/slideshow/__fixtures__/animationDeck";
import { getSingleScreenScale, SingleScreenPresenter } from "./SingleScreenPresenter";

vi.mock("react-konva", () => {
  function attrs(props: Record<string, unknown>) {
    return {
      "data-element-id":
        typeof props["data-element-id"] === "string"
          ? props["data-element-id"]
          : undefined,
      "data-testid":
        typeof props["data-testid"] === "string" ? props["data-testid"] : undefined
    };
  }

  type MockKonvaProps = { children?: ReactNode; [key: string]: any };

  const Group = forwardRef<HTMLDivElement, MockKonvaProps>(
    ({ children, ...props }, ref) => (
      <div ref={ref} {...attrs(props)}>
        {children}
      </div>
    )
  );
  const Stage = forwardRef<HTMLDivElement, MockKonvaProps>(
    ({ children, ...props }, ref) => (
      <div ref={ref} {...attrs(props)}>
        {children}
      </div>
    )
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
    Text
  };
});

const singleScreenPresenterSourcePath = fileURLToPath(
  new URL("./SingleScreenPresenter.tsx", import.meta.url)
);

describe("SingleScreenPresenter", () => {
  it("renders the slide without timer labels", () => {
    const html = renderSingleScreen();

    expect(html).toContain("단일 화면 슬라이드");
    expect(html).toContain("전체화면 시작");
    expect(html).not.toContain("03:20");
    expect(html).not.toContain("00:12");
    expect(html).not.toContain("01:00");
    expect(html).not.toContain("single-screen-timer-overlay");
    expectNoAutoAdvancePresenterStatus(html);
  });

  it("does not render speaker notes or keyword occurrence context", () => {
    const html = renderSingleScreen({
      deck: createDeckWithPrivateOccurrence(),
    });

    expect(html).not.toContain("AI 첫 번째 위치");
    expect(html).not.toContain("kwo_slide_p0_1_kw_private_ai_32_34");
  });

  it("hides fullscreen controls after fullscreen is active", () => {
    const html = renderSingleScreen({ isFullscreen: true });

    expect(html).toContain("단일 화면 슬라이드");
    expect(html).not.toContain("전체화면 시작");
    expect(html).not.toContain("단일 화면 종료");
    expect(html).not.toContain("03:20");
    expectNoAutoAdvancePresenterStatus(html);
  });

  it("calculates fullscreen scale from the viewport", () => {
    expect(getSingleScreenScale(p0AnimationDeck, { height: 540, width: 960 })).toBe(0.5);
  });

  it("does not import presenter-only auto advance status UI", () => {
    const source = fs.readFileSync(singleScreenPresenterSourcePath, "utf8");

    expect(source).not.toContain("AutoAdvanceStatus");
    expect(source).not.toContain("auto-advance-status");
  });
});

function renderSingleScreen(
  overrides: { deck?: Deck; isFullscreen?: boolean } = {}
) {
  const deck = overrides.deck ?? p0AnimationDeck;

  return renderToStaticMarkup(
    <SingleScreenPresenter
      deck={deck}
      isFullscreen={overrides.isFullscreen}
      onExit={() => {}}
      slideElapsedLabel="00:12"
      slideId="slide_p0_1"
      slideTargetLabel="01:00"
      stepIndex={1}
      totalTimeLabel="03:20"
      triggerAnimationIds={["anim_image_zoom_in"]}
    />
  );
}

function expectNoAutoAdvancePresenterStatus(html: string) {
  expect(html).not.toContain("auto-advance-status");
  expect(html).not.toContain("자동 전환");
  expect(html).not.toContain("발표 종료");
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
