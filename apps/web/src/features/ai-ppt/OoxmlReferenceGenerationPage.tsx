import type { OoxmlReferenceTemplatePreviewResponse } from "@orbit/shared";
import {
  IconArrowLeft,
  IconCircleCheck,
  IconLoader2,
  IconRefresh,
} from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { OrbitButton } from "../../components/ui";
import { requestOoxmlReferenceTemplatePreview } from "./ooxml-reference-template-api";
import "./ooxml-reference-generation.css";

const pollingIntervalMs = 1_200;
const revealIntervalMs = 260;

type ErrorPresentation = {
  title: string;
  guidance: string;
};

export function OoxmlReferenceGenerationPage(props: {
  jobId: string;
  projectId: string;
}) {
  const [preview, setPreview] =
    useState<OoxmlReferenceTemplatePreviewResponse | null>(null);
  const [requestError, setRequestError] = useState("");
  const [revealedCount, setRevealedCount] = useState(0);
  const [refreshRequest, setRefreshRequest] = useState(0);
  const handoffStarted = useRef(false);

  const refreshSameJob = useCallback(() => {
    setRequestError("");
    setRefreshRequest((value) => value + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    const load = async () => {
      try {
        const next = await requestOoxmlReferenceTemplatePreview(
          props.projectId,
          props.jobId,
        );
        if (cancelled) return;
        setPreview(next);
        setRequestError("");
        if (next.status !== "succeeded" && next.status !== "failed") {
          timer = window.setTimeout(load, pollingIntervalMs);
        }
      } catch (cause) {
        if (cancelled) return;
        setRequestError(
          cause instanceof Error
            ? cause.message
            : "원본 템플릿 생성 상태를 불러오지 못했습니다.",
        );
        timer = window.setTimeout(load, pollingIntervalMs);
      }
    };

    void load();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [props.jobId, props.projectId, refreshRequest]);

  const availableCount = preview?.completedSlides.length ?? 0;
  useEffect(() => {
    if (revealedCount > availableCount) {
      setRevealedCount(availableCount);
      return;
    }
    if (revealedCount >= availableCount) return;
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const nextCount = nextReferenceRevealCount(
      revealedCount,
      availableCount,
      reducedMotion,
    );
    if (reducedMotion) {
      setRevealedCount(nextCount);
      return;
    }
    const timer = window.setTimeout(
      () => setRevealedCount(nextCount),
      revealIntervalMs,
    );
    return () => window.clearTimeout(timer);
  }, [availableCount, revealedCount]);

  useEffect(() => {
    if (
      preview?.status !== "succeeded" ||
      !preview.deckId ||
      revealedCount < preview.completedSlides.length ||
      handoffStarted.current
    ) {
      return;
    }
    handoffStarted.current = true;
    replaceRoute(referenceEditorPath(props.projectId));
  }, [preview, props.projectId, revealedCount]);

  return (
    <OoxmlReferenceGenerationContent
      onRefresh={refreshSameJob}
      onReturn={() => replaceRoute("/createdeck")}
      preview={preview}
      requestError={requestError}
      revealedCount={revealedCount}
    />
  );
}

export function OoxmlReferenceGenerationContent(props: {
  preview: OoxmlReferenceTemplatePreviewResponse | null;
  revealedCount: number;
  requestError: string;
  onRefresh: () => void;
  onReturn: () => void;
}) {
  const failure = props.preview?.error
    ? referenceErrorPresentation(props.preview.error.code)
    : null;
  const outline = props.preview?.outline ?? [];
  const completed = props.preview?.completedSlides.slice(
    0,
    props.revealedCount,
  ) ?? [];
  const completedByOrder = new Map(
    completed.map((slide) => [slide.order, slide]),
  );

  return (
    <main className="ooxml-reference-generation-page">
      <header className="ooxml-reference-generation-header">
        <div>
          <span className="ooxml-reference-generation-eyebrow">
            원본 템플릿 충실도
          </span>
          <h1>원본 레이아웃을 유지하며 만들고 있습니다.</h1>
          <p>완료된 슬라이드부터 순서대로 확인할 수 있습니다.</p>
        </div>
        <div
          aria-label={`생성 진행률 ${props.preview?.progress ?? 0}%`}
          className="ooxml-reference-generation-progress"
          role="status"
        >
          <strong>{props.preview?.progress ?? 0}%</strong>
          <span>{referenceStatusLabel(props.preview?.status)}</span>
        </div>
      </header>

      {props.requestError ? (
        <section className="ooxml-reference-generation-alert" role="alert">
          <div>
            <strong>생성 상태를 확인할 수 없습니다.</strong>
            <p>{props.requestError}</p>
          </div>
          <OrbitButton onClick={props.onRefresh} variant="secondary">
            <IconRefresh aria-hidden="true" size={17} /> 다시 확인
          </OrbitButton>
        </section>
      ) : null}

      {failure && props.preview?.error ? (
        <section className="ooxml-reference-generation-alert" role="alert">
          <div>
            <strong>{failure.title}</strong>
            <p>{failure.guidance}</p>
            <code>{props.preview.error.code}</code>
          </div>
          <div className="ooxml-reference-generation-actions">
            {props.preview.error.retryable ? (
              <OrbitButton onClick={props.onRefresh} variant="secondary">
                <IconRefresh aria-hidden="true" size={17} /> 같은 작업 다시 확인
              </OrbitButton>
            ) : null}
            <OrbitButton onClick={props.onReturn}>
              <IconArrowLeft aria-hidden="true" size={17} /> 입력 화면으로 돌아가기
            </OrbitButton>
          </div>
        </section>
      ) : null}

      <ol
        aria-busy={
          props.preview !== null &&
          props.preview.status !== "succeeded" &&
          props.preview.status !== "failed"
        }
        aria-label="원본 템플릿 슬라이드 생성 현황"
        className="ooxml-reference-generation-grid"
      >
        {outline.map((item) => {
          const completedSlide = completedByOrder.get(item.order);
          return (
            <li key={item.order}>
              <article
                className={
                  completedSlide
                    ? "ooxml-reference-slide-card is-ready"
                    : "ooxml-reference-slide-card is-pending"
                }
              >
                <div className="ooxml-reference-slide-preview">
                  {completedSlide && props.preview ? (
                    <img
                      alt={`${item.order}번 슬라이드 ${item.title}`}
                      src={referencePreviewAssetUrl(
                        props.preview.projectId,
                        completedSlide.renderAssetFileId,
                      )}
                    />
                  ) : (
                    <IconLoader2 aria-hidden="true" size={24} />
                  )}
                </div>
                <div className="ooxml-reference-slide-meta">
                  <span>{item.order}</span>
                  <strong>{item.title}</strong>
                  <small>
                    {completedSlide ? (
                      <>
                        <IconCircleCheck aria-hidden="true" size={15} /> 완료
                      </>
                    ) : (
                      "생성 대기"
                    )}
                  </small>
                </div>
              </article>
            </li>
          );
        })}
      </ol>

      {!props.preview && !props.requestError ? (
        <div className="ooxml-reference-generation-loading" role="status">
          <IconLoader2 aria-hidden="true" size={26} />
          생성 계획을 불러오고 있습니다.
        </div>
      ) : null}
    </main>
  );
}

export function nextReferenceRevealCount(
  revealedCount: number,
  availableCount: number,
  reducedMotion: boolean,
): number {
  if (revealedCount >= availableCount) return availableCount;
  return reducedMotion ? availableCount : Math.min(revealedCount + 1, availableCount);
}

export function referencePreviewAssetUrl(
  projectId: string,
  fileId: string,
): string {
  return `/api/v1/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(fileId)}/content`;
}

export function referenceEditorPath(projectId: string): string {
  return `/project/${encodeURIComponent(projectId)}`;
}

export function referenceErrorPresentation(code: string): ErrorPresentation {
  if (code.includes("IMAGE_ASPECT_RATIO")) {
    return {
      title: "이미지 비율이 원본 슬롯과 맞지 않습니다.",
      guidance: "원본 프레임 비율에 맞는 이미지를 선택한 뒤 다시 시작해 주세요.",
    };
  }
  if (code.includes("CAPACITY_")) {
    return {
      title: "콘텐츠 분량이 원본 슬롯 용량을 넘었습니다.",
      guidance: "문구나 데이터의 양을 줄인 뒤 다시 시작해 주세요.",
    };
  }
  if (
    code.includes("SOURCE_") ||
    code.includes("SOURCE_REQUIRED") ||
    code.includes("TEMPLATE_UNAVAILABLE")
  ) {
    return {
      title: "사용할 수 있는 원본 슬라이드를 찾지 못했습니다.",
      guidance: "발표 내용 또는 선택한 원본 템플릿의 사용 가능 상태를 확인해 주세요.",
    };
  }
  if (code.includes("FONT_")) {
    return {
      title: "원본 글꼴을 사용할 수 없습니다.",
      guidance: "필요한 글꼴 설치와 사용 권한을 확인해 주세요.",
    };
  }
  if (code.includes("PACKAGE_") || code.includes("PUBLICATION_")) {
    return {
      title: "PPTX 패키지를 안전하게 완성하지 못했습니다.",
      guidance: "원본 파일은 변경되지 않았습니다. 상태를 다시 확인하거나 관리자에게 문의해 주세요.",
    };
  }
  if (code.includes("SYNC_")) {
    return {
      title: "편집 내용을 PPTX에 동기화하지 못했습니다.",
      guidance: "최신 동기화 상태를 확인한 뒤 다시 시도해 주세요.",
    };
  }
  if (code.includes("EXPORT_")) {
    return {
      title: "PPTX 내보내기를 완료하지 못했습니다.",
      guidance: "동기화와 패키지 검증 상태를 확인한 뒤 다시 시도해 주세요.",
    };
  }
  return {
    title: "원본 템플릿 생성을 완료하지 못했습니다.",
    guidance: "오류 코드를 관리자에게 전달해 주세요. 다른 생성 방식으로 자동 전환되지는 않습니다.",
  };
}

function referenceStatusLabel(
  status: OoxmlReferenceTemplatePreviewResponse["status"] | undefined,
): string {
  if (status === "planning") return "슬라이드 선택 중";
  if (status === "rendering") return "미리보기 생성 중";
  if (status === "materializing") return "PPTX 검증 중";
  if (status === "succeeded") return "편집기로 이동 중";
  if (status === "failed") return "생성 중단";
  return "준비 중";
}

function replaceRoute(path: string) {
  window.history.replaceState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
