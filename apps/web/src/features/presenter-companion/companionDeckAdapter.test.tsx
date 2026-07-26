import {
  companionDeckSnapshotSchema,
  type CompanionDeckSnapshot,
} from "@orbit/shared/presentation";
import { createActivitySlide, createDemoDeck } from "@orbit/editor-core";
import type { ReactNode } from "react";
import { forwardRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { p0AnimationDeck } from "../../runtime/presentation/slideshow/__fixtures__/animationDeck";
import { CompanionAudienceRenderer } from "./CompanionAudienceRenderer";
import {
  materializeCompanionDeck,
  resolveCompanionTriggerAnimationIds,
} from "./companionDeckAdapter";

vi.mock("react-konva", () => {
  const createNode = (name: string) =>
    forwardRef<
      HTMLDivElement,
      { children?: ReactNode; [key: string]: unknown }
    >(({ children, ...props }, ref) => (
      <div
        data-konva-node={name}
        data-source={
          typeof props.src === "string" ? props.src : undefined
        }
        ref={ref}
      >
        {children as ReactNode}
      </div>
    ));
  return {
    Arrow: createNode("Arrow"),
    Circle: createNode("Circle"),
    Group: createNode("Group"),
    Image: createNode("Image"),
    Layer: createNode("Layer"),
    Line: createNode("Line"),
    Rect: createNode("Rect"),
    RegularPolygon: createNode("RegularPolygon"),
    Shape: createNode("Shape"),
    Stage: createNode("Stage"),
    Star: createNode("Star"),
    Text: createNode("Text"),
  };
});

const safeDeck = companionDeckSnapshotSchema.parse({
  deckId: p0AnimationDeck.deckId,
  projectId: p0AnimationDeck.projectId,
  version: p0AnimationDeck.version,
  canvas: p0AnimationDeck.canvas,
  theme: p0AnimationDeck.theme,
  slides: p0AnimationDeck.slides.map(
    ({
      actions: _actions,
      aiNotes: _aiNotes,
      estimatedSeconds: _estimatedSeconds,
      keywords: _keywords,
      semanticCues: _semanticCues,
      speakerNotes: _speakerNotes,
      thumbnailUrl,
      title: _title,
      ...slide
    }) => ({
      ...slide,
      triggerAnimationIds:
        slide.slideId === p0AnimationDeck.slides[0]?.slideId
          ? ["anim_body_appear"]
          : [],
      ...(thumbnailUrl ? { thumbnailUrl } : {}),
      elements: slide.elements.map((element) =>
        element.type === "image"
          ? {
              ...element,
              props: {
                ...element.props,
                src: "/api/v1/presentation-companion/session_1/assets/file_image/content",
              },
            }
          : element,
      ),
    }),
  ),
});

describe("materializeCompanionDeck", () => {
  it("keeps editable Activity appearance through materialization and rendering", () => {
    const source = createDemoDeck();
    const activitySlide = createActivitySlide(source, "poll", {
      preset: "spotlight",
    });
    const snapshot = companionDeckSnapshotSchema.parse({
      deckId: source.deckId,
      projectId: source.projectId,
      version: source.version,
      canvas: source.canvas,
      theme: source.theme,
      slides: [
        {
          slideId: activitySlide.slideId,
          kind: "activity",
          order: 1,
          style: activitySlide.style,
          elements: activitySlide.elements,
          animations: [],
          triggerAnimationIds: [],
          activity: activitySlide.activity,
          activityAppearance: activitySlide.activityAppearance,
        },
      ],
    });
    const materialized = materializeCompanionDeck(snapshot);
    const html = renderToStaticMarkup(
      <CompanionAudienceRenderer
        deck={snapshot}
        output={{
          sessionId: "session_1",
          authorityEpochId: "epoch_1",
          outputRevision: 1,
          surfaceRevision: 0,
          surfaceId: "surface_1",
          outputMode: "slide",
          slideId: activitySlide.slideId,
          slideIndex: 0,
          animationStep: 0,
          canGoPrevious: false,
          canGoNext: false,
        }}
      />,
    );

    expect(materialized.slides[0]).toMatchObject({
      kind: "activity",
      activityAppearance: { mode: "editable" },
    });
    expect(html).toContain("slideshow-renderer--slide-window");
    expect(html).toContain("/activity-presets/spotlight-background.png");
    expect(html).not.toContain("청중 참여 장표");
  });

  it("restores safe rendering defaults without presenter-only content", () => {
    const deck = materializeCompanionDeck(safeDeck);

    expect(deck.slides[0]).toMatchObject({
      actions: [],
      keywords: [],
      semanticCues: [],
      speakerNotes: "",
    });
    expect(deck.slides[0]?.animations).toEqual(
      safeDeck.slides[0]?.animations,
    );
    expect(
      deck.slides[0]?.elements.find((element) => element.type === "image"),
    ).toMatchObject({
      props: {
        src: "/api/v1/presentation-companion/session_1/assets/file_image/content",
      },
    });
    expect(JSON.stringify(deck)).not.toContain("첫 문장입니다");
    expect(deck.slides[0]).not.toHaveProperty("triggerAnimationIds");
    expect(
      resolveCompanionTriggerAnimationIds(
        safeDeck,
        safeDeck.slides[0]!.slideId,
        0,
      ),
    ).toEqual(["anim_body_appear"]);
  });

  it("renders the safe slide and animation step through the audience renderer", () => {
    const html = renderToStaticMarkup(
      <CompanionAudienceRenderer
        deck={safeDeck as CompanionDeckSnapshot}
        output={{
          sessionId: "session_1",
          authorityEpochId: "epoch_1",
          outputRevision: 4,
          surfaceRevision: 0,
          surfaceId: "surface_1",
          outputMode: "slide",
          slideId: safeDeck.slides[0]!.slideId,
          slideIndex: 0,
          animationStep: 1,
          canGoNext: true,
          canGoPrevious: false,
        }}
      />,
    );

    expect(html).toContain('data-output-revision="4"');
    expect(html).toContain('data-step-index="1"');
    expect(html).toContain(safeDeck.slides[0]!.slideId);
    expect(html).not.toContain("첫 문장입니다");
  });

  it("removes the renderer and drawing surface in black mode", () => {
    const html = renderToStaticMarkup(
      <CompanionAudienceRenderer
        deck={safeDeck}
        output={{
          sessionId: "session_1",
          authorityEpochId: "epoch_1",
          outputRevision: 5,
          outputMode: "black",
          slideId: safeDeck.slides[0]!.slideId,
          slideIndex: 0,
          animationStep: 1,
          canGoNext: false,
          canGoPrevious: false,
        }}
      />,
    );

    expect(html).toContain("audience-output-black");
    expect(html).not.toContain("slideshow-renderer");
    expect(html).not.toContain("canvas");
  });
});
