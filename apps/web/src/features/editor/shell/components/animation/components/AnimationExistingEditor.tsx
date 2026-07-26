import type { DeckAnimation } from "@orbit/shared/deck";

import { AnimationPanelSection } from "./AnimationPanelSection";
import { getAnimationTypeLabel } from "../utils/animationUi";
import { AnimationTimingFields } from "./AnimationTimingFields";

export function AnimationExistingEditor(props: {
  animation: DeckAnimation;
  deleteNotice?: string | null;
  previousEffectSummary?: string | null;
  startModeChangeDisabledReason?: string | null;
  triggerSummary?: string | null;
  onDeleteAnimation: (animationId: string) => void;
  onUpdateAnimation: (
    animationId: string,
    patch: Partial<DeckAnimation>
  ) => void;
}) {
  const {
    animation,
    deleteNotice = null,
    previousEffectSummary = null,
    startModeChangeDisabledReason = null,
    triggerSummary = null,
    onDeleteAnimation,
    onUpdateAnimation
  } = props;

  return (
    <AnimationPanelSection
      action={
        <span className="animation-inspector-status-pill active">
          {getAnimationTypeLabel(animation.type)}
        </span>
      }
      className="animation-panel-form-card"
      title="애니메이션 수정"
    >
      {triggerSummary ? (
        <p className="animation-trigger-summary" role="status">
          {triggerSummary}
        </p>
      ) : null}
      <AnimationTimingFields
        delayMs={animation.delayMs}
        durationMs={animation.durationMs}
        previousEffectSummary={previousEffectSummary}
        startMode={animation.startMode ?? "on-click"}
        startModeChangeDisabledReason={startModeChangeDisabledReason}
        onDelayChange={(delayMs) =>
          onUpdateAnimation(animation.animationId, { delayMs })
        }
        onDurationChange={(durationMs) =>
          onUpdateAnimation(animation.animationId, { durationMs })
        }
        onStartModeChange={(startMode) =>
          onUpdateAnimation(animation.animationId, { startMode })
        }
      />
      <div className="animation-panel-timing-actions">
        {deleteNotice ? (
          <span className="animation-panel-delete-notice">{deleteNotice}</span>
        ) : null}
        <button
          className="animation-panel-danger-button"
          title={deleteNotice ?? undefined}
          type="button"
          onClick={() => onDeleteAnimation(animation.animationId)}
        >
          애니메이션 제거
        </button>
      </div>
    </AnimationPanelSection>
  );
}
