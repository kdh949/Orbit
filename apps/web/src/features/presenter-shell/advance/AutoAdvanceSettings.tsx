import { Minus, Plus } from "lucide-react";
import {
  autoAdvanceThresholdSteps,
  formatAutoAdvanceThresholdPercent,
  normalizeAutoAdvanceThreshold
} from "../../../runtime/presentation/advance/autoAdvanceConfig";
import type {
  PresenterAdvancePolicySettings,
  PresenterSettingsUpdater
} from "../../rehearsal/settings/presenterSettings";

export function AutoAdvanceSettings(props: {
  policy: PresenterAdvancePolicySettings;
  saveSettings: (updater: PresenterSettingsUpdater) => void;
}) {
  const threshold = normalizeAutoAdvanceThreshold(props.policy.threshold);
  const thresholdIndex = autoAdvanceThresholdSteps.indexOf(threshold);

  const updatePolicy = (patch: Partial<PresenterAdvancePolicySettings>) => {
    props.saveSettings((current) => ({
      advancePolicy: {
        ...current.advancePolicy,
        ...patch
      }
    }));
  };

  return (
    <section className="auto-advance-settings" aria-label="자동 전환 설정">
      <label className="auto-advance-toggle">
        <input
          checked={props.policy.rehearsal}
          type="checkbox"
          onChange={(event) => updatePolicy({ rehearsal: event.target.checked })}
        />
        <span>리허설 자동 전환</span>
      </label>
      <label className="auto-advance-toggle">
        <input
          checked={props.policy.live}
          type="checkbox"
          onChange={(event) => updatePolicy({ live: event.target.checked })}
        />
        <span>실전 자동 전환</span>
      </label>
      <label className="auto-advance-toggle">
        <input
          checked={props.policy.semanticMatching}
          type="checkbox"
          onChange={(event) =>
            updatePolicy({ semanticMatching: event.target.checked })
          }
        />
        <span>E5 대본 따라가기</span>
      </label>
      <div className="auto-advance-threshold-stepper">
        <span>전환 기준</span>
        <button
          aria-label="자동 전환 기준 낮추기"
          disabled={thresholdIndex <= 0}
          type="button"
          onClick={() => {
            updatePolicy({
              threshold:
                autoAdvanceThresholdSteps[Math.max(0, thresholdIndex - 1)] ??
                threshold
            });
          }}
        >
          <Minus size={14} />
        </button>
        <strong>{formatAutoAdvanceThresholdPercent(threshold)}%</strong>
        <button
          aria-label="자동 전환 기준 높이기"
          disabled={thresholdIndex >= autoAdvanceThresholdSteps.length - 1}
          type="button"
          onClick={() => {
            updatePolicy({
              threshold:
                autoAdvanceThresholdSteps[
                  Math.min(autoAdvanceThresholdSteps.length - 1, thresholdIndex + 1)
                ] ?? threshold
            });
          }}
        >
          <Plus size={14} />
        </button>
      </div>
    </section>
  );
}
