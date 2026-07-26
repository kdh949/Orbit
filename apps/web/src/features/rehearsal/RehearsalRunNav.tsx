import { CalendarDays, Loader2 } from "lucide-react";
import type { PresentationRun, RehearsalRun } from "@orbit/shared";
import { getRehearsalReportPath } from "./rehearsalRoutes";
import {
  navigateTo,
  formatRunDate,
  getPresentationReportPath,
  sortRehearsalRunsByCreatedAt,
} from "./rehearsalUtils";

type RehearsalRunNavProps = {
  runs: RehearsalRun[];
  presentationRuns?: PresentationRun[];
  activePresentationRunId?: string;
  activeRunId?: string;
  projectId: string;
  loading?: boolean;
};

export function RehearsalRunNav({
  runs,
  presentationRuns,
  activePresentationRunId,
  activeRunId,
  projectId,
  loading,
}: RehearsalRunNavProps) {
  const orderedRuns = sortRehearsalRunsByCreatedAt(runs);
  const orderedPresentationRuns = [...(presentationRuns ?? [])].sort(
    (left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt),
  );
  const totalRunCount = runs.length + orderedPresentationRuns.length;
  const activeRunIndex = orderedRuns.findIndex(
    (run) => run.runId === activeRunId,
  );
  const activeRun = activeRunIndex >= 0 ? orderedRuns[activeRunIndex] : null;
  const activePresentationRunIndex = orderedPresentationRuns.findIndex(
    (run) => run.runId === activePresentationRunId,
  );
  const activePresentationRun =
    activePresentationRunIndex >= 0
      ? orderedPresentationRuns[activePresentationRunIndex]
      : null;

  return (
    <aside className="rehearsal-report-nav" aria-label="회차별 리포트">
      {loading ? (
        <div className="report-overview-nav-loading">
          <Loader2 size={16} />
        </div>
      ) : (
        <>
          <header className="rehearsal-report-nav-head">
            <h2>전체 리포트 기록</h2>
            <span>{totalRunCount}회</span>
          </header>
          {activeRun ? (
            <div className="rehearsal-report-nav-current">
              <span>현재 보고 있는 리포트</span>
              <strong>리허설 {activeRunIndex + 1}회차</strong>
              <small>{formatRunDate(activeRun.createdAt)}</small>
            </div>
          ) : activePresentationRun ? (
            <div className="rehearsal-report-nav-current">
              <span>현재 보고 있는 리포트</span>
              <strong>실전 발표 {activePresentationRunIndex + 1}회차</strong>
              <small>{formatRunDate(activePresentationRun.createdAt)}</small>
            </div>
          ) : null}

          <header className="rehearsal-report-nav-head rehearsal-report-nav-section-head">
            <h2>리허설</h2>
            <span>{runs.length}회</span>
          </header>
          {orderedRuns.length > 0 ? (
            <details
              className="rehearsal-report-nav-history"
              open={!presentationRuns}
            >
              <summary>리허설 회차 보기</summary>
              <ul className="rehearsal-report-nav-list">
                {orderedRuns.map((run, i) => (
                  <li key={run.runId}>
                    <button
                      type="button"
                      className={`rehearsal-report-nav-item${run.runId === activeRunId ? " active" : ""}`}
                      onClick={() =>
                        navigateTo(getRehearsalReportPath(projectId, run.runId))
                      }
                    >
                      <strong>
                        <CalendarDays size={15} />
                        리허설 {i + 1}회차
                      </strong>
                      <span>{formatRunDate(run.createdAt)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          ) : (
            <ul className="rehearsal-report-nav-list rehearsal-report-nav-list-disabled">
              <li>
                <div className="rehearsal-report-nav-empty">
                  아직 리허설 리포트가 없습니다
                </div>
              </li>
            </ul>
          )}

          {presentationRuns ? (
            <>
              <header
                className={`rehearsal-report-nav-head rehearsal-report-nav-section-head${orderedPresentationRuns.length === 0 ? " rehearsal-report-nav-head-disabled" : ""}`}
              >
                <h2>실전 발표</h2>
                <span>{orderedPresentationRuns.length}회</span>
              </header>
              {orderedPresentationRuns.length > 0 ? (
                <details className="rehearsal-report-nav-history" open>
                  <summary>실전 발표 회차 보기</summary>
                  <ul className="rehearsal-report-nav-list">
                    {orderedPresentationRuns.map((run, index) => (
                      <li key={run.runId}>
                        <button
                          type="button"
                          className={`rehearsal-report-nav-item${run.runId === activePresentationRunId ? " active" : ""}`}
                          aria-current={
                            run.runId === activePresentationRunId
                              ? "page"
                              : undefined
                          }
                          onClick={() =>
                            navigateTo(
                              getPresentationReportPath(projectId, run),
                            )
                          }
                        >
                          <strong>
                            <CalendarDays size={15} />
                            실전 발표 {index + 1}회차
                          </strong>
                          <span>{formatRunDate(run.createdAt)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : (
                <ul className="rehearsal-report-nav-list rehearsal-report-nav-list-disabled">
                  <li>
                    <div className="rehearsal-report-nav-empty">
                      아직 실전 발표 리포트가 없습니다
                    </div>
                  </li>
                </ul>
              )}
            </>
          ) : null}
        </>
      )}
    </aside>
  );
}
