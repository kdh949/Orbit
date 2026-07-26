import { Check, CheckCircle2, LoaderCircle, X } from "lucide-react";

export function RehearsalCompletionScreen(props: {
  hasReportTarget: boolean;
  isReportPending: boolean;
  onClose: () => void;
  onGoHome: () => void;
  onOpenProject: () => void;
  onPracticeAgain: () => void;
  onPrimaryAction: () => void;
}) {
  const isReportReady = props.hasReportTarget && !props.isReportPending;

  return (
    <div className="rehearsal-completion-backdrop" role="presentation">
      <section
        aria-labelledby="rehearsal-completion-title"
        aria-modal="true"
        className="rehearsal-completion-dialog"
        role="dialog"
      >
        <button
          aria-label="완료 창 닫기"
          className="rehearsal-completion-close"
          onClick={props.onClose}
          type="button"
        >
          <X aria-hidden="true" size={22} />
        </button>

        <span className="rehearsal-completion-check" aria-hidden="true">
          <Check size={46} strokeWidth={2.5} />
        </span>
        <h1 id="rehearsal-completion-title">리허설을 마쳤어요</h1>
        <p className="rehearsal-completion-description">
          수고했어요! 결과를 확인하고 더 멋진 발표를 만들어 보세요.
        </p>

        <div
          className={`rehearsal-completion-report ${
            isReportReady ? "rehearsal-completion-report-ready" : ""
          }`}
          role="status"
        >
          {props.isReportPending ? (
            <LoaderCircle
              aria-hidden="true"
              className="rehearsal-completion-loader"
              size={24}
            />
          ) : (
            <CheckCircle2 aria-hidden="true" size={24} />
          )}
          <div>
            <strong>
              {props.isReportPending
                ? "리포트를 준비하고 있어요"
                : isReportReady
                  ? "리포트가 준비됐어요"
                  : "리포트 없이 리허설을 마쳤어요"}
            </strong>
            <span>
              {props.isReportPending
                ? "잠시만 기다려 주세요."
                : isReportReady
                  ? "자세한 분석을 확인할 수 있어요."
                  : "바로 다시 연습하거나 다른 화면으로 이동할 수 있어요."}
            </span>
          </div>
        </div>

        <div className="rehearsal-completion-actions">
          <button
            className="rehearsal-completion-report-button"
            disabled={!isReportReady}
            onClick={props.onPrimaryAction}
            type="button"
          >
            리포트 보기
          </button>
          <button
            className="rehearsal-completion-practice-button"
            onClick={props.onPracticeAgain}
            type="button"
          >
            다시 연습하기
          </button>
        </div>

        <nav
          className="rehearsal-completion-links"
          aria-label="리허설 종료 후 이동"
        >
          <button type="button" onClick={props.onOpenProject}>
            프로젝트 편집기로
          </button>
          <span aria-hidden="true" />
          <button type="button" onClick={props.onGoHome}>
            홈으로
          </button>
        </nav>
      </section>
    </div>
  );
}
