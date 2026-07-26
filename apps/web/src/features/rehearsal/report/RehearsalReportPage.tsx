import type { Deck } from "@orbit/shared/deck";
import type { Job } from "@orbit/shared/jobs";
import type { RehearsalReport, RehearsalRun } from "@orbit/shared/rehearsals";
import { ArrowLeft, BarChart3 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { PracticeGoalSummary } from "../../coaching/PracticeGoalSummary";
import { JobProgressDisplay } from "../JobProgressDisplay";
import { RehearsalReportDocument } from "../RehearsalReportDocument";
import { RehearsalRunNav } from "../RehearsalRunNav";
import {
  RehearsalFlowError,
  fetchProjectRehearsalRuns,
  fetchRehearsalDeck,
  fetchRehearsalReport,
  pollRehearsalJob,
  resolveRehearsalReportLoadState,
  retryRehearsalSemanticEvaluation,
  type RehearsalReportStatus,
} from "../api/rehearsalApi";
import {
  getRehearsalRunNumber,
  sortRehearsalRunsByCreatedAt,
} from "../rehearsalUtils";
import { useJobSmoothProgress } from "../useJobSmoothProgress";
import "../rehearsal-report-detail.css";

export function RehearsalReportPage(props: {
  initialDeck?: Deck;
  initialReport?: RehearsalReport | null;
  initialRun?: RehearsalRun | null;
  projectId: string;
  runId: string;
}) {
  const [deck, setDeck] = useState<Deck | null>(props.initialDeck ?? null);
  const [run, setRun] = useState<RehearsalRun | null>(props.initialRun ?? null);
  const [audioPlaybackAvailable, setAudioPlaybackAvailable] = useState(true);
  const [transcriptDownloadAvailable, setTranscriptDownloadAvailable] =
    useState(false);
  const [report, setReport] = useState<RehearsalReport | null>(
    props.initialReport ?? null,
  );
  const [status, setStatus] = useState<RehearsalReportStatus>(
    props.initialReport ? "ready" : "loading",
  );
  const [error, setError] = useState("");
  const [reportJob, setReportJob] = useState<Job | null>(null);
  const [semanticRetryState, setSemanticRetryState] = useState<{
    message?: string;
    status: "idle" | "running" | "succeeded" | "failed";
  }>({ status: "idle" });
  const [allSucceededRuns, setAllSucceededRuns] = useState<RehearsalRun[]>(
    () => (props.initialRun?.status === "succeeded" ? [props.initialRun] : []),
  );
  const [prevReports, setPrevReports] = useState<RehearsalReport[]>([]);

  useEffect(() => {
    setDeck(props.initialDeck ?? null);
  }, [props.initialDeck, props.projectId]);

  useEffect(() => {
    setRun(props.initialRun ?? null);
    setAudioPlaybackAvailable(true);
    setReport(props.initialReport ?? null);
    setStatus(props.initialReport ? "ready" : "loading");
    setError("");
    setReportJob(null);
    setSemanticRetryState({ status: "idle" });
    setPrevReports([]);
  }, [props.initialRun, props.initialReport, props.runId]);

  useEffect(() => {
    let isMounted = true;

    if (!props.initialDeck) {
      void fetchRehearsalDeck(props.projectId)
        .then((nextDeck) => {
          if (isMounted) {
            setDeck(nextDeck);
          }
        })
        .catch(() => {
          if (isMounted) {
            setDeck(null);
          }
        });
    }

    if (props.initialReport !== undefined) {
      return () => {
        isMounted = false;
      };
    }

    setStatus("loading");
    setError("");
    setRun(null);
    setReport(null);
    setReportJob(null);

    void fetchRehearsalReport(props.runId)
      .then((response) => {
        if (!isMounted) {
          return;
        }

        const nextState = resolveRehearsalReportLoadState(
          response,
          props.projectId,
        );
        setRun(response.run);
        setAudioPlaybackAvailable(
          response.audioPlaybackAvailable ?? Boolean(response.run.audioFileId),
        );
        setTranscriptDownloadAvailable(
          response.transcriptDownloadAvailable ?? false,
        );
        setReport(nextState.status === "ready" ? response.report : null);
        setStatus(nextState.status);
        setError(nextState.error);

        if (nextState.status === "not-ready" && response.run.jobId) {
          void pollRehearsalJob(response.run.jobId, {
            onUpdate: (job) => {
              if (isMounted) {
                setReportJob(job);
              }
            },
          })
            .then((job) => {
              if (!isMounted) {
                return;
              }
              setReportJob(job);
              if (job.status === "succeeded") {
                void fetchRehearsalReport(props.runId).then(
                  (refreshedResponse) => {
                    if (!isMounted) {
                      return;
                    }
                    setRun(refreshedResponse.run);
                    setAudioPlaybackAvailable(
                      refreshedResponse.audioPlaybackAvailable ??
                        Boolean(refreshedResponse.run.audioFileId),
                    );
                    setTranscriptDownloadAvailable(
                      refreshedResponse.transcriptDownloadAvailable ?? false,
                    );
                    setReport(refreshedResponse.report);
                    setStatus(refreshedResponse.report ? "ready" : "failed");
                  },
                );
              } else {
                setStatus("failed");
                setError(
                  job.error?.message || job.message || "리포트 생성 실패",
                );
              }
            })
            .catch(() => {
              if (isMounted) {
                setStatus("failed");
              }
            });
        }
      })
      .catch((cause) => {
        if (!isMounted) {
          return;
        }

        setReport(null);
        setStatus("failed");
        setError(toRehearsalReportFlowMessage(cause));
      });

    return () => {
      isMounted = false;
    };
  }, [props.initialDeck, props.initialReport, props.projectId, props.runId]);

  useEffect(() => {
    let isMounted = true;
    setAllSucceededRuns(
      props.initialRun?.status === "succeeded" ? [props.initialRun] : [],
    );

    void fetchProjectRehearsalRuns(props.projectId).then((runs) => {
      if (!isMounted) {
        return;
      }
      const succeeded = sortRehearsalRunsByCreatedAt(
        runs.filter((candidate) => candidate.status === "succeeded"),
      );
      setAllSucceededRuns(succeeded);
    });
    return () => {
      isMounted = false;
    };
  }, [props.projectId]);

  useEffect(() => {
    if (allSucceededRuns.length === 0) {
      return;
    }
    const currentIndex = allSucceededRuns.findIndex(
      (candidate) => candidate.runId === props.runId,
    );
    if (currentIndex <= 0) {
      setPrevReports([]);
      return;
    }
    let isMounted = true;
    const runsToFetch = allSucceededRuns
      .slice(Math.max(0, currentIndex - 3), currentIndex)
      .reverse();
    void Promise.all(
      runsToFetch.map((candidate) =>
        fetchRehearsalReport(candidate.runId)
          .then((response) => response.report)
          .catch(() => null),
      ),
    ).then((results) => {
      if (!isMounted) {
        return;
      }
      setPrevReports(
        results.filter(
          (candidate): candidate is RehearsalReport => candidate !== null,
        ),
      );
    });
    return () => {
      isMounted = false;
    };
  }, [allSucceededRuns, props.runId]);

  const reportSmoothProgress = useJobSmoothProgress(
    reportJob,
    status === "not-ready",
  );

  const currentRunNumber = getRehearsalRunNumber(allSucceededRuns, props.runId);

  const handleSemanticRetry = useCallback(async () => {
    setSemanticRetryState({
      message: "서버에서 의미 전달을 다시 평가하고 있어요.",
      status: "running",
    });

    try {
      const job = await retryRehearsalSemanticEvaluation(props.runId);
      const completedJob = await pollRehearsalJob(job.jobId);
      if (completedJob.status !== "succeeded") {
        setSemanticRetryState({
          message:
            "서버 재평가를 완료하지 못했습니다. 발표 결과는 기존 상태로 유지됩니다.",
          status: "failed",
        });
        return;
      }

      const response = await fetchRehearsalReport(props.runId);
      const nextState = resolveRehearsalReportLoadState(
        response,
        props.projectId,
      );
      if (nextState.status !== "ready" || response.report === null) {
        setSemanticRetryState({
          message:
            "재평가는 끝났지만 새 결과를 불러오지 못했습니다. 잠시 후 다시 열어 주세요.",
          status: "failed",
        });
        return;
      }

      setRun(response.run);
      setReport(response.report);
      setSemanticRetryState({
        message: "서버 재평가 결과를 반영했습니다.",
        status: "succeeded",
      });
    } catch (cause) {
      setSemanticRetryState({
        message:
          cause instanceof RehearsalFlowError &&
          cause.stage === "semantic-retry"
            ? cause.message
            : "서버 재평가 중 문제가 발생했습니다. 발표 결과는 기존 상태로 유지됩니다.",
        status: "failed",
      });
    }
  }, [props.projectId, props.runId]);

  return (
    <main className="rehearsal-report-page">
      <header className="rehearsal-report-topbar">
        <div className="rehearsal-report-topbar-left">
          <button
            type="button"
            className="rehearsal-report-back-button"
            onClick={() =>
              navigateToPath(`/reports/${encodeURIComponent(props.projectId)}`)
            }
            aria-label="프로젝트 리포트 개요로"
          >
            <ArrowLeft size={18} />
          </button>
          <span className="report-project-title">
            {deck?.title ?? "리포트"}
          </span>
          {currentRunNumber != null && (
            <span className="report-run-label">
              리허설 {currentRunNumber}회차
            </span>
          )}
        </div>
      </header>

      <div className="rehearsal-report-body">
        <RehearsalRunNav
          runs={allSucceededRuns}
          activeRunId={props.runId}
          projectId={props.projectId}
        />

        <section className="rehearsal-report-document" aria-live="polite">
          {status === "loading" ? (
            <RehearsalReportLoadingShell />
          ) : report ? (
            <RehearsalReportDocument
              audioPlaybackAvailable={audioPlaybackAvailable}
              transcriptDownloadAvailable={transcriptDownloadAvailable}
              report={report}
              deck={deck}
              onSemanticRetry={handleSemanticRetry}
              run={run}
              runNumber={currentRunNumber}
              projectId={props.projectId}
              totalRunCount={allSucceededRuns.length}
              prevReports={prevReports}
              semanticRetryState={semanticRetryState}
              practiceGoalSummary={
                shouldLoadPracticeGoalSummary(run) ? (
                  <PracticeGoalSummary
                    projectId={props.projectId}
                    sourceFullRunId={props.runId}
                  />
                ) : null
              }
            />
          ) : (
            <div
              className={
                status === "failed"
                  ? "report-page-state status-error"
                  : "report-page-state"
              }
            >
              <BarChart3 size={28} />
              <strong>{formatEmptyReportMessage(status, error)}</strong>
              {status === "not-ready" && (
                <JobProgressDisplay
                  progress={reportSmoothProgress}
                  message={reportJob?.message || ""}
                />
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

export function shouldLoadPracticeGoalSummary(run: RehearsalRun | null) {
  return run?.status === "succeeded";
}

function formatEmptyReportMessage(
  status: RehearsalReportStatus,
  error: string,
) {
  if (status === "loading") {
    return "보고서를 불러오는 중입니다.";
  }
  if (status === "not-ready") {
    return "보고서 생성 중입니다.";
  }
  if (status === "unavailable") {
    return "공식 리포트가 생성되지 않았습니다. 연습 계획은 계속 사용할 수 있습니다.";
  }
  if (status === "failed") {
    return error || "보고서를 불러오지 못했습니다.";
  }
  return "보고서 대기 중";
}

function toRehearsalReportFlowMessage(cause: unknown) {
  if (cause instanceof RehearsalFlowError) {
    if (cause.stage === "storage-put") {
      return "업로드가 중단되었습니다. 네트워크와 스토리지 연결을 확인해 주세요.";
    }

    if (cause.stage === "complete" || cause.stage === "job-poll") {
      return cause.message || "음성 인식 또는 코칭 분석 작업에 실패했습니다.";
    }
  }

  return cause instanceof Error ? cause.message : "알 수 없는 오류";
}

function navigateToPath(path: string) {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function RehearsalReportLoadingShell() {
  return (
    <div
      className="rrd-root report-loading-shell"
      role="status"
      aria-label="보고서를 불러오는 중입니다."
    >
      <section className="rrd-hero report-loading-hero" aria-hidden="true">
        <div className="rrd-hero-text report-loading-stack">
          <div className="report-loading-block report-loading-title" />
          <div className="report-loading-block report-loading-date" />
        </div>
        <div className="report-loading-block report-loading-button" />
      </section>

      <section
        className="rrd-card report-loading-card report-loading-card-wide"
        aria-hidden="true"
      >
        <div className="rrd-card-head">
          <div className="report-loading-block report-loading-line-sm" />
        </div>
        <div className="report-loading-stack">
          <div className="report-loading-block report-loading-line-xl" />
          <div className="report-loading-block report-loading-line-lg" />
          <div className="report-loading-block report-loading-line-md" />
        </div>
      </section>

      <div
        className="rrd-overview-columns report-loading-columns"
        aria-hidden="true"
      >
        <section className="rrd-card report-loading-card">
          <div className="rrd-card-head">
            <div className="report-loading-block report-loading-line-sm" />
          </div>
          <div className="rrd-overview-grid report-loading-metric-grid">
            {[0, 1, 2, 3].map((index) => (
              <div className="report-loading-metric" key={index}>
                <div className="report-loading-block report-loading-line-sm" />
                <div className="report-loading-block report-loading-metric-value" />
              </div>
            ))}
          </div>
        </section>

        <section className="rrd-card report-loading-card">
          <div className="rrd-card-head">
            <div className="report-loading-block report-loading-line-sm" />
          </div>
          <div className="report-loading-chart">
            <div className="report-loading-block report-loading-chart-bar" />
            <div className="report-loading-block report-loading-chart-bar report-loading-chart-bar-tall" />
            <div className="report-loading-block report-loading-chart-bar" />
            <div className="report-loading-block report-loading-chart-bar report-loading-chart-bar-short" />
            <div className="report-loading-block report-loading-chart-bar report-loading-chart-bar-mid" />
          </div>
          <div className="report-loading-stack">
            <div className="report-loading-block report-loading-line-md" />
            <div className="report-loading-block report-loading-line-sm" />
          </div>
        </section>
      </div>

      <section className="rrd-card report-loading-card" aria-hidden="true">
        <div className="rrd-card-head">
          <div className="report-loading-block report-loading-line-sm" />
        </div>
        <div className="report-loading-chip-list">
          <div className="report-loading-block report-loading-chip" />
          <div className="report-loading-block report-loading-chip" />
          <div className="report-loading-block report-loading-chip report-loading-chip-wide" />
          <div className="report-loading-block report-loading-chip" />
        </div>
        <div className="report-loading-list">
          <div className="report-loading-block report-loading-line-lg" />
          <div className="report-loading-block report-loading-line-md" />
          <div className="report-loading-block report-loading-line-lg" />
        </div>
      </section>

      <section
        className="rrd-card report-loading-card report-loading-card-wide"
        aria-hidden="true"
      >
        <div className="rrd-card-head">
          <div className="report-loading-block report-loading-line-sm" />
        </div>
        <div className="report-loading-slide-list">
          {[0, 1].map((index) => (
            <div className="report-loading-slide-item" key={index}>
              <div className="report-loading-block report-loading-thumb" />
              <div className="report-loading-slide-copy">
                <div className="report-loading-block report-loading-line-lg" />
                <div className="report-loading-block report-loading-line-md" />
                <div className="report-loading-block report-loading-line-sm" />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
