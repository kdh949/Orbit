import type { DeckAnimationStartMode } from "@orbit/shared";

import { AnimationRangeField } from "./AnimationRangeField";

const startModeOptions: Array<{
  label: string;
  value: DeckAnimationStartMode;
}> = [
  { label: "슬라이드 시작과 함께", value: "on-slide-enter" },
  { label: "클릭할 때", value: "on-click" },
  { label: "이전 효과와 함께", value: "with-previous" },
  { label: "이전 효과 다음", value: "after-previous" }
];

export function AnimationTimingFields(props: {
  delayMs: number;
  durationMs: number;
  previousEffectSummary?: string | null;
  startMode: DeckAnimationStartMode;
  startModeChangeDisabledReason?: string | null;
  onDelayChange: (value: number) => void;
  onDurationChange: (value: number) => void;
  onStartModeChange: (value: DeckAnimationStartMode) => void;
}) {
  const {
    delayMs,
    durationMs,
    previousEffectSummary = null,
    startMode,
    startModeChangeDisabledReason = null,
    onDelayChange,
    onDurationChange,
    onStartModeChange
  } = props;
  const isRelative =
    startMode === "with-previous" || startMode === "after-previous";

  return (
    <div className="animation-panel-timing-fields">
      <label className="animation-start-mode-field">
        <strong>시작 방식</strong>
        <select
          aria-label="애니메이션 시작 방식"
          disabled={Boolean(startModeChangeDisabledReason)}
          value={startMode}
          onChange={(event) =>
            onStartModeChange(
              event.currentTarget.value as DeckAnimationStartMode
            )
          }
        >
          {startModeOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {startModeChangeDisabledReason ? (
        <div className="animation-editor-warning" role="status">
          {startModeChangeDisabledReason}
        </div>
      ) : null}
      {isRelative ? (
        <p className="animation-previous-effect-summary" role="status">
          {previousEffectSummary ?? getOrphanRelativeSummary(startMode)}
        </p>
      ) : null}
      <AnimationRangeField
        label="재생 시간"
        max={2000}
        min={100}
        value={durationMs}
        onCommit={onDurationChange}
      />
      <AnimationRangeField
        label="지연 시간"
        max={2000}
        min={0}
        value={delayMs}
        onCommit={onDelayChange}
      />
    </div>
  );
}

function getOrphanRelativeSummary(startMode: DeckAnimationStartMode) {
  return startMode === "after-previous"
    ? "선행 효과 없음 · 슬라이드 전환이 끝난 뒤 시작합니다."
    : "선행 효과 없음 · 슬라이드 시작과 함께 재생합니다.";
}
