import type { DeckElement, Slide } from "@orbit/shared";
import { describe, expect, it } from "vitest";

import {
  createMorphTransitionPlan,
  easeInOutCubic,
  interpolateMorphFrames,
  isMorphGeometryEligible
} from "./morphTransition";

function createElement(
  elementId: string,
  overrides: Partial<DeckElement> = {}
): DeckElement {
  return {
    elementId,
    type: "rect",
    x: 0,
    y: 0,
    width: 100,
    height: 80,
    rotation: 0,
    opacity: 1,
    zIndex: 0,
    locked: false,
    visible: true,
    props: {
      fill: "#FFFFFF",
      stroke: "transparent",
      strokeWidth: 0,
      borderRadius: 0
    },
    ...overrides
  } as DeckElement;
}

function createSlide(slideId: string, elements: DeckElement[]): Slide {
  return {
    kind: "content",
    slideId,
    order: slideId === "slide_1" ? 1 : 2,
    title: "",
    thumbnailUrl: "",
    style: {},
    speakerNotes: "",
    elements,
    keywords: [],
    semanticCues: [],
    animations: [],
    actions: []
  };
}

describe("morph transition plan", () => {
  it("matches eligible elements by their effective morph key", () => {
    const source = createElement("el_source");
    const destination = createElement("el_destination", {
      morphKey: "el_source",
      type: "ellipse"
    });
    const plan = createMorphTransitionPlan(
      createSlide("slide_1", [source]),
      createSlide("slide_2", [destination])
    );

    expect(plan.pairs).toMatchObject([
      {
        matchKey: "el_source",
        sourceElementId: "el_source",
        destinationElementId: "el_destination"
      }
    ]);
    expect(plan.sourceUnmatchedElementIds).toEqual([]);
    expect(plan.destinationUnmatchedElementIds).toEqual([]);
  });

  it("leaves charts, groups, backgrounds, QR and invisible elements unmatched", () => {
    const excluded = [
      createElement("el_chart", {
        type: "chart",
        props: {
          type: "bar",
          title: "",
          data: [{ label: "A", value: 1 }],
          style: {
            colors: [],
            showLegend: true,
            legendPosition: "bottom",
            showDataLabels: false,
            showGrid: true,
            xAxisTitle: "",
            yAxisTitle: "",
            unit: ""
          }
        }
      }),
      createElement("el_group", {
        type: "group",
        props: { childElementIds: [] }
      }),
      createElement("el_background", { role: "background" }),
      createElement("el_qr", {
        type: "activity-qr",
        props: { activityId: "activity_1" }
      }),
      createElement("el_hidden", { visible: false })
    ];

    expect(excluded.every((element) => !isMorphGeometryEligible(element))).toBe(
      true
    );
    const plan = createMorphTransitionPlan(
      createSlide("slide_1", excluded),
      createSlide(
        "slide_2",
        excluded.map((element, index) =>
          createElement(`el_destination_${index}`, {
            ...element,
            elementId: `el_destination_${index}`,
            morphKey: element.elementId
          })
        )
      )
    );
    expect(plan.pairs).toEqual([]);
  });

  it("does not pair an ambiguous duplicate match key", () => {
    const plan = createMorphTransitionPlan(
      createSlide("slide_1", [
        createElement("el_source_1", { morphKey: "el_shared" }),
        createElement("el_source_2", { morphKey: "el_shared" })
      ]),
      createSlide("slide_2", [
        createElement("el_destination", { morphKey: "el_shared" })
      ])
    );

    expect(plan.pairs).toEqual([]);
    expect(plan.diagnostics).toEqual([
      { code: "duplicate-source-match-key", matchKey: "el_shared" }
    ]);
  });
});

describe("morph frame interpolation", () => {
  const plan = createMorphTransitionPlan(
    createSlide("slide_1", [
      createElement("el_source", {
        x: 0,
        y: 20,
        width: 100,
        height: 80,
        rotation: 350,
        opacity: 0.4
      })
    ]),
    createSlide("slide_2", [
      createElement("el_destination", {
        morphKey: "el_source",
        x: 200,
        y: 120,
        width: 300,
        height: 180,
        rotation: 10,
        opacity: 0.8
      })
    ])
  );

  it("keeps exact source and destination frames at the boundaries", () => {
    expect(interpolateMorphFrames(plan, 0).source.el_source).toEqual({
      x: 0,
      y: 20,
      width: 100,
      height: 80,
      rotation: 350
    });
    expect(
      interpolateMorphFrames(plan, 1).destination.el_destination
    ).toEqual({
      x: 200,
      y: 120,
      width: 300,
      height: 180,
      rotation: 10
    });
  });

  it("uses cubic easing and the shortest rotation direction", () => {
    const frames = interpolateMorphFrames(plan, 0.5);

    expect(frames.easedProgress).toBe(0.5);
    expect(frames.source.el_source).toEqual({
      x: 100,
      y: 70,
      width: 200,
      height: 130,
      rotation: 360
    });
    expect(frames.destination.el_destination).toEqual(
      frames.source.el_source
    );
    expect(frames.source.el_source).not.toHaveProperty("opacity");
    expect(easeInOutCubic(0.25)).toBe(0.0625);
  });

  it("clamps invalid progress to a safe boundary", () => {
    expect(interpolateMorphFrames(plan, Number.NaN).progress).toBe(0);
    expect(interpolateMorphFrames(plan, 2).progress).toBe(1);
  });
});
