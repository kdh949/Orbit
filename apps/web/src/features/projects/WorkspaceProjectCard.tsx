import type {
  ProjectListItem,
  ProjectTagDefinition,
} from "@orbit/shared/projects";
import {
  IconChartBar,
  IconChevronDown,
  IconPin,
  IconPinFilled,
  IconPresentation,
  IconPlayerPlay,
  IconSparkles,
  IconTag,
  IconTrash,
} from "@tabler/icons-react";
import { lazy, Suspense } from "react";
import { OrbitCard } from "../../components/ui";
import pptxProcessingPlaceholder from "../../assets/projects/pptx-processing-placeholder.png";
import { ProjectTagChip } from "./ProjectTagChip";
import type { PptxImportOperation } from "./PptxImportProvider";

const ProjectSlidePreview = lazy(() => import("./ProjectSlidePreview"));

type WorkspaceProjectCardProps = {
  createdAtLabel: string;
  deleting: boolean;
  isPinned: boolean;
  onDelete: () => void;
  onOpen: () => void;
  onRehearse: () => void;
  onReport: () => void;
  onTogglePinned: () => void;
  onToggleTag: (tag: string) => void;
  pinning: boolean;
  pptxImport: PptxImportOperation | null;
  project: ProjectListItem;
  tagOptions: ProjectTagDefinition[];
};

export function WorkspaceProjectCard(props: WorkspaceProjectCardProps) {
  const { project } = props;
  const serverPptxGeneration =
    project.generation?.type === "pptx-ooxml-generation"
      ? project.generation
      : null;
  const isPptxCard = Boolean(props.pptxImport || serverPptxGeneration);
  const isPptxComplete = props.pptxImport?.stage === "succeeded";
  const isPptxFailed = props.pptxImport?.stage === "failed";
  const isGenerating = Boolean(
    project.generation ||
      (props.pptxImport && !isPptxComplete && !isPptxFailed),
  );
  const pptxProgress =
    props.pptxImport?.progress ?? serverPptxGeneration?.progress ?? null;
  const pptxMessage =
    props.pptxImport?.message ||
    serverPptxGeneration?.message ||
    "발표자 노트와 레이아웃을 정리하고 있습니다.";
  const tagDefinitions = new Map(props.tagOptions.map((tag) => [tag.name, tag]));
  const visibleTags = project.tags.flatMap((name) => {
    const definition = tagDefinitions.get(name);
    return definition ? [definition] : [];
  });

  return (
    <OrbitCard aria-busy={isGenerating} className={props.isPinned ? "workspace-home-card is-pinned" : "workspace-home-card"} data-generating={isGenerating} data-interactive="true" data-pptx={isPptxCard}>
      <div className="workspace-home-thumb-wrap">
        <button aria-label={`${project.title} 편집`} className="workspace-home-thumb-button" disabled={isGenerating} onClick={props.onOpen} type="button">
          <span aria-hidden="true" className="workspace-home-thumb">
            {isPptxCard ? (
              <img className="workspace-pptx-placeholder" src={pptxProcessingPlaceholder} />
            ) : (
              <>
                <span className="workspace-home-thumb-placeholder"><IconPresentation size={34} stroke={1.35} /></span>
                <Suspense fallback={null}><ProjectSlidePreview projectId={project.projectId} /></Suspense>
              </>
            )}
          </span>
        </button>

        <div aria-label={`${project.title} 빠른 작업`} className="workspace-home-card-actions">
          <button aria-label={props.isPinned ? `${project.title} 핀 해제` : `${project.title} 핀 고정`} aria-pressed={props.isPinned} className={props.isPinned ? "workspace-home-card-action is-active" : "workspace-home-card-action"} disabled={props.pinning || isGenerating} onClick={props.onTogglePinned} type="button">
            {props.isPinned ? <IconPinFilled aria-hidden="true" size={15} /> : <IconPin aria-hidden="true" size={15} />}
          </button>
          <button aria-label={`${project.title} 리허설`} className="workspace-home-card-action" disabled={isGenerating} onClick={props.onRehearse} title="리허설" type="button"><IconPlayerPlay aria-hidden="true" size={17} stroke={1.9} /></button>
          <button aria-label={`${project.title} 리포트`} className="workspace-home-card-action" disabled={isGenerating} onClick={props.onReport} title="리포트" type="button"><IconChartBar aria-hidden="true" size={17} stroke={1.9} /></button>
          <button aria-label={`${project.title} 삭제`} className="workspace-home-card-action workspace-home-card-delete" disabled={props.deleting || isGenerating} onClick={props.onDelete} title="삭제" type="button"><IconTrash aria-hidden="true" size={17} stroke={1.9} /></button>
        </div>

        {isPptxCard ? (
          <div className="workspace-pptx-progress">
            <div>
              <span>{isPptxComplete ? "미리보기 준비 완료" : isPptxFailed ? "변환 실패" : "미리보기 만드는 중"}</span>
              {pptxProgress !== null ? <strong>{pptxProgress}%</strong> : <strong>업로드 중</strong>}
            </div>
            <progress aria-label={`${project.title} PPTX 변환 진행률`} max="100" value={pptxProgress ?? undefined}>{pptxProgress ?? 0}%</progress>
          </div>
        ) : project.generation ? (
          <div className="workspace-generation-progress">
            <span className="workspace-generation-progress-title"><IconSparkles aria-hidden="true" size={17} />AI 생성 중</span>
            <p>{project.generation.message || "슬라이드 구성을 만들고 있습니다."}</p>
            <strong>{project.generation.progress}%</strong>
            <progress aria-label={`${project.title} AI 생성 진행률`} max="100" value={project.generation.progress}>{project.generation.progress}%</progress>
          </div>
        ) : null}
      </div>

      <div className="workspace-home-card-caption">
        {isPptxCard ? (
          <span className={`workspace-pptx-status${isPptxComplete ? " is-complete" : isPptxFailed ? " is-failed" : ""}`}>
            {isPptxComplete ? "변환 완료" : isPptxFailed ? "변환 실패" : "PPTX 변환 중"}
          </span>
        ) : null}
        <div className="workspace-home-card-heading">
          <button className="workspace-home-card-title" disabled={isGenerating} onClick={props.onOpen} type="button">{project.title}</button>
          {props.tagOptions.length > 0 ? (
            <details className="workspace-home-card-tag-menu">
              <summary aria-label={`${project.title} 태그 선택`}><IconTag aria-hidden="true" size={13} /><span>태그</span><IconChevronDown aria-hidden="true" size={12} /></summary>
              <div className="workspace-home-card-tag-dropdown">
                {props.tagOptions.map((tag) => (
                  <ProjectTagChip
                    color={tag.color}
                    key={tag.name}
                    name={tag.name}
                    onClick={() => props.onToggleTag(tag.name)}
                    selected={project.tags.includes(tag.name)}
                    showSelectedIcon
                  />
                ))}
              </div>
            </details>
          ) : (
            <button aria-label="사용 가능한 태그 없음" className="workspace-home-card-tag-disabled" disabled type="button"><IconTag aria-hidden="true" size={13} /><span>태그</span></button>
          )}
        </div>
        {isPptxCard ? <p className="workspace-pptx-message">{pptxMessage}</p> : null}
        <div className="workspace-home-card-tags">
          {visibleTags.slice(0, 3).map((tag) => <ProjectTagChip color={tag.color} key={tag.name} name={tag.name} />)}
          {visibleTags.length > 3 ? <span>+{visibleTags.length - 3}</span> : null}
        </div>
        <small className="workspace-home-card-date">{props.createdAtLabel}</small>
      </div>
    </OrbitCard>
  );
}
