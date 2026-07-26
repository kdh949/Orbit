import { communityTemplateSnapshotSchema } from "@orbit/shared/community-templates";
import { deckSchema } from "@orbit/shared/deck";
import type {
  CommunityTemplateElement,
  CommunityTemplateSnapshot,
} from "@orbit/shared/community-templates";
import type { Deck } from "@orbit/shared/deck";

export type MaterializeCommunityTemplateInput = {
  snapshot: CommunityTemplateSnapshot;
  projectId: string;
  title: string;
};

export function materializeCommunityTemplate(
  input: MaterializeCommunityTemplateInput,
): Deck {
  const snapshot = communityTemplateSnapshotSchema.parse(input.snapshot);
  const slideIds = new Map(
    snapshot.slides.map((slide) => [slide.slideId, createId("slide_")]),
  );

  return deckSchema.parse({
    deckId: createId("deck_"),
    projectId: input.projectId,
    title: input.title,
    version: 1,
    metadata: {
      language: "ko",
      locale: "ko-KR",
      sourceType: "manual",
    },
    targetDurationMinutes: snapshot.targetDurationMinutes,
    canvas: structuredClone(snapshot.canvas),
    theme: structuredClone(snapshot.theme),
    slides: snapshot.slides.map((slide) => {
      const elementIds = new Map(
        slide.elements.map((element) => [element.elementId, createId("el_")]),
      );
      return {
        kind: "content",
        slideId: requireMappedId(slideIds, slide.slideId),
        order: slide.order,
        title: slide.title,
        style: structuredClone(slide.style),
        elements: slide.elements.map((element) =>
          materializeElement(element, elementIds),
        ),
      };
    }),
  });
}

function materializeElement(
  element: CommunityTemplateElement,
  elementIds: ReadonlyMap<string, string>,
) {
  const elementId = requireMappedId(elementIds, element.elementId);
  if (element.type !== "group") {
    return { ...structuredClone(element), elementId };
  }

  return {
    ...structuredClone(element),
    elementId,
    props: {
      childElementIds: element.props.childElementIds.map((childId) =>
        requireMappedId(elementIds, childId),
      ),
    },
  };
}

function requireMappedId(
  ids: ReadonlyMap<string, string>,
  sourceId: string,
): string {
  const id = ids.get(sourceId);
  if (!id) throw new Error("COMMUNITY_TEMPLATE_SANITIZATION_FAILED");
  return id;
}

function createId(prefix: "deck_" | "slide_" | "el_") {
  const cryptoApi = (
    globalThis as typeof globalThis & {
      crypto?: { randomUUID?: () => string };
    }
  ).crypto;
  if (!cryptoApi?.randomUUID) {
    throw new Error("Secure random UUID generation is unavailable");
  }
  return `${prefix}${cryptoApi.randomUUID()}`;
}
