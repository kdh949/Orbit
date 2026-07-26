import { describe, expect, it } from "vitest";
import { createDemoDeck } from "@orbit/editor-core";
import type { DeckPatch } from "@orbit/shared/deck";

import { useEditorSlideCommands } from "./useEditorSlideCommands";

describe("useEditorSlideCommands", () => {
  it("keeps a selected speaker-note occurrence when the same token is selected again", () => {
    let selectedKeywordId: string | null = null;
    let selectedKeywordOccurrenceKey: string | null = null;
    const commands = useEditorSlideCommands({
      setSelectedKeywordId: (updater) => {
        selectedKeywordId = typeof updater === "function"
          ? updater(selectedKeywordId)
          : updater;
      },
      setSelectedKeywordOccurrenceKey: (updater) => {
        selectedKeywordOccurrenceKey = typeof updater === "function"
          ? updater(selectedKeywordOccurrenceKey)
          : updater;
      }
    } as Parameters<typeof useEditorSlideCommands>[0]);

    commands.selectKeyword("kw_ai", "kwo_slide_1_kw_ai_10_12");
    commands.selectKeyword("kw_ai", "kwo_slide_1_kw_ai_10_12");

    expect(selectedKeywordId).toBe("kw_ai");
    expect(selectedKeywordOccurrenceKey).toBe("kwo_slide_1_kw_ai_10_12");
  });

  it("deletes an action-linked animation as a single timeline-root patch", () => {
    const deck = createDemoDeck();
    const slide = {
      ...deck.slides[0]!,
      animations: [
        {
          animationId: "anim_root",
          elementId: "el_1",
          order: 1,
          type: "fade-in" as const,
          startMode: "on-click" as const,
          durationMs: 400,
          delayMs: 0,
          easing: "ease-out" as const
        },
        {
          animationId: "anim_follower",
          elementId: "el_2",
          order: 2,
          type: "fade-in" as const,
          startMode: "with-previous" as const,
          durationMs: 400,
          delayMs: 0,
          easing: "ease-out" as const
        }
      ],
      actions: [
        {
          actionId: "act_1",
          trigger: { kind: "keyword" as const, keywordId: "kw_1" },
          effect: {
            kind: "play-animation" as const,
            animationId: "anim_follower"
          }
        }
      ]
    };
    const actionLinkedDeck = { ...deck, slides: [slide, ...deck.slides.slice(1)] };
    let committedPatch: DeckPatch | null = null;
    const commands = useEditorSlideCommands({
      commitPatch: (patch) => {
        committedPatch = typeof patch === "function" ? patch(actionLinkedDeck) : patch;
        return true;
      },
      currentSlide: slide,
      currentSlideKeywordUsage: {},
      deck: actionLinkedDeck,
      selectedKeywordId: null,
      selectedKeywordOccurrenceKey: null,
      setAnimationPanelFocusedAnimationId: () => undefined,
      setLastPatchLabel: () => undefined,
      setSelectedKeywordId: () => undefined,
      setSelectedKeywordOccurrenceKey: () => undefined,
      workingDeckRef: { current: actionLinkedDeck }
    });

    commands.deleteAnimation(slide.slideId, "anim_root");

    expect(committedPatch).toMatchObject({
      operations: [
        { type: "delete_slide_action", actionId: "act_1" },
        { type: "delete_animation", animationId: "anim_root" },
        { type: "delete_animation", animationId: "anim_follower" }
      ]
    });
  });

  it("refuses a keyword animation without a selected speaker-note occurrence", () => {
    const deck = createDemoDeck();
    const slide = deck.slides[0]!;
    let committed = false;
    let lastPatchLabel = "";
    const commands = useEditorSlideCommands({
      commitPatch: () => {
        committed = true;
        return true;
      },
      currentSlide: slide,
      currentSlideKeywordUsage: {},
      deck,
      selectedKeywordId: slide.keywords[0]?.keywordId ?? null,
      selectedKeywordOccurrenceKey: null,
      setAnimationPanelFocusedAnimationId: () => undefined,
      setLastPatchLabel: (label) => {
        lastPatchLabel = label;
      },
      setSelectedKeywordId: () => undefined,
      setSelectedKeywordOccurrenceKey: () => undefined,
      workingDeckRef: { current: deck }
    });

    commands.addAnimation(
      slide.slideId,
      "el_1",
      slide.keywords[0]?.keywordId,
      null,
      { type: "fade-in" }
    );

    expect(committed).toBe(false);
    expect(lastPatchLabel).toContain("발표 메모");
  });

  it("creates the animation and occurrence action in one patch", () => {
    const deck = createDemoDeck();
    const slide = deck.slides[0]!;
    const keywordId = slide.keywords[0]!.keywordId;
    const occurrenceId = "kwo_slide_1_kw_1_0_5";
    let committedOperations: DeckPatch["operations"] = [];
    const commands = useEditorSlideCommands({
      commitPatch: (patch) => {
        const committedPatch =
          typeof patch === "function" ? patch(deck) : patch;
        committedOperations = committedPatch.operations;
        return true;
      },
      currentSlide: slide,
      currentSlideKeywordUsage: {},
      deck,
      selectedKeywordId: keywordId,
      selectedKeywordOccurrenceKey: occurrenceId,
      setAnimationPanelFocusedAnimationId: () => undefined,
      setLastPatchLabel: () => undefined,
      setSelectedKeywordId: () => undefined,
      setSelectedKeywordOccurrenceKey: () => undefined,
      workingDeckRef: { current: deck }
    });

    commands.addAnimation(
      slide.slideId,
      "el_1",
      keywordId,
      occurrenceId,
      { type: "fade-in" }
    );

    expect(committedOperations).toHaveLength(2);
    expect(committedOperations[0]).toMatchObject({
      type: "add_animation",
      slideId: slide.slideId
    });
    expect(committedOperations[1]).toMatchObject({
      type: "add_slide_action",
      action: {
        trigger: {
          kind: "keyword-occurrence",
          keywordId,
          occurrenceId
        },
        effect: { kind: "play-animation" }
      }
    });
  });
});
