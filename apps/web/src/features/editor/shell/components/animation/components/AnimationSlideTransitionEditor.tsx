import type { SlideTransition } from "@orbit/shared";

import { AnimationPanelSection } from "./AnimationPanelSection";
import { AnimationRangeField } from "./AnimationRangeField";

const defaultFadeDurationMs = 700;

export function AnimationSlideTransitionEditor(props: {
  mutationDisabledReason?: string | null;
  transition?: SlideTransition;
  onUpdateTransition: (transition: SlideTransition | null) => void;
}) {
  const {
    mutationDisabledReason = null,
    transition,
    onUpdateTransition
  } = props;

  return (
    <section className="property-panel animation-transition-panel">
      <AnimationPanelSection
        action={
          <span
            className={`animation-inspector-status-pill ${transition ? "active" : "muted"}`}
          >
            {transition ? "페이드" : "없음"}
          </span>
        }
        className="animation-panel-form-card"
        title="슬라이드 전환"
      >
        {mutationDisabledReason ? (
          <div className="animation-editor-warning" role="status">
            {mutationDisabledReason}
          </div>
        ) : null}
        <fieldset
          disabled={Boolean(mutationDisabledReason)}
          style={{ display: "contents" }}
          title={mutationDisabledReason ?? undefined}
        >
          <label className="animation-start-mode-field">
            <strong>전환 효과</strong>
            <select
              aria-label="슬라이드 전환 효과"
              value={transition?.type ?? "none"}
              onChange={(event) =>
                onUpdateTransition(
                  event.currentTarget.value === "fade"
                    ? {
                        type: "fade",
                        durationMs:
                          transition?.durationMs ?? defaultFadeDurationMs
                      }
                    : null
                )
              }
            >
              <option value="none">전환 없음</option>
              <option value="fade">페이드</option>
            </select>
          </label>
          {transition ? (
            <AnimationRangeField
              label="전환 시간"
              max={3000}
              min={100}
              value={transition.durationMs}
              onCommit={(durationMs) =>
                onUpdateTransition({ type: "fade", durationMs })
              }
            />
          ) : null}
          <div className="animation-panel-timing-actions">
            <button
              className="animation-panel-danger-button"
              disabled={!transition}
              type="button"
              onClick={() => onUpdateTransition(null)}
            >
              전환 제거
            </button>
          </div>
        </fieldset>
      </AnimationPanelSection>
    </section>
  );
}
