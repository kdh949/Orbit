import type { Project, RehearsalRun } from "@orbit/shared";
import {
  IconChevronLeft,
  IconChevronRight,
  IconFileText
} from "@tabler/icons-react";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { WorkspaceContainer } from "../../components/patterns";
import { OrbitButton, OrbitEmptyState, OrbitFailureState } from "../../components/ui";
import { fetchProjects } from "../projects/ProjectAssetWorkspace";
import { fetchProjectRehearsalReportRuns } from "./reportApi";
import { navigateTo, formatRunDate } from "./rehearsalUtils";
import "../projects/orbit-project-hub.css";
import "./rehearsal-report-list.css";

const ProjectRowSlidePreview = lazy(
  () => import("../projects/ProjectSlidePreview")
);

export type ProjectWithReport = {
  latestRun: RehearsalRun;
  project: Project;
  totalCount: number;
};

export function buildProjectReportItems(
  projects: Project[],
  runLists: Array<{ runs: RehearsalRun[]; total: number }>
) {
  return projects.flatMap<ProjectWithReport>((project, index) => {
    const runList = runLists[index];
    if (!runList?.runs.length) return [];
    const sorted = [...runList.runs].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
    return [{ latestRun: sorted[0], project, totalCount: runList.total }];
  }).sort((left, right) => Date.parse(right.latestRun.createdAt) - Date.parse(left.latestRun.createdAt));
}

export function RehearsalReportListPage({ projectId }: { projectId?: string }) {
  const [items, setItems] = useState<ProjectWithReport[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [reloadKey, setReloadKey] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 8;
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pagedItems = useMemo(
    () => items.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [items, currentPage]
  );

  useEffect(() => {
    if (projectId) {
      navigateTo(`/reports/${encodeURIComponent(projectId)}`);
      return;
    }

    let isMounted = true;
    setState("loading");
    void fetchProjects()
      .then(async (projects) => {
        const runLists = await Promise.all(projects.map((project) => fetchProjectRehearsalReportRuns(project.projectId)));
        if (!isMounted) return;
        setItems(buildProjectReportItems(projects, runLists));
        setState("ready");
      })
      .catch(() => {
        if (!isMounted) return;
        setItems([]);
        setState("error");
      });
    return () => { isMounted = false; };
  }, [projectId, reloadKey]);

  return (
    <WorkspaceContainer
      as="section"
      className="orbit-report-hub"
      width="content"
    >
      <section className="orbit-report-list-shell" aria-label="프로젝트별 리허설 리포트">
        {state === "error" ? (
          <OrbitFailureState
            description="연결을 확인한 뒤 프로젝트 리포트를 다시 불러오세요."
            onRetry={() => setReloadKey((current) => current + 1)}
            title="리포트를 불러오지 못했습니다."
          />
        ) : null}
        {state === "loading" ? <div className="orbit-report-list-status" role="status">리포트를 불러오는 중입니다.</div> : null}
        {state === "ready" && items.length === 0 ? <OrbitEmptyState action={<OrbitButton onClick={() => navigateTo("/project?intent=rehearsal")} variant="secondary">리포트용 리허설 시작하기</OrbitButton>} description="마이크 녹음과 AI 분석까지 완료한 리허설이 프로젝트별 리포트로 쌓입니다." title="아직 분석된 리허설이 없습니다." /> : null}
        {state === "ready" && items.length > 0 ? (
          <div className="orbit-report-project-table" role="table" aria-label="프로젝트별 리허설 리포트">
            <div className="orbit-report-project-row heading" role="row">
              <span className="orbit-report-project-col-project" role="columnheader">프로젝트</span>
              <span className="orbit-report-project-col-date" role="columnheader">최근 리허설</span>
              <span className="orbit-report-project-col-count" role="columnheader">누적 회차</span>
              <span aria-hidden="true" className="orbit-report-project-col-action" />
            </div>
            {pagedItems.map(({ project, latestRun, totalCount }) => (
              <button className="orbit-report-project-row" key={project.projectId} onClick={() => navigateTo(`/reports/${encodeURIComponent(project.projectId)}`)} role="row" type="button">
                <span className="orbit-report-project-name orbit-report-project-col-project" role="cell">
                  <i aria-hidden="true" className="orbit-report-project-thumb">
                    <IconFileText size={18} />
                    <Suspense fallback={null}>
                      <ProjectRowSlidePreview
                        className="orbit-report-project-thumb-canvas"
                        projectId={project.projectId}
                      />
                    </Suspense>
                  </i>
                  <span><strong>{project.title}</strong><small>프로젝트 종합 리포트</small></span>
                </span>
                <span className="orbit-report-project-col-date" role="cell">{formatRunDate(latestRun.createdAt)}</span>
                <strong className="orbit-report-project-col-count" role="cell">{totalCount}회</strong>
                <IconChevronRight aria-hidden="true" className="orbit-report-project-col-action" size={18} />
              </button>
            ))}
          </div>
        ) : null}
      </section>

      {state === "ready" && pageCount > 1 ? (
        <nav aria-label="리포트 목록 페이지" className="orbit-project-pagination">
          <button aria-label="이전 페이지" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)} type="button">
            <IconChevronLeft aria-hidden="true" size={15} />
          </button>
          {Array.from({ length: pageCount }, (_, index) => (
            <button
              aria-current={currentPage === index + 1 ? "page" : undefined}
              className={currentPage === index + 1 ? "is-active" : ""}
              key={index}
              onClick={() => setPage(index + 1)}
              type="button"
            >
              {index + 1}
            </button>
          ))}
          <button aria-label="다음 페이지" disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)} type="button">
            <IconChevronRight aria-hidden="true" size={15} />
          </button>
        </nav>
      ) : null}
    </WorkspaceContainer>
  );
}
