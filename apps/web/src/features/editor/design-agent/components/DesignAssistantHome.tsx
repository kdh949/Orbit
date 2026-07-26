import type { DesignAgentIntentPreset } from "@orbit/shared/deck";
import {
  IconLayoutGrid,
  IconPlayerPlay,
  IconSparkles,
  IconTargetArrow,
} from "@tabler/icons-react";

export type DesignAssistantQuickAction = {
  content: string;
  intentPreset: DesignAgentIntentPreset;
  label: string;
};

export const designAssistantQuickActions: readonly DesignAssistantQuickAction[] = [
  {
    intentPreset: "redesign-slide",
    label: "슬라이드 다시 디자인",
    content: "현재 슬라이드를 더 설득력 있게 다시 디자인해 주세요.",
  },
  {
    intentPreset: "tidy-layout",
    label: "레이아웃 정리",
    content: "현재 슬라이드의 내용은 유지하고 정렬과 간격을 정리해 주세요.",
  },
  {
    intentPreset: "emphasize-message",
    label: "핵심 메시지 강조",
    content: "현재 슬라이드의 핵심 메시지가 더 잘 보이도록 강조해 주세요.",
  },
  {
    intentPreset: "recommend-animation",
    label: "애니메이션 추천",
    content: "현재 슬라이드에 발표 흐름에 맞는 애니메이션을 추천해 주세요.",
  },
];

type DesignAssistantHomeProps = {
  disabled: boolean;
  errorMessage?: string;
  isGenerating: boolean;
  onAction: (action: DesignAssistantQuickAction) => void;
  onRetry?: () => void;
};

const secondaryIcons = [IconLayoutGrid, IconTargetArrow, IconPlayerPlay];

export function DesignAssistantHome(props: DesignAssistantHomeProps) {
  const primaryAction = designAssistantQuickActions[0]!;
  const secondaryActions = designAssistantQuickActions.slice(1);

  return (
    <section className="design-assistant-home" aria-labelledby="design-assistant-title">
      <div className="design-assistant-hero-icon" aria-hidden="true">
        <IconSparkles size={20} strokeWidth={2.2} />
      </div>
      <div className="design-assistant-home-copy">
        <h2 id="design-assistant-title">이 슬라이드를 더 설득력 있게</h2>
        <p>내용은 유지하면서 현재 장표에 어울리는 디자인 제안을 준비해 드려요.</p>
      </div>

      <button
        aria-busy={props.isGenerating || undefined}
        className="design-assistant-primary-action"
        disabled={props.disabled || props.isGenerating}
        type="button"
        onClick={() => props.onAction(primaryAction)}
      >
        <IconSparkles aria-hidden="true" size={18} />
        <span>{props.isGenerating ? "디자인 제안 생성 중..." : primaryAction.label}</span>
      </button>

      <div className="design-assistant-secondary-actions" aria-label="빠른 디자인 동작">
        {secondaryActions.map((action, index) => {
          const ActionIcon = secondaryIcons[index];
          return (
            <button
              key={action.intentPreset}
              disabled={props.disabled || props.isGenerating}
              type="button"
              onClick={() => props.onAction(action)}
            >
              {ActionIcon ? <ActionIcon aria-hidden="true" size={16} /> : null}
              <span>{action.label}</span>
            </button>
          );
        })}
      </div>

      {props.errorMessage ? (
        <div className="design-assistant-action-error" role="alert">
          <span>{props.errorMessage}</span>
          {props.onRetry ? (
            <button type="button" disabled={props.disabled} onClick={props.onRetry}>
              다시 시도
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
