import type { PptxNotesPreview, Slide } from "@orbit/shared/deck";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { fetchPptxNotesPreview } from "../api/deckPersistenceApi";

const unavailablePreviewCopy: Record<
  Exclude<PptxNotesPreview["status"], "available">,
  { description: string; title: string }
> = {
  absent: {
    title: "원본 노트 페이지가 없습니다.",
    description: "대본은 이 슬라이드에서 계속 작성할 수 있습니다."
  },
  "sync-pending": {
    title: "노트 페이지를 최신 대본과 동기화하는 중입니다.",
    description: "동기화가 끝나면 미리보기가 자동으로 갱신됩니다."
  },
  stale: {
    title: "노트 페이지 미리보기가 최신 대본과 일치하지 않습니다.",
    description: "동기화가 완료된 뒤 다시 확인해 주세요."
  },
  "render-unavailable": {
    title: "노트 페이지 미리보기를 만들 수 없는 환경입니다.",
    description: "발표 대본과 원본 PPTX는 안전하게 보존됩니다."
  },
  unavailable: {
    title: "노트 페이지 미리보기를 사용할 수 없습니다.",
    description: "원본 PPTX와 발표 대본은 그대로 유지됩니다."
  }
};

export function pptxNotesPreviewQueryKey(projectId: string, slideId: string) {
  return ["pptx-notes-preview", projectId, slideId] as const;
}

export function SpeakerNotesPageTab(props: {
  projectId: string;
  slide: Slide | null;
}) {
  const slideId = props.slide?.slideId ?? null;
  const [imageLoadFailed, setImageLoadFailed] = useState(false);
  const previewQuery = useQuery({
    queryKey: pptxNotesPreviewQueryKey(props.projectId, slideId ?? "none"),
    queryFn: () => {
      if (!slideId) throw new Error("Notes preview requires a selected slide");
      return fetchPptxNotesPreview(props.projectId, slideId);
    },
    enabled: Boolean(slideId),
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.status === "sync-pending" ? 2_000 : false
  });

  useEffect(() => {
    setImageLoadFailed(false);
  }, [props.projectId, slideId, previewQuery.data?.assetUrl]);

  return (
    <SpeakerNotesPagePreview
      hasRequestError={previewQuery.isError}
      imageLoadFailed={imageLoadFailed}
      isLoading={Boolean(slideId) && previewQuery.isPending}
      preview={previewQuery.data ?? null}
      slideSelected={Boolean(slideId)}
      onImageError={() => setImageLoadFailed(true)}
      onRetry={() => {
        setImageLoadFailed(false);
        void previewQuery.refetch();
      }}
    />
  );
}

export function SpeakerNotesPagePreview(props: {
  hasRequestError: boolean;
  imageLoadFailed: boolean;
  isLoading: boolean;
  preview: PptxNotesPreview | null;
  slideSelected: boolean;
  onImageError?: () => void;
  onRetry: () => void;
}) {
  let statusContent: { description: string; title: string } | null = null;
  let status = props.preview?.status ?? "unavailable";

  if (!props.slideSelected) {
    status = "unavailable";
    statusContent = {
      title: "슬라이드를 선택해 주세요.",
      description: "선택한 슬라이드의 노트 페이지만 표시합니다."
    };
  } else if (props.isLoading) {
    status = "unavailable";
    statusContent = {
      title: "노트 페이지를 불러오는 중입니다.",
      description: "현재 슬라이드의 보호된 미리보기를 확인하고 있습니다."
    };
  } else if (props.hasRequestError) {
    status = "unavailable";
    statusContent = {
      title: "노트 페이지 상태를 불러오지 못했습니다.",
      description: "잠시 후 다시 시도해 주세요."
    };
  } else if (
    props.preview?.status === "available" &&
    props.preview.assetUrl &&
    !props.imageLoadFailed
  ) {
    return (
      <div
        aria-labelledby="speaker-notes-notes-page-tab"
        className="speaker-notes-feature-panel speaker-notes-page-panel"
        data-status="available"
        id="speaker-notes-notes-page-panel"
        role="tabpanel"
      >
        <div className="speaker-notes-page-heading">
          <strong>노트 페이지 미리보기</strong>
          <span>읽기 전용</span>
        </div>
        <figure className="speaker-notes-page-preview">
          <img
            alt="현재 슬라이드 노트 페이지 미리보기"
            draggable={false}
            loading="eager"
            src={props.preview.assetUrl}
            onError={props.onImageError}
          />
        </figure>
      </div>
    );
  } else if (props.preview?.status === "available" && props.imageLoadFailed) {
    status = "unavailable";
    statusContent = {
      title: "노트 페이지 이미지를 불러오지 못했습니다.",
      description: "보호된 미리보기 연결을 다시 확인해 주세요."
    };
  } else if (props.preview && props.preview.status !== "available") {
    statusContent = unavailablePreviewCopy[props.preview.status];
  } else {
    status = "unavailable";
    statusContent = unavailablePreviewCopy.unavailable;
  }

  const canRetry = props.hasRequestError || props.imageLoadFailed;
  return (
    <div
      aria-labelledby="speaker-notes-notes-page-tab"
      aria-live="polite"
      className="speaker-notes-feature-panel speaker-notes-page-panel"
      data-status={status}
      id="speaker-notes-notes-page-panel"
      role="tabpanel"
    >
      <div className="speaker-notes-page-status" role="status">
        <strong>{statusContent.title}</strong>
        <p>{statusContent.description}</p>
        {canRetry ? (
          <button className="script-panel-action" type="button" onClick={props.onRetry}>
            다시 불러오기
          </button>
        ) : null}
      </div>
    </div>
  );
}
