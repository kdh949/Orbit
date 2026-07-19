import type { DeckAnimation } from "@orbit/shared";

import { AnimationPanelSection } from "./AnimationPanelSection";
import { getAnimationTypeLabel } from "../utils/animationUi";
import { AnimationTimingFields } from "./AnimationTimingFields";

export function AnimationExistingEditor(props: {
  animation: DeckAnimation;
  deleteDisabledReason?: string | null;
  previousEffectSummary?: string | null;
  startModeChangeDisabledReason?: string | null;
  onDeleteAnimation: (animationId: string) => void;
  onUpdateAnimation: (
    animationId: string,
    patch: Partial<DeckAnimation>
  ) => void;
}) {
  const {
    animation,
    deleteDisabledReason = null,
    previousEffectSummary = null,
    startModeChangeDisabledReason = null,
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
        <button
          className="animation-panel-danger-button"
          disabled={Boolean(deleteDisabledReason)}
          title={deleteDisabledReason ?? undefined}
          type="button"
          onClick={() => onDeleteAnimation(animation.animationId)}
        >
          애니메이션 제거
        </button>
      </div>
    </AnimationPanelSection>
  );
}
