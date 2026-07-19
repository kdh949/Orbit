type JsonRecord = Record<string, unknown>;

export function normalizeLegacyAnimationStartModes(
  deckInput: unknown
): unknown {
  let deck: unknown;
  try {
    deck = structuredClone(deckInput);
  } catch {
    return deckInput;
  }
  if (!isRecord(deck) || !Array.isArray(deck.slides)) return deck;

  for (const slideInput of deck.slides) {
    if (!isRecord(slideInput) || !Array.isArray(slideInput.animations)) {
      continue;
    }
    const referencedAnimationIds = collectReferencedAnimationIds(slideInput);
    const groups = groupAnimationsByLegacyOrder(slideInput.animations);

    for (const group of groups) {
      const root = group[0];
      if (!root) continue;
      if (!hasExplicitStartMode(root)) {
        root.startMode = group.some((animation) => {
          const animationId = animation.animationId;
          return (
            typeof animationId === "string" &&
            referencedAnimationIds.has(animationId)
          );
        })
          ? "on-click"
          : "on-slide-enter";
      }
      for (const follower of group.slice(1)) {
        if (!hasExplicitStartMode(follower)) {
          follower.startMode = "with-previous";
        }
      }
    }
  }

  return deck;
}

function collectReferencedAnimationIds(slide: JsonRecord): Set<string> {
  if (!Array.isArray(slide.actions)) return new Set();
  return new Set(
    slide.actions.flatMap((action) => {
      if (!isRecord(action) || !isRecord(action.effect)) return [];
      return action.effect.kind === "play-animation" &&
        typeof action.effect.animationId === "string"
        ? [action.effect.animationId]
        : [];
    })
  );
}

function groupAnimationsByLegacyOrder(animations: unknown[]): JsonRecord[][] {
  const groups = new Map<unknown, JsonRecord[]>();
  for (const animation of animations) {
    if (!isRecord(animation)) continue;
    const order = animation.order;
    const group = groups.get(order) ?? [];
    group.push(animation);
    groups.set(order, group);
  }
  return [...groups.values()];
}

function hasExplicitStartMode(animation: JsonRecord): boolean {
  return animation.startMode !== undefined;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
