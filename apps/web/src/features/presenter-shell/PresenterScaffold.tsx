import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw } from "lucide-react";
import type { ReactNode } from "react";
import { shouldAdvancePresentationFromClick } from "./presentationClickAdvance";

export type PresenterTimeMode = "stopwatch" | "timer";

export function PresenterStatusShell(props: {
  action?: ReactNode;
  children: ReactNode;
  title: string;
}) {
  return (
    <main className="rehearsal-presenter-shell">
      <section className="presenter-remote-status" role="status">
        <strong>{props.title}</strong>
        <p>{props.children}</p>
        {props.action}
      </section>
    </main>
  );
}

export function PresenterTopbar(props: {
  exitButtonClassName?: string;
  exitButtonContent: ReactNode;
  onExit: () => void;
  primaryActionAriaLabel: string;
  primaryActionDisabled?: boolean;
  primaryActionRunning: boolean;
  onDurationInputBlur: (value: string) => void;
  onDurationInputChange: (value: string) => void;
  onDurationInputFocus: () => void;
  onElapsedInputBlur: (value: string) => void;
  onElapsedInputChange: (value: string) => void;
  onElapsedInputFocus: () => void;
  onPrimaryAction: () => void;
  onReset: () => void;
  onTimeModeChange: (value: PresenterTimeMode) => void;
  statusActive?: boolean;
  statusLabel?: string;
  subtitle?: string;
  timeMode: PresenterTimeMode;
  timerDurationInput: string;
  title: string;
  toolbar?: ReactNode;
  totalElapsedInput: string;
}) {
  return (
    <header className="rehearsal-presenter-topbar">
      <button
        className={props.exitButtonClassName ?? "rehearsal-exit-button"}
        type="button"
        onClick={props.onExit}
      >
        {props.exitButtonContent}
      </button>
      <h1 className="rehearsal-smoke-heading">{props.title}</h1>
      {props.subtitle ? (
        <span className="rehearsal-session-status">
          <span aria-hidden="true" />
          {props.subtitle}
        </span>
      ) : null}

      {props.toolbar}

      {props.statusLabel ? (
        <span
          className={`rehearsal-recording-status ${
            props.statusActive ? "rehearsal-recording-status-active" : ""
          }`}
        >
          <span aria-hidden="true" />
          {props.statusLabel}
        </span>
      ) : null}

      <div className="rehearsal-timer-pill" aria-live="polite">
        <span className="timer-wave" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </span>
        <label className="rehearsal-time-mode">
          <select
            aria-label="Time display mode"
            value={props.timeMode}
            onChange={(event) =>
              props.onTimeModeChange(event.target.value as PresenterTimeMode)
            }
          >
            <option value="stopwatch">스톱워치</option>
            <option value="timer">타이머</option>
          </select>
          <span className="rehearsal-select-caret" aria-hidden="true" />
        </label>
        <div className="rehearsal-time-fields">
          <input
            aria-label="Elapsed time"
            inputMode="numeric"
            value={props.totalElapsedInput}
            onBlur={(event) => props.onElapsedInputBlur(event.target.value)}
            onChange={(event) => props.onElapsedInputChange(event.target.value)}
            onFocus={props.onElapsedInputFocus}
          />
          <span aria-hidden="true">/</span>
          <input
            aria-label="Target time"
            inputMode="numeric"
            value={props.timerDurationInput}
            onBlur={(event) => props.onDurationInputBlur(event.target.value)}
            onChange={(event) => props.onDurationInputChange(event.target.value)}
            onFocus={props.onDurationInputFocus}
          />
        </div>
        <button
          type="button"
          aria-label={props.primaryActionAriaLabel}
          onClick={props.onPrimaryAction}
          disabled={props.primaryActionDisabled}
        >
          {props.primaryActionRunning ? (
            <Pause fill="currentColor" size={22} strokeWidth={0} />
          ) : (
            <Play fill="currentColor" size={22} strokeWidth={2.5} />
          )}
        </button>
        <button type="button" aria-label="Reset timer" onClick={props.onReset}>
          <RotateCcw size={22} />
        </button>
      </div>
    </header>
  );
}

export function PresenterStageSection(props: {
  currentIndex: number;
  currentSlideTitle?: string;
  emptyStageLabel: string;
  leftPanel?: ReactNode;
  navigationPending?: boolean;
  nextHint: string;
  nextSlideContent?: ReactNode;
  nextSlideTitle: string;
  onNext: () => void;
  onPrevious: () => void;
  onStageAdvance?: () => void;
  previousDisabled: boolean;
  renderStage: ReactNode | null;
  stageAdvanceDisabled?: boolean;
  stageIndexLabel?: string;
  stageRef?: (node: HTMLDivElement | null) => void;
  totalSlides: number;
}) {
  return (
    <section className="rehearsal-presenter-main">
      <div
        aria-busy={props.navigationPending || undefined}
        className="rehearsal-stage-wrap"
      >
        {props.renderStage ? (
          <>
            <span className="rehearsal-stage-label">현재</span>
            <div className="rehearsal-stage-viewport" ref={props.stageRef}>
              <div
                className="rehearsal-stage-surface"
                onClick={(event) => {
                  if (
                    !props.onStageAdvance ||
                    props.navigationPending ||
                    props.stageAdvanceDisabled ||
                    event.defaultPrevented ||
                    !shouldAdvancePresentationFromClick(event.target)
                  ) {
                    return;
                  }
                  props.onStageAdvance();
                }}
              >
                {props.renderStage}
              </div>
            </div>
            {props.stageIndexLabel ? (
              <span className="rehearsal-stage-index">{props.stageIndexLabel}</span>
            ) : null}
          </>
        ) : (
          <div className="rehearsal-stage-viewport" ref={props.stageRef}>
            <div className="rehearsal-empty-stage">{props.emptyStageLabel}</div>
          </div>
        )}
        {props.navigationPending ? (
          <span className="rehearsal-slide-loading" role="status">
            슬라이드 준비 중…
          </span>
        ) : null}
        <div className="rehearsal-slide-controls">
          <button
            type="button"
            onClick={props.onPrevious}
            disabled={props.previousDisabled || props.navigationPending}
            aria-label="이전 슬라이드"
            title="이전 슬라이드"
          >
            <ChevronLeft size={24} />
          </button>
          <span>
            {props.currentIndex + 1} / {props.totalSlides}
          </span>
          <button
            type="button"
            onClick={props.onNext}
            disabled={props.navigationPending}
            aria-label="다음 슬라이드"
            title="다음 슬라이드"
          >
            <ChevronRight size={24} />
          </button>
        </div>
      </div>

      <section className="rehearsal-next-slide-preview" aria-label="다음 슬라이드">
        <div className="rehearsal-next-slide-frame">
          {props.nextSlideContent ?? <span>마지막 슬라이드</span>}
        </div>
        <div>
          <span>다음 슬라이드</span>
          <strong>{props.nextSlideTitle}</strong>
          <p>{props.nextHint}</p>
        </div>
      </section>
      {props.leftPanel}
    </section>
  );
}

export type PresenterInfoCardItem = {
  detail: ReactNode;
  label: ReactNode;
  value: ReactNode;
  variantClassName?: string;
};

export type PresenterTimingProgressItem = {
  currentLabel: ReactNode;
  label: ReactNode;
  percent: number;
  targetLabel: ReactNode;
  tone?: "default" | "warning" | "danger";
};

export function getPresenterTimingProgress(
  elapsedSeconds: number,
  targetSeconds: number,
  toleranceSeconds = 5,
): { percent: number; tone: "default" | "warning" | "danger" } {
  if (targetSeconds <= 0) {
    return { percent: 0, tone: "default" };
  }

  const percent = Math.min(
    100,
    Math.max(0, (elapsedSeconds / targetSeconds) * 100),
  );
  if (elapsedSeconds > targetSeconds + toleranceSeconds) {
    return { percent, tone: "danger" };
  }
  if (elapsedSeconds >= Math.max(0, targetSeconds - toleranceSeconds)) {
    return { percent, tone: "warning" };
  }
  return { percent, tone: "default" };
}

export function PresenterTimerCard(props: {
  ariaLabel: string;
  currentTimeLabel: string;
  infoCards?: readonly PresenterInfoCardItem[];
  meterPercent: number;
  onPrimaryAction: () => void;
  onReset: () => void;
  onTimeInputBlur: (value: string) => void;
  onTimeInputChange: (value: string) => void;
  onTimeInputFocus: () => void;
  primaryActionAriaLabel: string;
  primaryActionDisabled?: boolean;
  primaryActionRunning: boolean;
  progressItems?: readonly PresenterTimingProgressItem[];
  progressPercent: number;
  resetAriaLabel?: string;
  timeReadOnly?: boolean;
  timeInputValue: string;
  timeMetaLeft: ReactNode;
  timeMetaRight: ReactNode;
  title: string;
}) {
  return (
    <section className="rehearsal-side-timer-card" aria-label={props.ariaLabel}>
      <div className="rehearsal-side-timer-hero">
        <div className="rehearsal-side-timer-header">
          <div>
            <span className="rehearsal-side-timer-title">{props.title}</span>
            {props.timeReadOnly ? (
              <output
                className="rehearsal-side-timer-time"
                aria-label={props.currentTimeLabel}
              >
                {props.timeInputValue}
              </output>
            ) : (
              <input
                className="rehearsal-side-timer-time"
                aria-label={props.currentTimeLabel}
                inputMode="numeric"
                value={props.timeInputValue}
                onBlur={(event) => props.onTimeInputBlur(event.target.value)}
                onChange={(event) => props.onTimeInputChange(event.target.value)}
                onFocus={props.onTimeInputFocus}
              />
            )}
          </div>
          <div className="rehearsal-side-timer-actions">
            <button
              type="button"
              aria-label={props.primaryActionAriaLabel}
              onClick={props.onPrimaryAction}
              disabled={props.primaryActionDisabled}
            >
              {props.primaryActionRunning ? (
                <Pause fill="currentColor" size={22} strokeWidth={0} />
              ) : (
                <Play fill="currentColor" size={22} strokeWidth={2.5} />
              )}
            </button>
            <button
              type="button"
              aria-label={props.resetAriaLabel ?? "타이머 초기화"}
              onClick={props.onReset}
            >
              <RotateCcw size={22} />
            </button>
          </div>
        </div>

        <div className="rehearsal-side-audio-gauge" aria-hidden="true">
          <span className="rehearsal-side-timer-wave" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </span>
          <span className="rehearsal-side-audio-track">
            <span style={{ width: `${props.meterPercent}%` }} />
          </span>
        </div>

        {props.progressItems?.length ? (
          <div className="rehearsal-side-timing-progress-list">
            {props.progressItems.map((item, index) => (
              <div
                aria-label={`${String(item.label)} ${String(item.currentLabel)} ${String(item.targetLabel)}`}
                className={`rehearsal-side-timing-progress rehearsal-side-timing-progress-${item.tone ?? "default"}`}
                key={index}
              >
                <div className="rehearsal-side-timing-progress-meta">
                  <strong>{item.label}</strong>
                  <span>
                    {item.currentLabel} · {item.targetLabel}
                  </span>
                </div>
                <span className="rehearsal-side-timing-progress-track" aria-hidden="true">
                  <span style={{ width: `${item.percent}%` }} />
                </span>
              </div>
            ))}
          </div>
        ) : (
          <>
            <div className="rehearsal-side-timer-progress" aria-hidden="true">
              <span style={{ width: `${props.progressPercent}%` }} />
            </div>

            <div className="rehearsal-side-timer-meta">
              <span>{props.timeMetaLeft}</span>
              <span>{props.timeMetaRight}</span>
            </div>
          </>
        )}
      </div>

      {props.infoCards?.length ? (
        <div className="rehearsal-side-detail-grid">
          {props.infoCards.map((card, index) => (
            <article
              className={`rehearsal-side-detail-card ${card.variantClassName ?? ""}`.trim()}
              key={index}
            >
              <span>{card.label}</span>
              <strong>{card.value}</strong>
              <small>{card.detail}</small>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
