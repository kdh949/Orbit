import type { DeckAnimation, DeckElement } from "@orbit/shared";

export const supportedAnimationCards = [
  {
    value: "fade-in",
    label: "페이드 인",
    description: "요소가 부드럽게 나타나는 효과",
    authoringSupported: true
  },
  {
    value: "fade-out",
    label: "페이드 아웃",
    description: "요소가 부드럽게 사라지는 효과",
    authoringSupported: false
  }
] as const;

export type AnimationSummary = {
  detail: string;
  label: string;
  tone: "active" | "muted";
};

export function getAnimationTypeLabel(type: DeckAnimation["type"]) {
  switch (type) {
    case "fade-in":
      return "페이드 인";
    case "fade-out":
      return "페이드 아웃";
    case "appear":
      return "나타나기";
    case "disappear":
      return "사라지기";
    case "zoom-in":
      return "줌 인";
    case "zoom-out":
      return "줌 아웃";
    case "rotate":
      return "회전";
  }
}

export function getAnimationElementLabel(element: DeckElement) {
  switch (element.type) {
    case "text":
      return "텍스트";
    case "image":
      return "이미지";
    case "chart":
      return "차트";
    case "customShape":
      return "자유 도형";
    case "group":
      return "그룹";
    default:
      return "도형";
  }
}

export function buildAnimationSummary(
  animations: DeckAnimation[],
  options: {
    emptyLabel: string;
    multiLabel?: (count: number) => string;
    multiDetail?: (primaryLabel: string, count: number) => string;
  }
): AnimationSummary {
  if (animations.length === 0) {
    return {
      detail: "아직 연결된 애니메이션이 없습니다.",
      label: options.emptyLabel,
      tone: "muted"
    };
  }

  const primaryAnimation = animations[0];
  const primaryLabel = getAnimationTypeLabel(primaryAnimation.type);

  if (animations.length === 1) {
    return {
      detail: `${primaryLabel} 1개가 연결되어 있습니다.`,
      label: primaryLabel,
      tone: "active"
    };
  }

  return {
    detail: options.multiDetail
      ? options.multiDetail(primaryLabel, animations.length)
      : `${primaryLabel} 포함 ${animations.length}개 연결됨`,
    label: options.multiLabel
      ? options.multiLabel(animations.length)
      : `애니메이션 ${animations.length}개`,
    tone: "active"
  };
}

export function formatAnimationSeconds(value: number) {
  return `${(value / 1000).toFixed(1)}s`;
}

export function formatAnimationTimingSummary(animation: DeckAnimation) {
  return `${formatAnimationSeconds(animation.durationMs)} · 지연 ${formatAnimationSeconds(animation.delayMs)}`;
}

export function buildSlideAnimationOrdinalLabelMap(
  animations: DeckAnimation[]
) {
  return Object.fromEntries(
    sortAnimationsByLogicalOrder(animations).map(({ animation }, index) => [
        animation.animationId,
        `${index + 1}번째`
      ])
  );
}

export function getPreviousSlideAnimation(
  animations: DeckAnimation[],
  animationId: string
) {
  const sorted = sortAnimationsByLogicalOrder(animations);
  const animationIndex = sorted.findIndex(
    ({ animation }) => animation.animationId === animationId
  );
  return animationIndex > 0
    ? sorted[animationIndex - 1]?.animation ?? null
    : null;
}

function sortAnimationsByLogicalOrder(animations: DeckAnimation[]) {
  return animations
    .map((animation, sourceIndex) => ({ animation, sourceIndex }))
    .sort((left, right) => {
      if (left.animation.order !== right.animation.order) {
        return left.animation.order - right.animation.order;
      }
      if (left.sourceIndex !== right.sourceIndex) {
        return left.sourceIndex - right.sourceIndex;
      }
      return left.animation.animationId.localeCompare(
        right.animation.animationId
      );
    });
}

export function formatPreviousAnimationSummary(
  animation: DeckAnimation,
  ordinalLabelByAnimationId: Record<string, string>
) {
  return `선행 효과: ${getAnimationTypeLabel(animation.type)} · ${ordinalLabelByAnimationId[animation.animationId] ?? "순서 미정"}`;
}

export function isSupportedAnimationType(
  type: DeckAnimation["type"]
): type is (typeof supportedAnimationCards)[number]["value"] {
  return type === "fade-in" || type === "fade-out";
}

export function getLinkedSupportedAnimationTypes(animations: DeckAnimation[]) {
  return animations
    .map((animation) => animation.type)
    .filter(isSupportedAnimationType);
}
