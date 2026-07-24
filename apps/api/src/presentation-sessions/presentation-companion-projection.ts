import {
  companionDeckSnapshotSchema,
  type CompanionDeckSnapshot,
  type Deck,
  type DeckElement,
  type Slide,
} from "@orbit/shared";

export type PresentationCompanionProjection = {
  deck: CompanionDeckSnapshot;
  referencedAssetIds: ReadonlySet<string>;
};

export function createPresentationCompanionProjection(input: {
  deck: Deck;
  sessionId: string;
  trustedAssetOrigins?: ReadonlySet<string>;
}): PresentationCompanionProjection {
  const referencedAssetIds = new Set<string>();
  const slides = input.deck.slides.map((slide) =>
    projectSlide({
      projectId: input.deck.projectId,
      referencedAssetIds,
      sessionId: input.sessionId,
      slide,
      trustedAssetOrigins: input.trustedAssetOrigins,
    }),
  );

  return {
    deck: companionDeckSnapshotSchema.parse({
      deckId: input.deck.deckId,
      projectId: input.deck.projectId,
      version: input.deck.version,
      canvas: input.deck.canvas,
      theme: input.deck.theme,
      slides,
    }),
    referencedAssetIds,
  };
}

function projectSlide(input: {
  projectId: string;
  referencedAssetIds: Set<string>;
  sessionId: string;
  slide: Slide;
  trustedAssetOrigins?: ReadonlySet<string>;
}) {
  const elements = input.slide.elements.flatMap((element) => {
    const projected = projectElement({
      element,
      projectId: input.projectId,
      referencedAssetIds: input.referencedAssetIds,
      sessionId: input.sessionId,
      trustedAssetOrigins: input.trustedAssetOrigins,
    });
    return projected ? [projected] : [];
  });
  const elementIds = new Set(elements.map((element) => element.elementId));
  const normalizedElements = elements.map((element) =>
    element.type === "group"
      ? {
          ...element,
          props: {
            ...element.props,
            childElementIds: element.props.childElementIds.filter((elementId) =>
              elementIds.has(elementId),
            ),
          },
        }
      : element,
  );
  const backgroundImage = input.slide.style.backgroundImage
    ? projectImageSource({
        projectId: input.projectId,
        referencedAssetIds: input.referencedAssetIds,
        sessionId: input.sessionId,
        source: input.slide.style.backgroundImage.src,
        trustedAssetOrigins: input.trustedAssetOrigins,
      })
    : null;
  const styleWithoutBackground = { ...input.slide.style };
  delete styleWithoutBackground.backgroundImage;
  const thumbnailUrl = input.slide.thumbnailUrl
    ? projectImageSource({
        projectId: input.projectId,
        referencedAssetIds: input.referencedAssetIds,
        sessionId: input.sessionId,
        source: input.slide.thumbnailUrl,
        trustedAssetOrigins: input.trustedAssetOrigins,
      })
    : null;

  const base = {
    slideId: input.slide.slideId,
    kind: input.slide.kind,
    order: input.slide.order,
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
    ...(input.slide.transition ? { transition: input.slide.transition } : {}),
    style: {
      ...styleWithoutBackground,
      ...(backgroundImage && input.slide.style.backgroundImage
        ? {
            backgroundImage: {
              ...input.slide.style.backgroundImage,
              src: backgroundImage,
            },
          }
        : {}),
    },
    ...(input.slide.importRenderMode
      ? { importRenderMode: input.slide.importRenderMode }
      : {}),
    elements: normalizedElements,
    animations: input.slide.animations.filter((animation) =>
      elementIds.has(animation.elementId),
    ),
    triggerAnimationIds: getTriggerAnimationIds(input.slide, elementIds),
  };

  if (input.slide.kind === "activity") {
    return { ...base, kind: "activity" as const, activity: input.slide.activity };
  }
  if (input.slide.kind === "activity-results") {
    return {
      ...base,
      kind: "activity-results" as const,
      activityResult: input.slide.activityResult,
    };
  }
  return { ...base, kind: "content" as const };
}

function getTriggerAnimationIds(
  slide: Slide,
  projectedElementIds: ReadonlySet<string>,
) {
  const projectedAnimationIds = new Set(
    slide.animations
      .filter((animation) => projectedElementIds.has(animation.elementId))
      .map((animation) => animation.animationId),
  );
  return Array.from(
    new Set(
      slide.actions.flatMap((action) =>
        action.effect.kind === "play-animation" &&
        projectedAnimationIds.has(action.effect.animationId)
          ? [action.effect.animationId]
          : [],
      ),
    ),
  );
}

function projectElement(input: {
  element: DeckElement;
  projectId: string;
  referencedAssetIds: Set<string>;
  sessionId: string;
  trustedAssetOrigins?: ReadonlySet<string>;
}): DeckElement | null {
  if (input.element.type !== "image" && input.element.type !== "svg") {
    return input.element;
  }
  const src = projectImageSource({
    projectId: input.projectId,
    referencedAssetIds: input.referencedAssetIds,
    sessionId: input.sessionId,
    source: input.element.props.src,
    trustedAssetOrigins: input.trustedAssetOrigins,
  });
  if (!src) {
    return null;
  }
  return {
    ...input.element,
    props: { ...input.element.props, src },
  };
}

function projectImageSource(input: {
  projectId: string;
  referencedAssetIds: Set<string>;
  sessionId: string;
  source: string;
  trustedAssetOrigins?: ReadonlySet<string>;
}): string | null {
  if (input.source.startsWith("//")) {
    return null;
  }
  const internal = parseProjectAssetUrl(
    input.source,
    input.trustedAssetOrigins,
  );
  if (internal) {
    if (internal.projectId !== input.projectId) {
      return null;
    }
    input.referencedAssetIds.add(internal.fileId);
    return `/api/v1/presentation-companion/${encodeURIComponent(
      input.sessionId,
    )}/assets/${encodeURIComponent(internal.fileId)}/content`;
  }

  try {
    const parsed = new URL(input.source, "https://orbit.invalid");
    return parsed.protocol === "https:" && parsed.origin !== "https://orbit.invalid"
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

export function parseProjectAssetUrl(
  source: string,
  trustedAssetOrigins: ReadonlySet<string> = new Set(),
): { fileId: string; projectId: string } | null {
  if (source.startsWith("//")) return null;
  const placeholderOrigin = "https://orbit.invalid";
  let parsed: URL;
  try {
    parsed = new URL(source, placeholderOrigin);
  } catch {
    return null;
  }
  const isCanonicalRelative =
    source.startsWith("/") && parsed.origin === placeholderOrigin;
  const isTrustedAbsolute =
    parsed.origin !== placeholderOrigin &&
    [...trustedAssetOrigins].some((candidate) => {
      try {
        return new URL(candidate).origin === parsed.origin;
      } catch {
        return false;
      }
    });
  if (!isCanonicalRelative && !isTrustedAbsolute) {
    return null;
  }
  const match = parsed.pathname.match(
    /^\/api\/v1\/projects\/([^/]+)\/assets\/([^/]+)\/content$/,
  );
  if (!match) {
    return null;
  }
  try {
    const projectId = decodeURIComponent(match[1]);
    const fileId = decodeURIComponent(match[2]);
    return projectId && fileId ? { fileId, projectId } : null;
  } catch {
    return null;
  }
}
