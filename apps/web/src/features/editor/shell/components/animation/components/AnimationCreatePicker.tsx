import { IconCheck as Check } from "@tabler/icons-react";

import { AnimationPanelSection } from "./AnimationPanelSection";
import { supportedAnimationCards } from "../utils/animationUi";
import type { SupportedAnimationType } from "../types";

export function AnimationCreatePicker(props: {
  creationType: SupportedAnimationType | null;
  linkedTypes: SupportedAnimationType[];
  mutationDisabledReason?: string | null;
  onStartCreating: (type: SupportedAnimationType) => void;
}) {
  const {
    creationType,
    linkedTypes,
    mutationDisabledReason = null,
    onStartCreating
  } = props;

  return (
    <AnimationPanelSection title="새 효과 추가">
      <div className="animation-panel-effect-grid">
        {supportedAnimationCards.map((card) => {
          const isLinked = linkedTypes.includes(card.value);
          const isSelected = creationType === card.value;
          const disabledReason =
            mutationDisabledReason ??
            (!card.authoringSupported
              ? "PPTX 저장 지원 전까지 추가할 수 없습니다."
              : null);

          return (
            <button
              key={card.value}
              className={`animation-panel-effect-button${isSelected ? " selected" : ""}${isLinked ? " linked" : ""}`}
              disabled={isLinked || Boolean(disabledReason)}
              title={disabledReason ?? undefined}
              type="button"
              onClick={() => onStartCreating(card.value)}
            >
              {isSelected ? (
                <span className="animation-panel-effect-check">
                  <Check size={14} />
                </span>
              ) : null}
              <span className="animation-panel-effect-icon">
                {card.label === "페이드 인" ? "IN" : "OUT"}
              </span>
              <strong>{card.label}</strong>
              <small>
                {mutationDisabledReason ??
                  (isLinked ? "이미 연결됨" : disabledReason ?? card.description)}
              </small>
            </button>
          );
        })}
      </div>
    </AnimationPanelSection>
  );
}
