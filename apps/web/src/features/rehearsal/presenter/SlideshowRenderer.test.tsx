import fs from "node:fs";
import path from "node:path";
import { createActivitySlide, createDemoDeck } from "@orbit/editor-core";
import type { ReactNode } from "react";
import { forwardRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { p0AnimationDeck } from "./__fixtures__/animationDeck";
import {
  getCrossFadeLayerOpacities,
  getDestinationCrossFadeDurationMs,
  SlideshowRenderer
} from "./SlideshowRenderer";

vi.mock("react-konva", () => {
  function attrs(props: Record<string, unknown>) {
    return {
      "data-element-id":
        typeof props["data-element-id"] === "string"
          ? props["data-element-id"]
          : undefined,
      "data-highlight-element-id":
        typeof props["data-highlight-element-id"] === "string"
          ? props["data-highlight-element-id"]
          : undefined,
      "data-opacity":
        typeof props.opacity === "number" ? String(props.opacity) : undefined,
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

describe("SlideshowRenderer", () => {
  it("renders from presenter state props without presenter-only dependencies", () => {
    const html = renderToStaticMarkup(
      <SlideshowRenderer
        deck={p0AnimationDeck}
        highlights={[{ elementId: "el_image", active: true }]}
        slideId="slide_p0_1"
        stepIndex={1}
        triggerAnimationIds={["anim_image_zoom_in", "anim_group_fade_out"]}
      />
    );

    expect(html).toContain("data-slide-id=\"slide_p0_1\"");
    expect(html).toContain("data-step-index=\"1\"");
    expect(html).toContain("data-highlight-element-id=\"el_image\"");
    expect(html).toContain("Slideshow Renderer");
  });

  it("handles missing slides with a Korean status message", () => {
    const html = renderToStaticMarkup(
      <SlideshowRenderer
        deck={p0AnimationDeck}
        slideId="slide_missing"
        stepIndex={0}
      />
    );

    expect(html).toContain("슬라이드를 찾을 수 없습니다.");
  });

  it("renders activity slides as the audience QR surface", () => {
    const baseDeck = createDemoDeck();
    const activitySlide = createActivitySlide(baseDeck, "poll");
    const deck = { ...baseDeck, slides: [...baseDeck.slides, activitySlide] };
    const html = renderToStaticMarkup(
      <SlideshowRenderer
        deck={deck}
        slideId={activitySlide.slideId}
        stepIndex={0}
      />
    );

    expect(html).toContain("청중 참여 장표");
    expect(html).toContain("발표자가 참여를 준비하고 있습니다");
    expect(html).not.toContain('data-testid="read-only-slide-stage"');
  });

  it("falls back to thumbnailUrl when a slide has no renderable elements", () => {
    const thumbnailDeck = {
      ...p0AnimationDeck,
      slides: [
        {
          ...p0AnimationDeck.slides[0]!,
          animations: [],
          elements: [],
          slideId: "slide_thumbnail_only",
          thumbnailUrl: "/slides/thumb.png",
          title: "Imported slide"
        }
      ]
    };
    const html = renderToStaticMarkup(
      <SlideshowRenderer
        deck={thumbnailDeck}
        slideId="slide_thumbnail_only"
        stepIndex={0}
      />
    );

    expect(html).toContain("class=\"slideshow-renderer-thumbnail\"");
    expect(html).toContain("src=\"/slides/thumb.png\"");
    expect(html).not.toContain("data-testid=\"read-only-slide-stage\"");
  });

  it("starts first presenter render from entry animation start state", () => {
    const html = renderToStaticMarkup(
      <SlideshowRenderer
        deck={p0AnimationDeck}
        slideId="slide_p0_1"
        stepIndex={0}
      />
    );

    expect(html).toContain("data-element-id=\"el_title\" data-opacity=\"0\"");
  });

  it("restores settled state on first slide-window render", () => {
    const html = renderToStaticMarkup(
      <SlideshowRenderer
        deck={p0AnimationDeck}
        renderMode="slide-window"
        slideId="slide_p0_1"
        stepIndex={0}
      />
    );

    expect(html).toContain("data-element-id=\"el_title\" data-opacity=\"1\"");
  });

  it("uses the destination fade duration except on first slide or reduced motion", () => {
    const destinationSlide = {
      ...p0AnimationDeck.slides[1]!,
      transition: { type: "fade" as const, durationMs: 700 }
    };

    expect(
      getDestinationCrossFadeDurationMs({
        hasPreviousSlide: true,
        reducedMotion: false,
        slide: destinationSlide
      })
    ).toBe(700);
    expect(
      getDestinationCrossFadeDurationMs({
        hasPreviousSlide: false,
        reducedMotion: false,
        slide: destinationSlide
      })
    ).toBe(0);
    expect(
      getDestinationCrossFadeDurationMs({
        hasPreviousSlide: true,
        reducedMotion: true,
        slide: destinationSlide
      })
    ).toBe(0);
  });

  it("cross-fades outgoing and incoming layer opacity with bounded progress", () => {
    expect(getCrossFadeLayerOpacities(0.25)).toEqual({
      incoming: 0.25,
      outgoing: 0.75
    });
    expect(getCrossFadeLayerOpacities(-1)).toEqual({
      incoming: 0,
      outgoing: 1
    });
    expect(getCrossFadeLayerOpacities(2)).toEqual({
      incoming: 1,
      outgoing: 0
    });
  });

  it("renders the first slide immediately without an outgoing transition layer", () => {
    const firstSlide = {
      ...p0AnimationDeck.slides[0]!,
      transition: { type: "fade" as const, durationMs: 700 }
    };
    const deck = {
      ...p0AnimationDeck,
      slides: [firstSlide, ...p0AnimationDeck.slides.slice(1)]
    };
    const html = renderToStaticMarkup(
      <SlideshowRenderer deck={deck} slideId={firstSlide.slideId} stepIndex={0} />
    );

    expect(html).toContain("data-transition-active=\"false\"");
    expect(html).not.toContain("data-cross-fade-layer=\"outgoing\"");
  });

  it("keeps renderer imports away from editor interaction modules", () => {
    const filesToCheck = [
      "src/features/rehearsal/presenter/SlideshowRenderer.tsx",
      "src/features/slides/rendering/ReadOnlySlideCanvas.tsx",
      "src/features/slides/rendering/elementRendering.tsx"
    ];
    const forbiddenPatterns = [
      "EditableElementNode",
      "InlineTextEditorOverlay",
      "useCanvasKeyboardShortcuts",
      "useCanvasStageInteractions",
      "Transformer"
    ];

    for (const file of filesToCheck) {
      const source = fs.readFileSync(path.join(process.cwd(), file), "utf8");

      for (const pattern of forbiddenPatterns) {
        expect(source).not.toContain(pattern);
      }
    }
  });

  it("uses a stable default trigger animation iterable", () => {
    const source = fs.readFileSync(
      path.join(
        process.cwd(),
        "src/features/rehearsal/presenter/SlideshowRenderer.tsx"
      ),
      "utf8"
    );

    expect(source).toContain("emptyTriggerAnimationIds");
    expect(source).not.toContain("triggerAnimationIds = []");
  });
});
