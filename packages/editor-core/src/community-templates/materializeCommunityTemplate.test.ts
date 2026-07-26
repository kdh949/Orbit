import { deckSchema } from "@orbit/shared/deck";
import { describe, expect, it } from "vitest";

import { createPrivateCommunityTemplateDeck } from "./communityTemplate.fixture";
import { materializeCommunityTemplate } from "./materializeCommunityTemplate";
import { sanitizeCommunityTemplate } from "./sanitizeCommunityTemplate";

describe("materializeCommunityTemplate", () => {
  it("creates a valid manual Deck with fresh IDs and remapped group references", () => {
    const snapshot = sanitizeCommunityTemplate(
      createPrivateCommunityTemplateDeck(),
    );
    const deck = materializeCommunityTemplate({
      snapshot,
      projectId: "project_materialized",
      title: "새 템플릿 프로젝트",
    });

    expect(deckSchema.safeParse(deck).success).toBe(true);
    expect(deck.projectId).toBe("project_materialized");
    expect(deck.title).toBe("새 템플릿 프로젝트");
    expect(deck.version).toBe(1);
    expect(deck.metadata.sourceType).toBe("manual");
    expect(deck.deckId).toMatch(/^deck_/);
    expect(deck.slides.map((slide) => slide.slideId)).not.toEqual(
      snapshot.slides.map((slide) => slide.slideId),
    );

    const sourceGroup = snapshot.slides[0]!.elements.find(
      (element) => element.type === "group",
    );
    const materializedGroup = deck.slides[0]!.elements.find(
      (element) => element.type === "group",
    );
    expect(sourceGroup?.type).toBe("group");
    expect(materializedGroup?.type).toBe("group");
    if (sourceGroup?.type === "group" && materializedGroup?.type === "group") {
      expect(materializedGroup.props.childElementIds).not.toEqual(
        sourceGroup.props.childElementIds,
      );
      expect(
        materializedGroup.props.childElementIds.every((childId) =>
          deck.slides[0]!.elements.some(
            (element) => element.elementId === childId,
          ),
        ),
      ).toBe(true);
    }
  });

  it("issues different Deck, slide, and element IDs on every use", () => {
    const snapshot = sanitizeCommunityTemplate(
      createPrivateCommunityTemplateDeck(),
    );
    const first = materializeCommunityTemplate({
      snapshot,
      projectId: "project_first",
      title: "첫 번째",
    });
    const second = materializeCommunityTemplate({
      snapshot,
      projectId: "project_second",
      title: "두 번째",
    });

    expect(first.deckId).not.toBe(second.deckId);
    expect(first.slides.map((slide) => slide.slideId)).not.toEqual(
      second.slides.map((slide) => slide.slideId),
    );
    expect(
      first.slides.flatMap((slide) =>
        slide.elements.map((element) => element.elementId),
      ),
    ).not.toEqual(
      second.slides.flatMap((slide) =>
        slide.elements.map((element) => element.elementId),
      ),
    );
  });
});
