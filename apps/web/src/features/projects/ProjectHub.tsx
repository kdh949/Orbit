import { demoIds } from "@orbit/shared/common";
import { type CommunityTemplateCard } from "@orbit/shared/community-templates";
import { type PptxImportPreference } from "@orbit/shared/deck";
import {
  type Project,
  type ProjectListItem,
  type ProjectListSort,
  type ProjectPageRequest,
  type ProjectTagColor,
  type ProjectTagDefinition,
} from "@orbit/shared/projects";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  IconAdjustmentsHorizontal,
  IconArrowRight,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconChevronDown,
  IconEye,
  IconFileUpload,
  IconHeartFilled,
  IconLayoutGrid,
  IconList,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconSparkles,
  IconTag,
  IconX,
} from "@tabler/icons-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { WorkspaceContainer } from "../../components/patterns";
import {
  DropdownMenu,
  DropdownMenuItem,
  GradientButton,
  OrbitButton,
  OrbitIconButton,
  OrbitInput,
} from "../../components/ui";
import "../../styles/tokens.css";
import { PptxImportPreferenceDialog } from "../editor/shell/components/PptxImportPreferenceDialog";
import {
  createProjectTagDefinition,
  fetchProjectTagDefinitions,
  projectTagDefinitionsQueryKey,
} from "../auth/auth-session";
import {
  getPptxImportValidationMessage,
  pptxImportAccept,
} from "../editor/shell/utils/editorFileValidation";
import {
  createProject,
  deleteProject,
  fetchProjectPage,
  updateProjectPin,
  updateProjectTags,
} from "./ProjectAssetWorkspace";
import { WorkspaceProjectCard } from "./WorkspaceProjectCard";
import {
  mergePptxImportProject,
  usePptxImport,
} from "./PptxImportProvider";
import "./workspace-home.css";
import "./figma-home.css";
import { CreateProjectCard } from "./CreateProjectCard";
import { ProjectTagChip } from "./ProjectTagChip";
import { CommunityTemplateGalleryDialog } from "../community-templates/CommunityTemplateGalleryDialog";
import { CommunityTemplatePublishToast } from "../community-templates/CommunityTemplatePublishToast";
import { PublishCommunityTemplateDialog } from "../community-templates/PublishCommunityTemplateDialog";
import { CommunityTemplatePreview } from "../community-templates/CommunityTemplatePreview";
import { fetchCommunityDiscover } from "../community-templates/communitySocialApi";
import {
  createCommunityTemplateApplyAttempt,
  executeCommunityTemplateApply,
  type FailedCommunityTemplateApply,
} from "../community-templates/communityTemplateApplication";
import {
  CommunityTemplateWebError,
  communityTemplateKeys,
  useCommunityTemplate,
} from "../community-templates/communityTemplateApi";

type ProjectHubProps = {
  onNavigate: (path: string) => void;
};

type ProjectSort = ProjectListSort;
type ProjectViewMode = "grid" | "list";
const maxProjectTags = 12;
const maxTagLength = 20;
const projectTagColorOptions: Array<{ label: string; value: ProjectTagColor }> = [
  { label: "노랑", value: "yellow" },
  { label: "파랑", value: "blue" },
  { label: "초록", value: "green" },
  { label: "주황", value: "orange" },
  { label: "보라", value: "purple" },
  { label: "빨강", value: "red" },
];

export function OrbitWorkspaceHome(props: ProjectHubProps & { userName?: string }) {
  const queryClient = useQueryClient();
  const communityTrackRef = useRef<HTMLDivElement>(null);
  const pptxInputRef = useRef<HTMLInputElement>(null);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishReturnFocus, setPublishReturnFocus] = useState(false);
  const [publishToast, setPublishToast] = useState<string | null>(null);
  const [applyingInstanceKey, setApplyingInstanceKey] = useState<string | null>(
    null,
  );
  const [applyFailure, setApplyFailure] =
    useState<FailedCommunityTemplateApply | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<ProjectSort>("latest");
  const [viewMode, setViewMode] = useState<ProjectViewMode>("grid");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [isTagFilterOpen, setIsTagFilterOpen] = useState(false);
  const [pinningId, setPinningId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isTagEditorOpen, setIsTagEditorOpen] = useState(false);
  const [newTag, setNewTag] = useState("");
  const [newTagColor, setNewTagColor] = useState<ProjectTagColor>("yellow");
  const [tagError, setTagError] = useState("");
  const [tagSaving, setTagSaving] = useState(false);
  const [pendingPptxImportFile, setPendingPptxImportFile] = useState<File | null>(null);
  const [actionError, setActionError] = useState("");
  const pptxImport = usePptxImport();
  const isImportingPptx = pptxImport.isImporting;
  const projects = useProjectList({ filter: "all", query, sort, tags: selectedTags });
  const projectTags = useQuery({
    queryKey: projectTagDefinitionsQueryKey,
    queryFn: () => fetchProjectTagDefinitions(),
    retry: false,
  });
  const communityTemplates = useQuery({
    queryKey: ["community", "home", "latest"],
    queryFn: () =>
      fetchCommunityDiscover({
        sort: "likes",
        page: 1,
        limit: 6,
      }),
    retry: false,
    staleTime: 60_000,
  });

  const loadedProjects = useMemo(
    () => projects.data?.pages.flatMap((page) => page.items) ?? [],
    [projects.data],
  );
  const communityItems = useMemo(
    () => communityTemplates.data?.items ?? [],
    [communityTemplates.data],
  );
  useEffect(() => {
    const track = communityTrackRef.current;
    if (!track) return undefined;
    track.scrollLeft = 0;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const moveTrack = () => {
      if (reducedMotion.matches || track.matches(":hover") || track.contains(document.activeElement)) return;

      const firstCard = track.querySelector<HTMLElement>(".workspace-community-card");
      const maxScrollLeft = track.scrollWidth - track.clientWidth;
      if (!firstCard || maxScrollLeft <= 1) return;

      const gap = Number.parseFloat(window.getComputedStyle(track).columnGap) || 0;
      const step = firstCard.offsetWidth + gap;
      const atEnd = track.scrollLeft >= maxScrollLeft - 2;
      track.scrollTo({
        behavior: "smooth",
        left: atEnd ? 0 : Math.min(track.scrollLeft + step, maxScrollLeft),
      });
    };

    const interval = window.setInterval(moveTrack, 3_800);
    return () => window.clearInterval(interval);
  }, [communityItems.length]);
  const availableTags = useMemo(() => projectTags.data?.tags ?? [], [projectTags.data]);
  const cardTagOptions = availableTags;
  const visibleProjects = useMemo(
    () => mergePptxImportProject(loadedProjects, pptxImport.operation),
    [loadedProjects, pptxImport.operation],
  );

  const dismissPublishToast = useCallback(() => {
    setPublishToast(null);
  }, []);

  async function applyTemplate(
    instanceKey: string,
    card: CommunityTemplateCard,
  ) {
    if (applyingInstanceKey) return;

    const attempt = createCommunityTemplateApplyAttempt(
      instanceKey,
      card,
      applyFailure,
    );
    setApplyingInstanceKey(instanceKey);
    setApplyFailure(null);

    try {
      await executeCommunityTemplateApply(
        { attempt, workspaceId: demoIds.workspaceId },
        {
          closeGallery: () => setGalleryOpen(false),
          invalidateProjects: () =>
            queryClient.invalidateQueries({ queryKey: ["projects"] }),
          invalidateRecent: () =>
            queryClient.invalidateQueries({
              queryKey: communityTemplateKeys.recent,
            }),
          navigate: props.onNavigate,
          useTemplate: useCommunityTemplate,
        },
      );
    } catch (cause) {
      setApplyFailure({
        ...attempt,
        message:
          cause instanceof CommunityTemplateWebError
            ? cause.message
            : "템플릿으로 프로젝트를 만들지 못했습니다.",
      });
    } finally {
      setApplyingInstanceKey(null);
    }
  }

  async function createBlankProject() {
    if (isCreating || isImportingPptx) return;
    setIsCreating(true);
    setActionError("");
    try {
      const project = await createProject("새 프레젠테이션");
      await projects.refetch();
      props.onNavigate(projectPath(project));
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "프로젝트를 만들지 못했습니다.");
    } finally {
      setIsCreating(false);
    }
  }

  async function importPptxProject(
    file: File,
    importPreference: PptxImportPreference,
  ) {
    const validationMessage = getPptxImportValidationMessage(file);
    if (validationMessage) {
      setActionError(validationMessage);
      return;
    }

    setActionError("");
    try {
      await pptxImport.startImport(file, importPreference);
      await projects.refetch();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "PPTX를 가져오지 못했습니다.");
    }
  }

  async function togglePinnedProject(project: ProjectListItem) {
    if (pinningId) return;
    setPinningId(project.projectId);
    setActionError("");
    try {
      await updateProjectPin(project.projectId, !project.isPinned);
      await projects.refetch();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "프로젝트 고정 상태를 변경하지 못했습니다.");
    } finally {
      setPinningId(null);
    }
  }

  async function removeProject(project: Project) {
    if (deletingId || !window.confirm(`“${project.title}” 프로젝트를 삭제할까요?`)) return;
    setDeletingId(project.projectId);
    setActionError("");
    try {
      await deleteProject(project.projectId);
      await projects.refetch();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "프로젝트를 삭제하지 못했습니다.");
    } finally {
      setDeletingId(null);
    }
  }

  function openTagEditor() {
    setIsTagEditorOpen(true);
    setNewTag("");
    setNewTagColor("yellow");
    setTagError("");
  }

  async function toggleProjectTag(project: ProjectListItem, tag: string) {
    const nextTags = project.tags.includes(tag)
      ? project.tags.filter((item) => item !== tag)
      : [...project.tags, tag].slice(0, maxProjectTags);
    setActionError("");
    try {
      await updateProjectTags(project.projectId, nextTags);
      await projects.refetch();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "태그를 변경하지 못했습니다.");
    }
  }

  async function saveProjectTags() {
    if (tagSaving) return;
    const tag = newTag.trim().replace(/\s+/g, " ");
    if (!tag) {
      setTagError("태그 이름을 입력해 주세요.");
      return;
    }
    if (tag.length > maxTagLength) {
      setTagError(`태그는 ${maxTagLength}자 이하로 입력해 주세요.`);
      return;
    }
    const isDuplicate = availableTags.some(
      (current) => current.name.localeCompare(tag, "ko-KR", { sensitivity: "base" }) === 0,
    );
    if (isDuplicate) {
      setTagError("이미 사용 중인 태그 이름입니다.");
      return;
    }
    if (availableTags.length >= maxProjectTags) {
      setTagError(`태그는 최대 ${maxProjectTags}개까지 추가할 수 있습니다.`);
      return;
    }
    setTagSaving(true);
    setTagError("");
    try {
      await createProjectTagDefinition({ name: tag, color: newTagColor });
      await projectTags.refetch();
      setIsTagEditorOpen(false);
    } catch (cause) {
      setTagError(cause instanceof Error ? cause.message : "프로젝트 태그를 저장하지 못했습니다.");
    } finally {
      setTagSaving(false);
    }
  }

  function handlePptxChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    const validationMessage = getPptxImportValidationMessage(file);
    if (validationMessage) {
      setActionError(validationMessage);
      return;
    }
    setActionError("");
    setPendingPptxImportFile(file);
  }

  function scrollCommunity(direction: -1 | 1) {
    const track = communityTrackRef.current;
    if (!track) return;

    const firstCard = track.querySelector<HTMLElement>(".workspace-community-card");
    const gap = Number.parseFloat(window.getComputedStyle(track).columnGap) || 0;
    const step = (firstCard?.getBoundingClientRect().width ?? track.clientWidth * 0.8) + gap;

    track.scrollBy({
      behavior: "smooth",
      left: direction * step,
    });
  }

  return (
    <main className="workspace-home">
      <section className="workspace-community-band">
        <WorkspaceContainer as="div" className="workspace-community" width="content">
          <div className="workspace-community-layout">
            <header className="workspace-community-intro">
              <div className="workspace-community-intro-heading">
                <p className="workspace-section-kicker">COMMUNITY</p>
                <h1>커뮤니티</h1>
                <span className="workspace-community-latest-label">인기순</span>
                <p className="workspace-community-intro-description">다양한 사용자의 발표를 발견해 보세요.</p>
              </div>
              <OrbitButton className="workspace-community-intro-arrow" onClick={() => props.onNavigate("/community")} variant="secondary">
                더보기
                <IconChevronRight aria-hidden="true" size={16} />
              </OrbitButton>
            </header>

            <div className="workspace-community-carousel">
              <OrbitIconButton aria-label="이전 커뮤니티 프로젝트" className="workspace-community-arrow is-previous" onClick={() => scrollCommunity(-1)}>
                <IconChevronLeft aria-hidden="true" size={18} />
              </OrbitIconButton>
              <div className="workspace-community-track" ref={communityTrackRef}>
                {communityTemplates.isLoading ? (
                  <div className="workspace-community-state" role="status">최근 공개 자료를 불러오는 중입니다.</div>
                ) : communityItems.length === 0 ? (
                  <div className="workspace-community-state">
                    <strong>아직 공개된 발표 프로젝트가 없습니다.</strong>
                    <span>첫 프로젝트를 공유해 커뮤니티를 시작해 보세요.</span>
                  </div>
                ) : communityItems.map((card, index) => {
                    return (
                      <button
                        aria-label={`${card.title} 커뮤니티 발표자료`}
                        className={`workspace-community-card${index === 0 ? " is-featured" : ""}`}
                        key={card.templateId}
                        onClick={() => props.onNavigate(`/community/${encodeURIComponent(card.templateId)}`)}
                        type="button"
                      >
                        <span className="workspace-community-index">{String(index + 1).padStart(2, "0")}</span>
                        <span className="workspace-community-preview">
                          <span className="workspace-community-preview-fallback"><IconSparkles aria-hidden="true" size={28} stroke={1.5} /></span>
                          <CommunityTemplatePreview card={card} className="workspace-community-preview-canvas" />
                        </span>
                        <span className="workspace-community-preview-copy">
                          <strong>{card.title}</strong>
                          <small>{card.description || "새롭게 공개된 발표 프로젝트"}</small>
                        </span>
                        <span className="workspace-community-meta">
                          <small>
                            {card.author.avatarUrl ? (
                              <img alt="" src={card.author.avatarUrl} />
                            ) : (
                              <span className="workspace-community-author-fallback" aria-hidden="true">{card.author.displayName.slice(0, 1)}</span>
                            )}
                            <span>{card.author.displayName}</span>
                          </small>
                          <span className="workspace-community-stats">
                            <span><IconEye aria-hidden="true" size={13} />{formatCommunityCount(card.stats.viewCount)}</span>
                            <span><IconHeartFilled aria-hidden="true" size={12} />{formatCommunityCount(card.stats.likeCount)}</span>
                          </span>
                        </span>
                      </button>
                    );
                  })}
              </div>
              <OrbitIconButton aria-label="다음 커뮤니티 프로젝트" className="workspace-community-arrow is-next" onClick={() => scrollCommunity(1)}>
                <IconChevronRight aria-hidden="true" size={18} />
              </OrbitIconButton>
            </div>
          </div>
        </WorkspaceContainer>
      </section>

      <WorkspaceContainer as="section" className="workspace-projects" id="workspace-projects" width="content">
        <header className="workspace-projects-heading">
          <div>
            <p className="workspace-section-kicker">YOUR WORKSPACE</p>
            <h2>내 프로젝트</h2>
          </div>
          <div className="workspace-project-actions">
            <GradientButton className="workspace-primary-gradient" onClick={() => props.onNavigate("/createdeck")}><IconSparkles aria-hidden="true" size={17} />AI 발표자료 만들기</GradientButton>
            <OrbitButton icon={<IconPlus aria-hidden="true" size={17} />} loading={isCreating} onClick={() => void createBlankProject()} variant="secondary">빈 프로젝트</OrbitButton>
            <OrbitButton icon={<IconFileUpload aria-hidden="true" size={17} />} loading={isImportingPptx} onClick={() => pptxInputRef.current?.click()} variant="secondary">PPTX 업로드</OrbitButton>
            <input accept={pptxImportAccept} className="workspace-home-file-input" disabled={isImportingPptx} onChange={handlePptxChange} ref={pptxInputRef} type="file" />
          </div>
          <label className="workspace-project-search">
            <IconSearch aria-hidden="true" size={18} />
            <OrbitInput aria-label="내 프로젝트 검색" onChange={(event) => setQuery(event.currentTarget.value)} placeholder="내 프로젝트 검색" type="search" value={query} />
            {query ? (
              <button
                aria-label="프로젝트 검색어 지우기"
                className="workspace-project-search-clear"
                onClick={() => setQuery("")}
                type="button"
              >
                <IconX aria-hidden="true" size={15} />
              </button>
            ) : null}
          </label>
          <details className="workspace-project-sort">
            <summary aria-label="프로젝트 정렬" className="workspace-project-sort-trigger">
              <span>{sort === "latest" ? "최신순" : sort === "oldest" ? "오래된 순" : "이름순"}</span>
              <IconChevronDown aria-hidden="true" size={16} />
            </summary>
            <DropdownMenu align="start" className="workspace-project-sort-menu">
              <DropdownMenuItem
                className={sort === "latest" ? "is-selected" : ""}
                icon={<IconCheck aria-hidden="true" className={sort === "latest" ? "" : "workspace-project-sort-check"} size={16} />}
                onClick={(event) => {
                  setSort("latest");
                  event.currentTarget.closest("details")?.removeAttribute("open");
                }}
              >
                최신순
              </DropdownMenuItem>
              <DropdownMenuItem
                className={sort === "oldest" ? "is-selected" : ""}
                icon={<IconCheck aria-hidden="true" className={sort === "oldest" ? "" : "workspace-project-sort-check"} size={16} />}
                onClick={(event) => {
                  setSort("oldest");
                  event.currentTarget.closest("details")?.removeAttribute("open");
                }}
              >
                오래된 순
              </DropdownMenuItem>
              <DropdownMenuItem
                className={sort === "name" ? "is-selected" : ""}
                icon={<IconCheck aria-hidden="true" className={sort === "name" ? "" : "workspace-project-sort-check"} size={16} />}
                onClick={(event) => {
                  setSort("name");
                  event.currentTarget.closest("details")?.removeAttribute("open");
                }}
              >
                이름순
              </DropdownMenuItem>
            </DropdownMenu>
          </details>
          <div aria-label="프로젝트 보기 방식" className="workspace-view-toggle" role="group">
            <OrbitIconButton aria-label="그리드 보기" aria-pressed={viewMode === "grid"} onClick={() => setViewMode("grid")} variant={viewMode === "grid" ? "primary" : "plain"}>
              <IconLayoutGrid aria-hidden="true" size={18} />
            </OrbitIconButton>
            <OrbitIconButton aria-label="리스트 보기" aria-pressed={viewMode === "list"} onClick={() => setViewMode("list")} variant={viewMode === "list" ? "primary" : "plain"}>
              <IconList aria-hidden="true" size={19} />
            </OrbitIconButton>
          </div>
        </header>

        <div className="workspace-filter-row">
          {availableTags.length ? (
            <div aria-label="태그 필터" className="workspace-tag-filter-chips">
              <span className="workspace-tag-filter-label"><IconTag aria-hidden="true" size={14} />태그</span>
              {availableTags.map((tag) => (
                <ProjectTagChip
                  color={tag.color}
                  key={tag.name}
                  name={tag.name}
                  onClick={() => setSelectedTags((current) => current.includes(tag.name) ? current.filter((item) => item !== tag.name) : [...current, tag.name])}
                  selected={selectedTags.includes(tag.name)}
                />
              ))}
            </div>
          ) : null}
          <div className="workspace-tag-filter-wrap">
            <OrbitButton
              aria-expanded={isTagFilterOpen}
              icon={<IconAdjustmentsHorizontal aria-hidden="true" size={15} />}
              onClick={() => setIsTagFilterOpen((current) => !current)}
              variant="secondary"
            >
              <span className="workspace-tag-filter-button-label">
                <span>태그 편집</span>
                <IconChevronDown aria-hidden="true" size={14} />
              </span>
            </OrbitButton>
            {isTagFilterOpen ? (
              <div className="workspace-tag-filter-popover" role="dialog" aria-label="태그 편집">
                <div className="workspace-tag-filter-title"><strong>태그 편집</strong><button onClick={() => setSelectedTags([])} type="button">선택 해제</button></div>
                {availableTags.length ? (
                  <div className="workspace-tag-filter-group">
                    <span>등록된 태그</span>
                    {availableTags.map((tag) => <TagFilterOption key={tag.name} selected={selectedTags.includes(tag.name)} tag={tag} onToggle={() => setSelectedTags((current) => current.includes(tag.name) ? current.filter((item) => item !== tag.name) : [...current, tag.name])} />)}
                  </div>
                ) : null}
                <button className="workspace-tag-filter-add" disabled={availableTags.length >= maxProjectTags} onClick={() => { setIsTagFilterOpen(false); openTagEditor(); }} type="button"><IconPlus aria-hidden="true" size={16} />새 태그 만들기</button>
              </div>
            ) : null}
          </div>
        </div>

        {actionError ? <p className="workspace-home-action-error" role="alert">{actionError}</p> : null}

        {projects.isLoading ? (
          <p className="workspace-home-state" role="status">프로젝트를 불러오는 중입니다.</p>
        ) : projects.isError ? (
          <div className="workspace-home-state workspace-home-inline-error" role="alert">
            <span aria-hidden="true" className="workspace-home-inline-error-icon"><IconRefresh size={20} stroke={1.8} /></span>
            <strong>프로젝트를 불러오지 못했어요</strong>
            <OrbitButton icon={<IconRefresh aria-hidden="true" size={16} />} onClick={() => void projects.refetch()} variant="secondary">다시 시도</OrbitButton>
          </div>
        ) : (
          <>
            <div className={`workspace-home-grid is-${viewMode}`}>
              <CreateProjectCard onClick={() => props.onNavigate("/createdeck")} />
              {visibleProjects.map((project) => (
                <WorkspaceProjectCard
                  createdAtLabel={formatProjectDate(project)}
                  deleting={deletingId === project.projectId}
                  isPinned={project.isPinned}
                  key={project.projectId}
                  onDelete={() => void removeProject(project)}
                  onOpen={() => props.onNavigate(projectPath(project))}
                  onRehearse={() => props.onNavigate(`/rehearsal/${encodeURIComponent(project.projectId)}`)}
                  onReport={() =>
                    props.onNavigate(
                      `/reports/${encodeURIComponent(project.projectId)}?from=home`,
                    )
                  }
                  onTogglePinned={() => void togglePinnedProject(project)}
                  onToggleTag={(tag) => void toggleProjectTag(project, tag)}
                  tagOptions={cardTagOptions}
                  pinning={pinningId === project.projectId}
                  project={project}
                  pptxImport={
                    pptxImport.operation?.project.projectId === project.projectId
                      ? pptxImport.operation
                      : null
                  }
                />
              ))}
            </div>
            {visibleProjects.length === 0 ? (
              <div className="workspace-home-empty">
                <IconSearch aria-hidden="true" size={26} stroke={1.5} />
                <strong>조건에 맞는 프로젝트가 없습니다.</strong>
                <button onClick={() => { setQuery(""); setSelectedTags([]); }} type="button">필터 초기화</button>
              </div>
            ) : null}
            {projects.hasNextPage ? (
              <button className="workspace-home-load-more" disabled={projects.isFetchingNextPage} onClick={() => void projects.fetchNextPage()} type="button">{projects.isFetchingNextPage ? "불러오는 중" : "더 많은 프로젝트 불러오기"}<IconArrowRight aria-hidden="true" size={15} /></button>
            ) : null}
          </>
        )}
      </WorkspaceContainer>

      <CommunityTemplateGalleryDialog
        applyingInstanceKey={applyingInstanceKey}
        applyError={applyFailure?.message ?? null}
        onApply={(instanceKey, card) => void applyTemplate(instanceKey, card)}
        onClose={() => {
          if (applyingInstanceKey) return;
          setApplyFailure(null);
          setPublishReturnFocus(false);
          setGalleryOpen(false);
        }}
        onOpenPublish={() => {
          setPublishReturnFocus(false);
          setPublishOpen(true);
        }}
        onRetryApply={() => {
          if (applyFailure) {
            void applyTemplate(applyFailure.instanceKey, applyFailure.card);
          }
        }}
        open={galleryOpen && !publishOpen}
        publishReturnFocus={publishReturnFocus}
      />

      <PublishCommunityTemplateDialog
        onClose={() => {
          setPublishOpen(false);
          setPublishReturnFocus(true);
        }}
        onPublished={(title) => {
          setPublishOpen(false);
          setPublishReturnFocus(true);
          setPublishToast(title);
        }}
        open={publishOpen}
      />

      {publishToast ? (
        <CommunityTemplatePublishToast
          onDismiss={dismissPublishToast}
          title={publishToast}
        />
      ) : null}

      <PptxImportPreferenceDialog
        fileName={pendingPptxImportFile?.name ?? ""}
        onCancel={() => setPendingPptxImportFile(null)}
        onConfirm={(preference) => {
          const file = pendingPptxImportFile;
          setPendingPptxImportFile(null);
          if (file) void importPptxProject(file, preference);
        }}
        open={Boolean(pendingPptxImportFile)}
      />
      {isTagEditorOpen ? (
        <div className="workspace-tag-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !tagSaving) setIsTagEditorOpen(false); }}>
          <section aria-labelledby="workspace-tag-modal-title" aria-modal="true" className="workspace-tag-modal" role="dialog">
            <header>
              <span className="workspace-tag-modal-icon"><IconTag aria-hidden="true" size={19} /></span>
              <div><h3 id="workspace-tag-modal-title">새 태그 만들기</h3></div>
              <OrbitIconButton aria-label="태그 편집 닫기" disabled={tagSaving} onClick={() => setIsTagEditorOpen(false)}><IconX aria-hidden="true" size={18} /></OrbitIconButton>
            </header>
            <label className="workspace-tag-input-label">
              <span>태그 이름</span>
              <OrbitInput aria-invalid={Boolean(tagError)} maxLength={maxTagLength} onChange={(event) => { setNewTag(event.currentTarget.value); setTagError(""); }} placeholder="예: 포트폴리오" value={newTag} />
            </label>
            {tagError ? <p className="workspace-tag-error" role="alert">{tagError}</p> : null}
            <fieldset className="workspace-tag-color-fieldset">
              <legend>태그 색상</legend>
              <div className="workspace-tag-color-options">
                {projectTagColorOptions.map((option) => (
                  <label className={`workspace-tag-color-option is-${option.value}`} key={option.value}>
                    <input checked={newTagColor === option.value} name="project-tag-color" onChange={() => setNewTagColor(option.value)} type="radio" value={option.value} />
                    <span aria-hidden="true" />
                    <span>{option.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className={`workspace-tag-preview is-${newTagColor}`}>
              <span>미리보기</span>
              <strong>{newTag.trim() || "새 태그"}</strong>
            </div>
            <footer>
              <div><OrbitButton disabled={tagSaving} onClick={() => setIsTagEditorOpen(false)} variant="secondary">취소</OrbitButton><OrbitButton className="workspace-tag-save-button" disabled={!newTag.trim()} loading={tagSaving} onClick={() => void saveProjectTags()}>저장</OrbitButton></div>
            </footer>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function formatCommunityCount(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

function useProjectList(input: Omit<ProjectPageRequest, "limit" | "page">) {
  return useInfiniteQuery({
    queryKey: ["projects", "page", input],
    queryFn: ({ pageParam }) => fetchProjectPage({ ...input, limit: 5, page: pageParam }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.page + 1 : undefined,
    refetchInterval: (query) => query.state.data?.pages.some((page) => page.items.some((project) => project.generation)) ? 2500 : false,
    retry: false,
  });
}

function formatProjectDate(project: Project) {
  const date = new Date(project.createdAt);
  return Number.isNaN(date.getTime()) ? "날짜 없음" : date.toLocaleDateString("ko-KR");
}

function projectPath(project: Project) {
  return `/project/${encodeURIComponent(project.projectId)}`;
}

function TagFilterOption(props: { onToggle: () => void; selected: boolean; tag: ProjectTagDefinition }) {
  return (
    <button aria-pressed={props.selected} className="workspace-tag-filter-option" onClick={props.onToggle} type="button">
      <span className="workspace-tag-filter-check">{props.selected ? <IconCheck aria-hidden="true" size={12} /> : null}</span>
      <ProjectTagChip color={props.tag.color} name={props.tag.name} selected={props.selected} />
    </button>
  );
}
