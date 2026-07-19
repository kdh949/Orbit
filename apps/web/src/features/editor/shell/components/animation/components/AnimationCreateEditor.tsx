import { AnimationPanelSection } from "./AnimationPanelSection";
import { getAnimationTypeLabel } from "../utils/animationUi";
import { AnimationTimingFields } from "./AnimationTimingFields";
import type {
  AnimationDraftInput,
  AnimationTimingDraft,
  SupportedAnimationType
} from "../types";

export function AnimationCreateEditor(props: {
  canCreateAnimation: boolean;
  draft: AnimationTimingDraft;
  keywordTriggerRestrictionMessage?: string | null;
  keywordTriggerWarningMessage?: string | null;
  selectedKeywordId: string | null;
  selectedKeywordLabel: string | null;
  selectedKeywordOccurrenceId?: string | null;
  type: SupportedAnimationType;
  onAddAnimation: (
    draft: AnimationDraftInput,
    keywordId?: string | null,
    keywordOccurrenceId?: string | null
  ) => void;
  onDraftChange: (patch: Partial<AnimationTimingDraft>) => void;
}) {
  const {
    canCreateAnimation,
    draft,
    keywordTriggerRestrictionMessage = null,
    keywordTriggerWarningMessage = null,
    selectedKeywordId,
    selectedKeywordLabel,
    selectedKeywordOccurrenceId = null,
    type,
    onAddAnimation,
    onDraftChange
  } = props;
  const canSubmit =
    canCreateAnimation && !keywordTriggerRestrictionMessage;
  const hasKeywordTrigger = Boolean(selectedKeywordId);
  const startMode = hasKeywordTrigger ? "on-click" : draft.startMode;

  return (
    <AnimationPanelSection
      action={
        <span className="animation-inspector-status-pill active">
          {getAnimationTypeLabel(type)}
        </span>
      }
      className="animation-panel-form-card"
      title="새 애니메이션 추가"
    >
      <p className="animation-panel-section-note">
        {selectedKeywordLabel
          ? `선택된 키워드 "${selectedKeywordLabel}"로 음성 트리거를 함께 생성합니다.`
          : "키워드를 선택하지 않으면 일반 애니메이션만 추가됩니다."}
      </p>
      {keywordTriggerRestrictionMessage ? (
        <div className="animation-editor-warning">
          {keywordTriggerRestrictionMessage}
        </div>
      ) : null}
      {!keywordTriggerRestrictionMessage && keywordTriggerWarningMessage ? (
        <div className="animation-editor-warning">
          {keywordTriggerWarningMessage}
        </div>
      ) : null}
      <AnimationTimingFields
        delayMs={draft.delayMs}
        durationMs={draft.durationMs}
        startMode={startMode}
        startModeChangeDisabledReason={
          hasKeywordTrigger
            ? "키워드 action과 연결된 효과는 클릭할 때 시작합니다."
            : null
        }
        onDelayChange={(delayMs) => onDraftChange({ delayMs })}
        onDurationChange={(durationMs) => onDraftChange({ durationMs })}
        onStartModeChange={(nextStartMode) =>
          onDraftChange({ startMode: nextStartMode })
        }
      />
      <div className="animation-panel-timing-actions">
        <button
          className="animation-panel-primary-button"
          disabled={!canSubmit}
          type="button"
          onClick={() =>
            onAddAnimation({
              delayMs: draft.delayMs,
              durationMs: draft.durationMs,
              startMode,
              type
            }, selectedKeywordId, selectedKeywordOccurrenceId)
          }
        >
          애니메이션 추가
        </button>
      </div>
    </AnimationPanelSection>
  );
}
