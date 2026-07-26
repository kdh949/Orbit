import {
  ArrowLeft,
  ArrowRight,
  Loader2,
  Mic,
  Sparkles,
} from "lucide-react";
import { useEffect, useState } from "react";
import type {
  Deck,
  PresentationRun,
  Project,
  RehearsalProjectSummary,
  RehearsalRun,
  RehearsalRunComparison,
} from "@orbit/shared";
import {
  fetchReportProjects,
  fetchProjectRehearsalSummary,
  fetchRehearsalRunComparison,
  loadProjectReportRunSources,
} from "./reportApi";
import { fetchProjectDeck } from "./keywords/keywordEditorApi";
import { RehearsalRunNav } from "./RehearsalRunNav";
import { RehearsalProjectSummaryDashboard } from "./RehearsalProjectSummaryDashboard";
import { buildRehearsalRunComparisonViewModel } from "./rehearsalRunComparisonModel";
import { getRehearsalReportPath } from "./rehearsalRoutes";
import {
  OrbitButton,
  OrbitEmptyState,
  OrbitFailureState,
} from "../../components/ui";
import orbitReportMascot from "../../assets/orbit-report-mascot-transparent.png";
import {
  getPresentationReportPath,
  navigateTo,
  sortRehearsalRunsByCreatedAt,
} from "./rehearsalUtils";
import "./rehearsal-project-report.css";
import "./rehearsal-project-overview.css";

export function RehearsalProjectOverviewPage({
  projectId,
}: {
  projectId: string;
}) {
  const shouldReturnHome =
    new URLSearchParams(window.location.search).get("from") === "home";
  const [project, setProject] = useState<Project | null>(null);
  const [runs, setRuns] = useState<RehearsalRun[]>([]);
  const [presentationRuns, setPresentationRuns] = useState<PresentationRun[]>(
    [],
  );
  const [summary, setSummary] = useState<RehearsalProjectSummary | null>(null);
  const [deck, setDeck] = useState<Deck | null>(null);
  const [comparison, setComparison] =
    useState<RehearsalRunComparison | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [unavailableReportSources, setUnavailableReportSources] = useState<
    Array<"rehearsal" | "presentation">
  >([]);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let isMounted = true;
    setProject(null);
    setRuns([]);
    setPresentationRuns([]);
    setSummary(null);
    setDeck(null);
    setComparison(null);
    setUnavailableReportSources([]);
    setState("loading");

    void (async () => {
      try {
        const [projects, reportSources, projectSummary, deckPayload] =
          await Promise.all([
            fetchReportProjects().catch(() => []),
            loadProjectReportRunSources(projectId),
            fetchProjectRehearsalSummary(projectId).catch(() => null),
            fetchProjectDeck(projectId).catch(() => null),
          ]);
        if (reportSources.succeededSourceCount === 0) {
          throw new Error("모든 리포트 기록 요청이 실패했습니다.");
        }
        if (!isMounted) return;
        const { runs: succeededRuns } = reportSources.rehearsal;
        const { runs: completedPresentationRuns } = reportSources.presentation;
        const sortedRuns = sortRehearsalRunsByCreatedAt(succeededRuns);
        const latestSucceededRun = sortedRuns[sortedRuns.length - 1] ?? null;
        const latestComparison = latestSucceededRun
          ? await fetchRehearsalRunComparison(
              projectId,
              latestSucceededRun.runId,
            ).catch(() => null)
          : null;
        if (!isMounted) return;
        setProject(projects.find((p) => p.projectId === projectId) ?? null);
        setRuns(sortedRuns);
        setPresentationRuns(
          [...completedPresentationRuns].sort(
            (left, right) =>
              Date.parse(left.createdAt) - Date.parse(right.createdAt),
          ),
        );
        setSummary(projectSummary);
        setDeck(deckPayload?.deck ?? null);
        setComparison(latestComparison);
        setUnavailableReportSources(reportSources.failedSources);
        setState("ready");
      } catch {
        if (!isMounted) return;
        setProject(null);
        setRuns([]);
        setPresentationRuns([]);
        setSummary(null);
        setDeck(null);
        setComparison(null);
        setUnavailableReportSources([]);
        setState("error");
      }
    })();
    return () => {
      isMounted = false;
    };
  }, [projectId, reloadKey]);

  const comparisonModel = comparison
    ? buildRehearsalRunComparisonViewModel(comparison, deck, projectId)
    : null;
  const latestRehearsalRun = runs.at(-1) ?? null;
  const latestPresentationRun = presentationRuns.at(-1) ?? null;
  const latestReport =
    latestPresentationRun &&
    (!latestRehearsalRun ||
      Date.parse(latestPresentationRun.createdAt) >=
        Date.parse(latestRehearsalRun.createdAt))
      ? { kind: "presentation" as const, run: latestPresentationRun }
      : latestRehearsalRun
        ? { kind: "rehearsal" as const, run: latestRehearsalRun }
        : null;
  const totalReportCount = runs.length + presentationRuns.length;

  return (
    <main className="rehearsal-report-page report-project-overview-page">
      <header className="rehearsal-report-topbar">
        <div className="rehearsal-report-topbar-left">
          <button
            type="button"
            className="rehearsal-report-back-button"
            onClick={() => navigateTo(shouldReturnHome ? "/" : "/reports")}
            aria-label="리포트 목록으로"
          >
            <ArrowLeft size={18} />
          </button>
        </div>
        <div className="rehearsal-report-topbar-actions">
          <button
            type="button"
            className="report-rehearsal-button"
            onClick={() =>
              navigateTo(`/rehearsal/${encodeURIComponent(projectId)}`)
            }
          >
            <Mic size={16} />
            리허설 시작
          </button>
        </div>
      </header>

      <div className="rehearsal-report-body">
        <RehearsalRunNav
          runs={runs}
          presentationRuns={presentationRuns}
          projectId={projectId}
          loading={state === "loading"}
        />

        <section className="report-overview-panel">
          {state === "ready" && unavailableReportSources.length > 0 ? (
            <div className="report-overview-partial-notice" role="status">
              {unavailableReportSources.includes("presentation")
                ? "실전 발표 기록"
                : "리허설 기록"}
              을 불러오지 못했습니다. 확인 가능한 리포트는 계속 이용할 수
              있습니다.
              <button
                onClick={() => setReloadKey((value) => value + 1)}
                type="button"
              >
                다시 불러오기
              </button>
            </div>
          ) : null}
          {state === "loading" ? (
            <div className="report-overview-loading">
              <Loader2 size={22} />
              <span>불러오는 중</span>
            </div>
          ) : state === "error" ? (
            <OrbitFailureState
              description="리허설 리포트 데이터를 가져오는 중 연결 문제가 발생했습니다."
              onRetry={() => setReloadKey((value) => value + 1)}
              recommendedAction="인터넷 연결을 확인한 뒤 리포트를 다시 불러오세요."
              title="프로젝트 리포트를 불러오지 못했습니다."
            />
          ) : totalReportCount === 0 ? (
            <OrbitEmptyState
              action={
                <OrbitButton
                  onClick={() =>
                    navigateTo(`/rehearsal/${encodeURIComponent(projectId)}`)
                  }
                >
                  리포트용 리허설 시작
                </OrbitButton>
              }
              description="리허설 또는 실전 발표를 마치면 이곳에서 발표 기록과 코칭 결과를 확인할 수 있습니다."
              title="아직 완료된 발표 기록이 없습니다."
            />
          ) : (
            <>
              <header className="report-overview-hero">
                <div className="report-overview-hero-copy">
                  <span className="report-page-kicker">
                    <Sparkles size={14} /> PROJECT REPORT
                  </span>
                  <h1>{project?.title ?? "프로젝트 리포트"}</h1>
                  <p>{totalReportCount}회차 발표 기록을 한눈에 확인해보세요.</p>
                  {latestReport ? (
                    <OrbitButton
                      className="report-overview-hero-detail-button"
                      icon={<ArrowRight aria-hidden="true" size={16} />}
                      onClick={() =>
                        navigateTo(
                          latestReport.kind === "presentation"
                            ? getPresentationReportPath(
                                projectId,
                                latestReport.run,
                              )
                            : getRehearsalReportPath(
                                projectId,
                                latestReport.run.runId,
                              ),
                        )
                      }
                      variant="secondary"
                    >
                      {latestReport.kind === "presentation"
                        ? "최신 실전 발표 리포트 보기"
                        : "최신 상세 리허설 보기"}
                    </OrbitButton>
                  ) : null}
                </div>
                <div className="report-overview-hero-visual" aria-hidden="true">
                  <img
                    src={orbitReportMascot}
                    alt=""
                    className="report-overview-hero-mascot"
                  />
                </div>
              </header>

              {summary ? (
                <RehearsalProjectSummaryDashboard
                  comparison={comparisonModel}
                  summary={summary}
                />
              ) : (
                <section className="project-summary-dashboard is-empty">
                  <Loader2 size={22} />
                  <div>
                    <h2>프로젝트 분석을 준비하고 있습니다</h2>
                    <p>최신 리허설 분석이 완료되면 회차별 변화가 이곳에 표시됩니다.</p>
                  </div>
                </section>
              )}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
