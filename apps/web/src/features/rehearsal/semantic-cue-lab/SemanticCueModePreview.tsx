import type { SemanticCapability, SemanticCapabilityEvent } from "@orbit/shared";

import { getSemanticCapabilityCopy } from "../panel/semanticCapabilityCopy";
import type { LabCueOutcome, LabEvaluationResult } from "./semanticCueLabModel";

const measurementModeLabel: Record<string, string> = {
  full: "정밀 판정 (full)",
  basic: "기본 의미 체크 (basic)",
  none: "측정 안 됨 (none)"
};

const outcomeLabel: Record<LabCueOutcome["status"], string> = {
  covered: "전달함",
  partial: "일부 전달",
  missed: "놓침",
  unmeasured: "측정 불가"
};

function latestStatusEvents(events: readonly SemanticCapabilityEvent[]): SemanticCapabilityEvent[] {
  const latest = new Map<SemanticCapability, SemanticCapabilityEvent>();
  for (const event of events) {
    latest.set(event.capability, event);
  }
  return [...latest.values()].filter((event) => event.toState !== "available");
}

export function SemanticCueModePreview(props: { result: LabEvaluationResult }) {
  const { result } = props;
  const statusEvents = latestStatusEvents(result.capabilityEvents);

  return (
    <div className="scue-lab-mode-preview" data-testid="mode-preview">
      <RehearsalPreview result={result} statusEvents={statusEvents} />
      <LivePresenterPreview statusEvents={statusEvents} />
      <ReportPreview result={result} />
    </div>
  );
}

function RehearsalPreview(props: {
  result: LabEvaluationResult;
  statusEvents: readonly SemanticCapabilityEvent[];
}) {
  return (
    <section className="scue-lab-preview-card" data-testid="rehearsal-preview">
      <header>
        <h4>리허설 화면</h4>
        <span className="scue-lab-mode-chip">{measurementModeLabel[props.result.measurementMode]}</span>
      </header>

      <div className="scue-lab-system-status" data-testid="rehearsal-system-status">
        <strong>시스템 상태</strong>
        {props.statusEvents.length === 0 ? (
          <p>모든 의미 인식 기능이 정상입니다.</p>
        ) : (
          <ul>
            {props.statusEvents.map((event) => {
              const copy = getSemanticCapabilityCopy(event);
              return (
                <li key={event.eventId}>
                  <span className="scue-lab-status-label">{copy.shortLabel}</span>
                  <span className="scue-lab-status-detail">{copy.detail}</span>
                  <span className="scue-lab-status-retry">
                    {event.retryable ? "재시도 가능" : "재시도 불가"}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="scue-lab-checklist">
        <strong>Cue 체크리스트</strong>
        <ul>
          {props.result.outcomes.map((outcome) => (
            <li key={outcome.cueId} className={`scue-lab-outcome scue-lab-outcome-${outcome.status}`}>
              <span>{outcome.reportLabel}</span>
              <span className="scue-lab-outcome-status">{outcomeLabel[outcome.status]}</span>
              {outcome.unmeasuredReason ? (
                <span className="scue-lab-outcome-reason">사유: {outcome.unmeasuredReason}</span>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function LivePresenterPreview(props: { statusEvents: readonly SemanticCapabilityEvent[] }) {
  return (
    <section className="scue-lab-preview-card scue-lab-live-preview" data-testid="live-presenter-preview">
      <header>
        <h4>실전 발표자 화면</h4>
        <span className="scue-lab-audience-note" data-testid="audience-hidden-note">
          청중 화면 비노출
        </span>
      </header>
      <div className="scue-lab-live-chips">
        {props.statusEvents.length === 0 ? (
          <span className="scue-lab-live-chip ok">정상</span>
        ) : (
          props.statusEvents.map((event) => (
            <span
              key={event.eventId}
              className="scue-lab-live-chip"
              data-testid={`live-chip-${event.capability}`}
            >
              {getSemanticCapabilityCopy(event).shortLabel}
            </span>
          ))
        )}
      </div>
      <p className="scue-lab-live-note">
        transcript, 점수, premise는 실전 화면과 청중 화면 어디에도 표시하지 않습니다.
      </p>
    </section>
  );
}

function ReportPreview(props: { result: LabEvaluationResult }) {
  const { result } = props;
  return (
    <section className="scue-lab-preview-card" data-testid="report-preview">
      <header>
        <h4>리포트 화면</h4>
        <span className="scue-lab-mode-chip">
          semantic evaluation: {result.evaluationState} · {result.measurementMode}
        </span>
      </header>
      <ul className="scue-lab-report-outcomes">
        {result.outcomes.map((outcome) => (
          <li key={outcome.cueId} className={`scue-lab-outcome scue-lab-outcome-${outcome.status}`}>
            <span>{outcome.reportLabel}</span>
            <span className="scue-lab-outcome-status">{outcomeLabel[outcome.status]}</span>
            {outcome.status === "missed" ? (
              <span className="scue-lab-outcome-tag">발화했지만 의미 전달 근거 없음</span>
            ) : null}
            {outcome.status === "unmeasured" ? (
              <span className="scue-lab-outcome-tag">시스템이 측정하지 못함 (사유: {outcome.unmeasuredReason})</span>
            ) : null}
            {outcome.coveredConcepts.length > 0 ? (
              <span className="scue-lab-outcome-evidence">근거 개념: {outcome.coveredConcepts.join(", ")}</span>
            ) : null}
          </li>
        ))}
      </ul>
      {result.debugEvent.fallback ? (
        <p className="scue-lab-report-fallback">
          fallback 사유: {result.debugEvent.fallback.reason}
        </p>
      ) : null}
      <p className="scue-lab-report-guidance" data-testid="report-system-guidance">
        위 상태 안내는 AI 코칭 결과가 아니라 시스템 측정 상태입니다.
      </p>
    </section>
  );
}
