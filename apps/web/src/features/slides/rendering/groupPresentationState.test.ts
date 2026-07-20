import type { DeckElement, Slide } from "@orbit/shared";
import { describe, expect, it } from "vitest";
import { p0AnimationDeck } from "../../rehearsal/presenter/__fixtures__/animationDeck";
import { resolveGroupedElementPresentationStates } from "./groupPresentationState";

const slide = p0AnimationDeck.slides[0]!;
const sourceGroup = slide.elements.find(
  (element): element is Extract<DeckElement, { type: "group" }> =>
    element.elementId === "el_group" && element.type === "group",
);

if (!sourceGroup) {
  throw new Error("group fixture is invalid");
}

describe("resolveGroupedElementPresentationStates", () => {
  it("composes a group's opacity and visibility into each direct child", () => {
    const states = resolveGroupedElementPresentationStates({
      elementStates: {
        el_group: { opacity: 0.5, visible: true },
        el_group_label: { opacity: 0.6, visible: true },
        el_group_rect: { opacity: 0.8, visible: true },
      },
      slide,
    });

    expect(states.el_group_rect).toMatchObject({ opacity: 0.4, visible: true });
    expect(states.el_group_label).toMatchObject({
      opacity: 0.3,
      visible: true,
    });
  });

  it("hides descendants when an ancestor group is hidden", () => {
    const states = resolveGroupedElementPresentationStates({
      elementStates: {
        el_group: { opacity: 1, visible: false },
      },
      slide,
    });

    expect(states.el_group_rect).toMatchObject({ opacity: 1, visible: false });
    expect(states.el_group_label).toMatchObject({ opacity: 1, visible: false });
  });

  it("composes nested groups once and terminates malformed cycles", () => {
    const nestedGroup = createGroup("el_nested_group", [
      "el_group_rect",
      "el_cycle_group",
    ]);
    const cycleGroup = createGroup("el_cycle_group", ["el_nested_group"]);
    const nestedSlide: Slide = {
      ...slide,
      elements: [
        ...slide.elements.filter((element) => element.elementId !== "el_group"),
        {
          ...sourceGroup,
          props: { childElementIds: [nestedGroup.elementId] },
        },
        nestedGroup,
        cycleGroup,
      ],
    };

    const states = resolveGroupedElementPresentationStates({
      elementStates: {
        el_cycle_group: { opacity: 0.5, visible: true },
        el_group: { opacity: 0.5, visible: true },
        el_group_rect: { opacity: 0.8, visible: true },
        el_nested_group: { opacity: 0.5, visible: true },
      },
      slide: nestedSlide,
    });

    expect(states.el_group_rect).toMatchObject({ opacity: 0.1, visible: true });
  });
});

function createGroup(
  elementId: string,
  childElementIds: string[],
): DeckElement {
  return {
    elementId,
    height: 160,
    locked: false,
    opacity: 1,
    props: { childElementIds },
    role: "decoration",
    rotation: 0,
    type: "group",
    visible: true,
    width: 390,
    x: 96,
    y: 390,
    zIndex: 10,
  };
}
