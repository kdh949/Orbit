import type { DeckAnimation, DeckElement } from "@orbit/shared/deck";
import { IconTrash } from "@tabler/icons-react";

import { IdBadge } from "../../EditorIdBadge";
import { AnimationPanelSection } from "./AnimationPanelSection";
import {
  formatAnimationTimingSummary,
  getAnimationElementLabel,
  getAnimationTypeLabel
} from "../utils/animationUi";

function getAnimationTargetLabel(
  animation: DeckAnimation,
  elements: DeckElement[]
) {
  const targetElement = elements.find(
    (element) => element.elementId === animation.elementId
  );

  if (!targetElement) {
    return "대상 요소 없음";
  }

  return getAnimationElementLabel(targetElement);
}

export function AnimationSlideOverview(props: {
  animations: DeckAnimation[];
  elements: DeckElement[];
  deleteDisabledReason?: string | null;
  deleteNoticeByAnimationId?: Record<string, string | undefined>;
  focusedAnimationId?: string | null;
  ordinalLabelByAnimationId: Record<string, string>;
  onDeleteAnimation: (animationId: string) => void;
  onSelectAnimation: (animation: DeckAnimation) => void;
  showIds: boolean;
}) {
  const {
    animations,
    deleteDisabledReason = null,
    deleteNoticeByAnimationId = {},
    elements,
    focusedAnimationId = null,
    ordinalLabelByAnimationId,
    onDeleteAnimation,
    onSelectAnimation,
    showIds
  } = props;

  return (
    <AnimationPanelSection
      action={
        <span className="animation-inspector-status-pill active">
          {animations.length}개
        </span>
      }
      className="animation-panel-overview-section"
      title="이 슬라이드의 애니메이션"
    >
      {animations.length > 0 ? (
        <div className="animation-panel-existing-list">
          {animations.map((animation) => {
            const isSelected = focusedAnimationId === animation.animationId;

            const deleteNotice = deleteNoticeByAnimationId[animation.animationId];

            return (
              <div className="animation-panel-existing-row" key={animation.animationId}>
              <button
                className={`animation-panel-existing-item${isSelected ? " selected" : ""}`}
                type="button"
                onClick={() => onSelectAnimation(animation)}
              >
                <div className="animation-panel-existing-main">
                  <strong>{getAnimationTypeLabel(animation.type)}</strong>
                  <span>
                    {getAnimationTargetLabel(animation, elements)} ·{" "}
                    {formatAnimationTimingSummary(animation)}
                  </span>
                </div>
                <div className="animation-panel-existing-side">
                  <span
                    className="animation-panel-existing-order"
                    aria-label={`슬라이드 애니메이션 순서 ${ordinalLabelByAnimationId[animation.animationId] ?? "미정"}`}
                  >
                    {ordinalLabelByAnimationId[animation.animationId] ?? "미정"}
                  </span>
                  {showIds ? <IdBadge id={animation.animationId} /> : null}
                </div>
              </button>
              <button
                aria-label={`${getAnimationTypeLabel(animation.type)} 애니메이션 삭제`}
                className="animation-panel-existing-delete"
                disabled={Boolean(deleteDisabledReason)}
                title={deleteDisabledReason ?? deleteNotice}
                type="button"
                onClick={() => onDeleteAnimation(animation.animationId)}
              >
                <IconTrash aria-hidden="true" size={15} />
              </button>
            </div>
            );
          })}
        </div>
      ) : (
        <div className="animation-panel-empty">
          <strong>이 슬라이드에 연결된 애니메이션이 없습니다.</strong>
          <p>요소를 선택한 뒤 페이드 인 또는 페이드 아웃을 추가할 수 있습니다.</p>
        </div>
      )}
    </AnimationPanelSection>
  );
}
