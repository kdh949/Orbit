import type { DeckAnimation } from "@orbit/shared/deck";
import { IconTrash } from "@tabler/icons-react";

import { AnimationPanelSection } from "./AnimationPanelSection";
import {
  formatAnimationTimingSummary,
  getAnimationTypeLabel
} from "../utils/animationUi";

export function AnimationExistingList(props: {
  animations: DeckAnimation[];
  deleteDisabledReason?: string | null;
  deleteNoticeByAnimationId?: Record<string, string | undefined>;
  ordinalLabelByAnimationId: Record<string, string>;
  selectedAnimationId: string | null;
  onDeleteAnimation: (animationId: string) => void;
  onSelectAnimation: (animationId: string) => void;
}) {
  const {
    animations,
    deleteDisabledReason = null,
    deleteNoticeByAnimationId = {},
    ordinalLabelByAnimationId,
    selectedAnimationId,
    onDeleteAnimation,
    onSelectAnimation
  } = props;

  return (
    <AnimationPanelSection
      action={
        <span className="animation-inspector-status-pill active">
          {animations.length}개
        </span>
      }
      title="연결된 애니메이션"
    >
      <div className="animation-panel-existing-list">
        {animations.map((animation) => {
          const isSelected = animation.animationId === selectedAnimationId;

          const deleteNotice = deleteNoticeByAnimationId[animation.animationId];

          return (
            <div className="animation-panel-existing-row" key={animation.animationId}>
            <button
              className={`animation-panel-existing-item${isSelected ? " selected" : ""}`}
              type="button"
              onClick={() => onSelectAnimation(animation.animationId)}
            >
              <div className="animation-panel-existing-main">
                <strong>{getAnimationTypeLabel(animation.type)}</strong>
                <span>{formatAnimationTimingSummary(animation)}</span>
              </div>
              <span
                className="animation-panel-existing-order"
                aria-label={`슬라이드 애니메이션 순서 ${ordinalLabelByAnimationId[animation.animationId] ?? "미정"}`}
              >
                {ordinalLabelByAnimationId[animation.animationId] ?? "미정"}
              </span>
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
    </AnimationPanelSection>
  );
}
