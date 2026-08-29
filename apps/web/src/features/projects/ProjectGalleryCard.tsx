import type { ProjectListItem } from "@orbit/shared/projects";
import {
  IconPin,
  IconPinFilled,
  IconPresentation,
  IconPresentationAnalytics,
  IconTrash,
} from "@tabler/icons-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";

import { OrbitIconButton } from "../../components/ui";
import pptxProcessingPlaceholder from "../../assets/projects/pptx-processing-placeholder.png";
import type { PptxImportOperation } from "./PptxImportProvider";

const ProjectSlidePreview = lazy(() => import("./ProjectSlidePreview"));

export function ProjectGalleryCard(props: {
  createdAtLabel: string;
  deleting: boolean;
  isPinned: boolean;
  onDelete: () => void;
  onOpen: () => void;
  onRehearse: () => void;
  onTogglePinned: () => void;
  pinning: boolean;
  pptxImport: PptxImportOperation | null;
  project: ProjectListItem;
}) {
  const [isPreviewVisible, setIsPreviewVisible] = useState(false);
  const previewRef = useRef<HTMLButtonElement>(null);
  const serverPptxGeneration =
    props.project.generation?.type === "pptx-ooxml-generation"
      ? props.project.generation
      : null;
  const isPptxCard = Boolean(props.pptxImport || serverPptxGeneration);
  const isPptxComplete = props.pptxImport?.stage === "succeeded";
  const isPptxFailed = props.pptxImport?.stage === "failed";
  const isProcessing = Boolean(
    isPptxCard &&
    (serverPptxGeneration ||
      (props.pptxImport && !isPptxComplete && !isPptxFailed)),
  );
  const progress =
    props.pptxImport?.progress ?? serverPptxGeneration?.progress ?? null;
  const message =
    props.pptxImport?.message ||
    serverPptxGeneration?.message ||
    "발표자 노트와 레이아웃을 정리하고 있습니다.";

  useEffect(() => {
    const target = previewRef.current;
    if (!target) return;
    if (!("IntersectionObserver" in window)) {
      setIsPreviewVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setIsPreviewVisible(true);
        observer.disconnect();
      },
      { rootMargin: "240px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      className={`${
        props.isPinned
          ? "orbit-project-gallery-card is-pinned"
          : "orbit-project-gallery-card"
      }${isPptxCard ? " is-pptx-processing" : ""}`}
      role="listitem"
    >
      <button
        aria-label={`${props.project.title} 편집`}
        className="orbit-project-gallery-preview"
        disabled={isProcessing}
        onClick={props.onOpen}
        ref={previewRef}
        type="button"
      >
        {isPptxCard ? (
          <img
            alt=""
            className="orbit-project-gallery-pptx-placeholder"
            src={pptxProcessingPlaceholder}
          />
        ) : (
          <span aria-hidden="true" className="orbit-project-gallery-fallback">
            <IconPresentation size={28} stroke={1.5} />
          </span>
        )}
        {isPreviewVisible && !isPptxCard ? (
          <Suspense fallback={null}>
            <ProjectSlidePreview
              className="orbit-project-gallery-canvas"
              projectId={props.project.projectId}
            />
          </Suspense>
        ) : null}
        {isPptxCard ? (
          <span className="orbit-project-gallery-progress">
            <span>
              <span>
                {isPptxComplete
                  ? "미리보기 준비 완료"
                  : isPptxFailed
                    ? "변환 실패"
                    : "미리보기 만드는 중"}
              </span>
              <strong>
                {progress === null ? "업로드 중" : `${progress}%`}
              </strong>
            </span>
            <progress
              aria-label={`${props.project.title} PPTX 변환 진행률`}
              max="100"
              value={progress ?? undefined}
            >
              {progress ?? 0}%
            </progress>
          </span>
        ) : null}
      </button>

      <div className="orbit-project-gallery-hover-actions">
        <OrbitIconButton
          aria-label={
            props.isPinned
              ? `${props.project.title} 고정 해제`
              : `${props.project.title} 고정`
          }
          aria-pressed={props.isPinned}
          className={
            props.isPinned
              ? "orbit-project-gallery-pin is-pinned"
              : "orbit-project-gallery-pin"
          }
          disabled={props.pinning || isProcessing}
          onClick={props.onTogglePinned}
          title={props.isPinned ? "고정 해제" : "고정"}
          variant="surface"
        >
          {props.isPinned ? (
            <IconPinFilled aria-hidden="true" size={16} />
          ) : (
            <IconPin aria-hidden="true" size={16} stroke={1.8} />
          )}
        </OrbitIconButton>
        <OrbitIconButton
          aria-label={`${props.project.title} 리허설 시작`}
          disabled={isProcessing}
          onClick={props.onRehearse}
          title="리허설 시작"
          variant="surface"
        >
          <IconPresentationAnalytics
            aria-hidden="true"
            size={16}
            stroke={1.8}
          />
        </OrbitIconButton>
        <OrbitIconButton
          aria-label={`${props.project.title} 삭제`}
          className="orbit-project-gallery-delete"
          disabled={props.deleting || isProcessing}
          onClick={props.onDelete}
          title="삭제"
          variant="surface"
        >
          <IconTrash aria-hidden="true" size={16} stroke={1.8} />
        </OrbitIconButton>
      </div>

      <div className="orbit-project-gallery-meta">
        {isPptxCard ? (
          <span
            className={`orbit-project-gallery-status${isPptxComplete ? " is-complete" : isPptxFailed ? " is-failed" : ""}`}
          >
            {isPptxComplete
              ? "변환 완료"
              : isPptxFailed
                ? "변환 실패"
                : "PPTX 변환 중"}
          </span>
        ) : null}
        <button
          className="orbit-project-gallery-title"
          disabled={isProcessing}
          onClick={props.onOpen}
          type="button"
        >
          <strong>{props.project.title}</strong>
          <small>{props.createdAtLabel}</small>
        </button>
        {isPptxCard ? (
          <p className="orbit-project-gallery-message">{message}</p>
        ) : null}
      </div>
    </div>
  );
}
