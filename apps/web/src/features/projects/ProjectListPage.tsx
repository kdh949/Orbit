import type { Project, ProjectListItem } from "@orbit/shared";
import { useQuery } from "@tanstack/react-query";
import {
  IconArrowsSort,
  IconCheck,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconFileText,
  IconFileUpload,
  IconPinFilled,
  IconPlayerPlayFilled,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconSparkles,
  IconTrash,
} from "@tabler/icons-react";
import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { WorkspaceContainer } from "../../components/patterns";
import {
  DropdownMenu,
  DropdownMenuItem,
  OrbitButton,
  OrbitEmptyState,
  OrbitFailureState,
  OrbitIconButton,
  OrbitInput,
} from "../../components/ui";
import {
  createProject,
  createProjectWithoutDeck,
  deleteProject,
  fetchProjects,
  updateProjectPin,
} from "./ProjectAssetWorkspace";
import { uploadAndImportPptxTemplate } from "../editor/shell/api/editorJobApi";
import {
  getPptxImportValidationMessage,
  pptxImportAccept,
} from "../editor/shell/utils/editorFileValidation";
import { ProjectGalleryCard } from "./ProjectGalleryCard";
import "./orbit-project-hub.css";

const ProjectRowSlidePreview = lazy(() => import("./ProjectSlidePreview"));

export type ProjectListPageMode = "project" | "rehearsal";

export function ProjectListPage(props: {
  mode: ProjectListPageMode;
  onNavigate: (path: string) => void;
}) {
  const projects = useProjectList();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"newest" | "oldest" | "title">("newest");
  const [isCreating, setIsCreating] = useState(false);
  const [pptxImportPhase, setPptxImportPhase] = useState<
    "idle" | "uploading" | "importing"
  >("idle");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pinningId, setPinningId] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState("");
  const pptxInputRef = useRef<HTMLInputElement>(null);
  const isRehearsal = props.mode === "rehearsal";
  const isImportingPptx = pptxImportPhase !== "idle";
  const filteredProjects = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ko-KR");
    const matches = (projects.data ?? []).filter((project) =>
      project.title.toLocaleLowerCase("ko-KR").includes(normalized),
    );
    const sorted = sortProjects(matches, sort);
    const pinned = sorted.filter((project) => project.isPinned);
    const unpinned = sorted.filter((project) => !project.isPinned);
    return [...pinned, ...unpinned];
  }, [projects.data, query, sort]);
  const [rehearsalPage, setRehearsalPage] = useState(1);
  const rehearsalPageSize = 6;
  const rehearsalPageCount = Math.max(
    1,
    Math.ceil(filteredProjects.length / rehearsalPageSize),
  );
  const currentRehearsalPage = Math.min(rehearsalPage, rehearsalPageCount);
  const pagedRehearsalProjects = useMemo(
    () =>
      filteredProjects.slice(
        (currentRehearsalPage - 1) * rehearsalPageSize,
        currentRehearsalPage * rehearsalPageSize,
      ),
    [filteredProjects, currentRehearsalPage],
  );

  useEffect(() => {
    setRehearsalPage(1);
  }, [query, sort]);

  async function createBlankProject() {
    if (isCreating || isImportingPptx) return;
    setIsCreating(true);
    setMutationError("");
    try {
      const project = await createProject("새 프레젠테이션");
      await projects.refetch();
      props.onNavigate(projectPath(project));
    } catch (cause) {
      setMutationError(
        cause instanceof Error ? cause.message : "프로젝트를 만들지 못했습니다.",
      );
    } finally {
      setIsCreating(false);
    }
  }

  async function importPptxProject(file: File) {
    const validationMessage = getPptxImportValidationMessage(file);
    if (validationMessage) {
      setMutationError(validationMessage);
      return;
    }

    let project: Project | null = null;
    setMutationError("");
    setPptxImportPhase("uploading");
    try {
      project = await createProjectWithoutDeck(projectTitleFromFile(file.name));
      await uploadAndImportPptxTemplate(project.projectId, file, {
        onPhase: setPptxImportPhase,
      });
      await projects.refetch();
      props.onNavigate(projectPath(project));
    } catch (cause) {
      if (project) {
        try {
          await deleteProject(project.projectId);
          await projects.refetch();
        } catch {
          // The original import error is more actionable than cleanup failure.
        }
      }
      setMutationError(
        cause instanceof Error ? cause.message : "PPTX를 가져오지 못했습니다.",
      );
    } finally {
      setPptxImportPhase("idle");
    }
  }

  async function removeProject(project: Project) {
    if (
      deletingId ||
      !window.confirm(`“${project.title}” 프로젝트를 삭제할까요?`)
    ) {
      return;
    }
    setDeletingId(project.projectId);
    setMutationError("");
    try {
      await deleteProject(project.projectId);
      await projects.refetch();
    } catch (cause) {
      setMutationError(
        cause instanceof Error ? cause.message : "프로젝트를 삭제하지 못했습니다.",
      );
    } finally {
      setDeletingId(null);
    }
  }

  async function togglePinnedProject(project: ProjectListItem) {
    if (pinningId) return;
    setPinningId(project.projectId);
    setMutationError("");
    try {
      await updateProjectPin(project.projectId, !project.isPinned);
      await projects.refetch();
    } catch (cause) {
      setMutationError(
        cause instanceof Error
          ? cause.message
          : "프로젝트 고정 상태를 변경하지 못했습니다.",
      );
    } finally {
      setPinningId(null);
    }
  }

  return (
    <WorkspaceContainer
      as="section"
      className={`orbit-project-hub orbit-project-explorer${
        isRehearsal ? " rehearsal-project-picker" : ""
      }`}
      width="content"
    >
      {isRehearsal ? (
        <section className="orbit-project-table-shell">
          <header className="orbit-project-toolbar">
            <ProjectSearch
              onChange={setQuery}
              placeholder="연습할 발표자료 검색"
              value={query}
            />
            <ProjectSortSelect onChange={setSort} value={sort} />
            <OrbitIconButton
              aria-label="프로젝트 새로고침"
              onClick={() => void projects.refetch()}
              variant="surface"
            >
              <IconRefresh aria-hidden="true" size={18} />
            </OrbitIconButton>
          </header>

          <ProjectState
            emptyDescription="먼저 프로젝트를 만든 뒤 리허설을 시작하세요."
            emptySearch={Boolean(query.trim()) && !filteredProjects.length}
            query={projects}
          >
            <ProjectTable
              deletingId={deletingId}
              mode={props.mode}
              onNavigate={props.onNavigate}
              projects={pagedRehearsalProjects}
            />
            {rehearsalPageCount > 1 ? (
              <nav
                aria-label="리허설 목록 페이지"
                className="orbit-project-pagination"
              >
                <button
                  aria-label="이전 페이지"
                  disabled={currentRehearsalPage <= 1}
                  onClick={() => setRehearsalPage(currentRehearsalPage - 1)}
                  type="button"
                >
                  <IconChevronLeft aria-hidden="true" size={15} />
                </button>
                {Array.from({ length: rehearsalPageCount }, (_, index) => (
                  <button
                    aria-current={
                      currentRehearsalPage === index + 1 ? "page" : undefined
                    }
                    className={
                      currentRehearsalPage === index + 1 ? "is-active" : ""
                    }
                    key={index}
                    onClick={() => setRehearsalPage(index + 1)}
                    type="button"
                  >
                    {index + 1}
                  </button>
                ))}
                <button
                  aria-label="다음 페이지"
                  disabled={currentRehearsalPage >= rehearsalPageCount}
                  onClick={() => setRehearsalPage(currentRehearsalPage + 1)}
                  type="button"
                >
                  <IconChevronRight aria-hidden="true" size={15} />
                </button>
              </nav>
            ) : null}
          </ProjectState>
        </section>
      ) : (
        <>
          <header className="orbit-project-commandbar">
            <div
              aria-label="새 발표자료 만들기"
              className="orbit-project-create-actions"
              role="group"
            >
              <OrbitButton
                className="orbit-project-commandbar-ai"
                icon={<IconSparkles aria-hidden="true" size={18} />}
                onClick={() => props.onNavigate("/createdeck")}
              >
                AI 발표자료 만들기
              </OrbitButton>
              <ProjectCommandbarAction
                className="orbit-project-commandbar-blank"
                disabled={isImportingPptx}
                icon={<IconPlus aria-hidden="true" size={18} />}
                loading={isCreating}
                onClick={() => void createBlankProject()}
              >
                {isCreating ? "생성 중" : "빈 프로젝트"}
              </ProjectCommandbarAction>
              <ProjectCommandbarAction
                className="orbit-project-commandbar-upload"
                disabled={isCreating}
                icon={<IconFileUpload aria-hidden="true" size={18} />}
                loading={isImportingPptx}
                onClick={() => pptxInputRef.current?.click()}
              >
                {pptxImportPhase === "importing"
                  ? "PPTX 변환 중"
                  : "PPTX 업로드"}
              </ProjectCommandbarAction>
              <input
                accept={pptxImportAccept}
                aria-label="PPTX 파일 선택"
                className="orbit-project-file-input"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = "";
                  if (file) void importPptxProject(file);
                }}
                ref={pptxInputRef}
                type="file"
              />
            </div>

            <div className="orbit-project-browse-tools">
              <ProjectSearch
                onChange={setQuery}
                placeholder="프로젝트 검색"
                value={query}
              />
              <ProjectSortMenu onChange={setSort} value={sort} />
            </div>
          </header>

          {mutationError ? (
            <p className="orbit-project-error" role="alert">
              {mutationError}
            </p>
          ) : null}

          <ProjectState
            emptySearch={Boolean(query.trim()) && !filteredProjects.length}
            query={projects}
          >
            <ProjectGallery
              deletingId={deletingId}
              onDelete={removeProject}
              onNavigate={props.onNavigate}
              onTogglePinned={togglePinnedProject}
              pinningId={pinningId}
              projects={filteredProjects}
            />
          </ProjectState>
        </>
      )}
    </WorkspaceContainer>
  );
}

function ProjectCommandbarAction(props: {
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  icon: ReactNode;
  loading?: boolean;
  onClick: () => void;
}) {
  const className = [
    "orbit-project-commandbar-action",
    props.className,
  ].filter(Boolean).join(" ");

  return (
    <OrbitButton
      className={className}
      disabled={props.disabled}
      icon={props.icon}
      loading={props.loading}
      onClick={props.onClick}
      variant="quiet"
    >
      {props.children}
    </OrbitButton>
  );
}

function ProjectSearch(props: {
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
}) {
  return (
    <label className="orbit-project-search">
      <IconSearch aria-hidden="true" size={18} />
      <OrbitInput
        aria-label="프로젝트 검색"
        onChange={(event) => props.onChange(event.currentTarget.value)}
        placeholder={props.placeholder}
        value={props.value}
      />
    </label>
  );
}

function ProjectSortSelect(props: {
  onChange: (value: "newest" | "oldest" | "title") => void;
  value: "newest" | "oldest" | "title";
}) {
  return (
    <select
      aria-label="프로젝트 정렬"
      onChange={(event) =>
        props.onChange(event.currentTarget.value as typeof props.value)
      }
      value={props.value}
    >
      <option value="newest">최근 생성순</option>
      <option value="oldest">오래된순</option>
      <option value="title">이름순</option>
    </select>
  );
}

const projectSortOptions = [
  { label: "최근 생성순", value: "newest" },
  { label: "오래된순", value: "oldest" },
  { label: "이름순", value: "title" },
] as const;

function ProjectSortMenu(props: {
  onChange: (value: "newest" | "oldest" | "title") => void;
  value: "newest" | "oldest" | "title";
}) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const selected = projectSortOptions.find((option) => option.value === props.value);

  useEffect(() => {
    if (!isOpen) return;

    function closeOnPointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setIsOpen(false);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
    }

    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen]);

  return (
    <div className="orbit-project-sort-menu" ref={menuRef}>
      <OrbitButton
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label={`프로젝트 정렬: ${selected?.label ?? "최근 생성순"}`}
        className="orbit-project-sort-trigger"
        icon={<IconArrowsSort aria-hidden="true" size={17} />}
        onClick={() => setIsOpen((current) => !current)}
        variant="quiet"
      >
        {selected?.label ?? "최근 생성순"}
        <IconChevronDown aria-hidden="true" size={15} />
      </OrbitButton>
      {isOpen ? (
        <DropdownMenu
          align="end"
          aria-label="프로젝트 정렬"
          className="orbit-project-sort-dropdown"
          variant="white"
        >
          {projectSortOptions.map((option) => (
            <DropdownMenuItem
              aria-checked={option.value === props.value}
              icon={
                option.value === props.value ? (
                  <IconCheck aria-hidden="true" size={16} />
                ) : (
                  <span className="orbit-project-sort-icon-spacer" />
                )
              }
              key={option.value}
              onClick={() => {
                props.onChange(option.value);
                setIsOpen(false);
              }}
              role="menuitemradio"
            >
              {option.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenu>
      ) : null}
    </div>
  );
}

function ProjectGallery(props: {
  deletingId: string | null;
  onDelete: (project: Project) => void;
  onNavigate: (path: string) => void;
  onTogglePinned: (project: ProjectListItem) => void;
  pinningId: string | null;
  projects: ProjectListItem[];
}) {
  return (
    <div
      aria-label="프로젝트 목록"
      className="orbit-project-gallery"
      role="list"
    >
      {props.projects.map((project) => (
        <ProjectGalleryCard
          createdAtLabel={formatProjectDate(project)}
          deleting={props.deletingId === project.projectId}
          isPinned={project.isPinned}
          key={project.projectId}
          onDelete={() => props.onDelete(project)}
          onOpen={() => props.onNavigate(projectPath(project))}
          onRehearse={() =>
            props.onNavigate(
              `/rehearsal/${encodeURIComponent(project.projectId)}`,
            )
          }
          onTogglePinned={() => props.onTogglePinned(project)}
          pinning={props.pinningId === project.projectId}
          project={project}
        />
      ))}
    </div>
  );
}

function useProjectList() {
  return useQuery({
    queryFn: () => fetchProjects(),
    queryKey: ["projects"],
    retry: false,
  });
}

function ProjectState(props: {
  children: ReactNode;
  emptyDescription?: string;
  emptySearch?: boolean;
  query: ReturnType<typeof useProjectList>;
}) {
  if (props.query.isLoading) {
    return (
      <div className="orbit-project-state" role="status">
        프로젝트를 불러오는 중입니다.
      </div>
    );
  }
  if (props.query.isError) {
    return (
      <OrbitFailureState
        description="연결을 확인한 뒤 프로젝트 목록을 다시 불러오세요."
        onRetry={() => void props.query.refetch()}
        title="프로젝트를 불러오지 못했습니다."
      />
    );
  }
  if (props.emptySearch) {
    return (
      <OrbitEmptyState
        description="다른 검색어로 다시 찾아보세요."
        title="검색 결과가 없습니다."
      />
    );
  }
  if (!props.query.data?.length) {
    return (
      <OrbitEmptyState
        description={
          props.emptyDescription ??
          "AI 발표자료 만들기로 첫 프로젝트를 시작하세요."
        }
        title="아직 프로젝트가 없습니다."
      />
    );
  }
  return <>{props.children}</>;
}

function ProjectTable(props: {
  deletingId: string | null;
  mode: ProjectListPageMode;
  onDelete?: (project: Project) => void;
  onNavigate: (path: string) => void;
  projects: ProjectListItem[];
}) {
  const isRehearsal = props.mode === "rehearsal";

  return (
    <div
      aria-label={isRehearsal ? "리허설 프로젝트 목록" : "프로젝트 목록"}
      className="orbit-project-table"
      role="table"
    >
      <div className="orbit-project-row heading" role="row">
        <span role="columnheader">프로젝트</span>
        <span role="columnheader">생성일</span>
        <span aria-hidden="true" role="columnheader" />
      </div>
      {props.projects.map((project) => {
        const rehearsalPath = `/rehearsal/${encodeURIComponent(project.projectId)}`;
        return (
          <div
            className={`orbit-project-row${project.isPinned ? " is-pinned" : ""}`}
            key={project.projectId}
            role="row"
          >
            <button
              className="orbit-project-title"
              onClick={() =>
                props.onNavigate(
                  isRehearsal ? rehearsalPath : projectPath(project),
                )
              }
              role="cell"
              type="button"
            >
              <span aria-hidden="true" className="orbit-project-thumb">
                <IconFileText size={18} />
                <Suspense fallback={null}>
                  <ProjectRowSlidePreview
                    className="orbit-project-thumb-canvas"
                    projectId={project.projectId}
                  />
                </Suspense>
              </span>
              <span>
                <strong>
                  {project.isPinned ? (
                    <IconPinFilled
                      aria-label="고정됨"
                      className="orbit-project-pin-badge"
                      size={13}
                    />
                  ) : null}
                  {project.title}
                </strong>
              </span>
            </button>
            <span className="orbit-project-date" role="cell">
              {formatProjectDate(project)}
            </span>
            <span className="orbit-project-actions" role="cell">
              {isRehearsal ? (
                <OrbitButton
                  className="orbit-project-practice-cta"
                  icon={<IconPlayerPlayFilled aria-hidden="true" size={14} />}
                  onClick={() => props.onNavigate(rehearsalPath)}
                  size="compact"
                >
                  연습하기
                </OrbitButton>
              ) : (
                <>
                  <button
                    className="orbit-project-action"
                    onClick={() => props.onNavigate(projectPath(project))}
                    type="button"
                  >
                    편집
                  </button>
                  <button
                    className="orbit-project-action"
                    onClick={() => props.onNavigate(rehearsalPath)}
                    type="button"
                  >
                    리허설
                  </button>
                </>
              )}
              {props.onDelete ? (
                <OrbitIconButton
                  aria-label={`${project.title} 삭제`}
                  disabled={props.deletingId === project.projectId}
                  onClick={() => props.onDelete?.(project)}
                  variant="plain"
                >
                  <IconTrash aria-hidden="true" size={17} />
                </OrbitIconButton>
              ) : null}
            </span>
          </div>
        );
      })}
    </div>
  );
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
  return Number.isNaN(date.getTime())
    ? "날짜 없음"
    : date.toLocaleDateString("ko-KR");
}

function projectPath(project: Project) {
  return `/project/${encodeURIComponent(project.projectId)}`;
}

function projectTitleFromFile(fileName: string) {
  const title = fileName.replace(/\.pptx$/i, "").trim();
  return title || "가져온 프레젠테이션";
}
