import type { Project } from "@orbit/shared";
import { useQuery } from "@tanstack/react-query";
import {
  IconChevronRight,
  IconPlus
} from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { WorkspaceContainer } from "../../components/patterns";
import { OrbitFailureState } from "../../components/ui";
import "../../styles/tokens.css";
import { fetchProjects, updateProjectPin } from "./ProjectAssetWorkspace";
import { WorkspaceProjectCard } from "./WorkspaceProjectCard";
import "./workspace-home.css";

type ProjectHubProps = {
  onNavigate: (path: string) => void;
};

export function OrbitWorkspaceHome(props: ProjectHubProps & { userName?: string }) {
  const projects = useProjectList();
  const [pinningId, setPinningId] = useState<string | null>(null);
  const [pinError, setPinError] = useState("");
  const recentProjects = useMemo(() => {
    const sorted = sortProjects(projects.data ?? []);
    const pinned = sorted.filter((project) => project.isPinned);
    const rest = sorted.filter((project) => !project.isPinned);
    return [...pinned, ...rest].slice(0, 10);
  }, [projects.data]);

  async function togglePinnedProject(projectId: string, isPinned: boolean) {
    if (pinningId) return;
    setPinningId(projectId);
    setPinError("");
    try {
      await updateProjectPin(projectId, !isPinned);
      await projects.refetch();
    } catch (cause) {
      setPinError(
        cause instanceof Error
          ? cause.message
          : "프로젝트 고정 상태를 변경하지 못했습니다.",
      );
    } finally {
      setPinningId(null);
    }
  }

  return (
    <div className="workspace-home">
      <WorkspaceContainer
        as="section"
        className="workspace-home-main"
        width="content"
      >
        <header className="workspace-home-head">
          <div>
            <h1>최근 작업</h1>
          </div>
          <button
            className="workspace-home-more"
            onClick={() => props.onNavigate("/project")}
            type="button"
          >
            더보기
            <IconChevronRight aria-hidden="true" size={15} />
          </button>
        </header>

        {pinError ? (
          <p className="workspace-home-pin-error" role="alert">
            {pinError}
          </p>
        ) : null}

        <div className="workspace-home-grid">
          <button
            aria-label="AI 발표자료 만들기"
            className="workspace-home-create"
            onClick={() => props.onNavigate("/createdeck")}
            type="button"
          >
            <span aria-hidden="true" className="workspace-home-create-icon">
              <IconPlus size={22} stroke={1.8} />
            </span>
            <strong>AI로 발표자료 만들기</strong>
            <small>
              아이디어를 입력하면 AI가
              <br />
              발표자료 초안을 만들어드려요.
            </small>
          </button>

          {projects.isLoading ? (
            <p className="workspace-home-state" role="status">프로젝트를 불러오는 중입니다.</p>
          ) : projects.isError ? (
            <OrbitFailureState
              className="workspace-home-state"
              description="연결을 확인한 뒤 프로젝트 목록을 다시 불러오세요."
              onRetry={() => void projects.refetch()}
              title="프로젝트를 불러오지 못했습니다."
            />
          ) : (
            recentProjects.map((project) => {
              return (
                <WorkspaceProjectCard
                  createdAtLabel={formatProjectDate(project)}
                  isPinned={project.isPinned}
                  key={project.projectId}
                  onOpen={() => props.onNavigate(projectPath(project))}
                  onRehearse={() => props.onNavigate(`/rehearsal/${encodeURIComponent(project.projectId)}`)}
                  onTogglePinned={() =>
                    void togglePinnedProject(project.projectId, project.isPinned)
                  }
                  pinning={pinningId === project.projectId}
                  project={project}
                />
              );
            })
          )}
        </div>
      </WorkspaceContainer>
    </div>
  );
}

function useProjectList() {
  return useQuery({ queryKey: ["projects"], queryFn: () => fetchProjects(), retry: false });
}

function sortProjects<T extends Project>(
  projects: T[],
  sort: "newest" | "oldest" | "title" = "newest",
): T[] {
  return [...projects].sort((left, right) => {
    if (sort === "title") return left.title.localeCompare(right.title, "ko-KR");
    const difference = Date.parse(right.createdAt) - Date.parse(left.createdAt);
    return sort === "newest" ? difference : -difference;
  });
}

function formatProjectDate(project: Project) {
  const date = new Date(project.createdAt);
  return Number.isNaN(date.getTime()) ? "날짜 없음" : date.toLocaleDateString("ko-KR");
}

function projectPath(project: Project) {
  return `/project/${encodeURIComponent(project.projectId)}`;
}
