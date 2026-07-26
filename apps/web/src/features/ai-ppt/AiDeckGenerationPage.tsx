import type { AiDeckPreviewResponse, Deck } from "@orbit/shared/deck";
import { useQueryClient } from "@tanstack/react-query";
import { IconArrowLeft, IconLoader2, IconRefresh } from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { OrbitButton } from "../../components/ui";
import { getResponsiveEditorStageScale } from "../editor/shell/utils/editorLayout";
import { ReadOnlySlideCanvas } from "../slides/rendering";
import {
  aiDeckFinalSlideHoldMs,
  aiDeckPreviewDisplayState,
  aiDeckRevealIntervalMs,
  previewBannerText,
  readySlidePrefix,
  requestAiDeckPreview,
  retryAiDeckGeneration,
} from "./ai-deck-preview-api";
import "./ai-deck-generation.css";

const pollingIntervalMs = 1200;

export function AiDeckGenerationPage(props: {
  jobId: string;
  projectId: string;
}) {
  const [preview, setPreview] = useState<AiDeckPreviewResponse | null>(null);
  const [error, setError] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [followLatest, setFollowLatest] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const handoffStarted = useRef(false);
  const queryClient = useQueryClient();
  const availableCount = readySlidePrefix(
    preview?.deck ?? null,
    preview?.completedSlideIds ?? [],
  );
  const [revealedCount, setRevealedCount] = useState(0);

  useEffect(() => {
    if (revealedCount > availableCount) {
      setRevealedCount(availableCount);
      return;
    }
    if (revealedCount >= availableCount) return;
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reducedMotion) {
      setRevealedCount(availableCount);
      return;
    }
    const timer = window.setTimeout(
      () => setRevealedCount((count) => Math.min(count + 1, availableCount)),
      aiDeckRevealIntervalMs,
    );
    return () => window.clearTimeout(timer);
  }, [availableCount, revealedCount]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const next = await requestAiDeckPreview(props.projectId, props.jobId);
        if (cancelled) return;
        setPreview(next);
        setError("");
        if (next.status !== "ready" && next.status !== "cancelled") {
          timer = setTimeout(load, pollingIntervalMs);
        }
      } catch (cause) {
        if (cancelled) return;
        setError(
          cause instanceof Error
            ? cause.message
            : "생성 상태를 불러오지 못했습니다.",
        );
        timer = setTimeout(load, pollingIntervalMs);
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [props.jobId, props.projectId]);

  useEffect(() => {
    if (followLatest && revealedCount > 0) {
      setSelectedIndex(revealedCount - 1);
    }
  }, [followLatest, revealedCount]);

  useEffect(() => {
    const total = preview?.deck?.slides.length ?? preview?.outline.length ?? 0;
    if (
      preview?.status === "ready" &&
      total > 0 &&
      revealedCount >= total &&
      !handoffStarted.current
    ) {
      handoffStarted.current = true;
      const handoff = () => {
        void queryClient
          .invalidateQueries({ queryKey: ["deck", props.projectId] })
          .finally(() =>
            replaceRoute(`/project/${encodeURIComponent(props.projectId)}`),
          );
      };
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        handoff();
        return;
      }
      const timer = window.setTimeout(handoff, aiDeckFinalSlideHoldMs);
      return () => window.clearTimeout(timer);
    }
  }, [preview, props.projectId, queryClient, revealedCount]);

  async function retry() {
    setRetrying(true);
    setError("");
    try {
      await retryAiDeckGeneration(props.projectId, props.jobId);
      setPreview((current) =>
        current ? { ...current, status: "composing", error: null } : current,
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "생성을 다시 시작하지 못했습니다.",
      );
    } finally {
      setRetrying(false);
    }
  }

  const selectedSlide =
    selectedIndex < revealedCount
      ? (preview?.deck?.slides[selectedIndex] ?? null)
      : null;
  const displayState = aiDeckPreviewDisplayState(preview, revealedCount);

  return (
    <section className="ai-deck-generation-page">
      <header className="ai-deck-generation-header">
        <div>
          <span>AI PPT</span>
          <h1>슬라이드를 만들고 있습니다.</h1>
        </div>
        <div className="ai-deck-generation-progress" role="status">
          <strong>{displayState.progress}%</strong>
          <span>{statusLabel(displayState.status)}</span>
        </div>
      </header>

      {preview ? (
        <div className="ai-deck-generation-banner">
          {previewBannerText(preview)}
        </div>
      ) : null}
      {error || preview?.error ? (
        <div className="ai-deck-generation-error" role="alert">
          <span>{error || preview?.error?.message}</span>
          {preview?.error?.retryable ? (
            <OrbitButton disabled={retrying} onClick={() => void retry()}>
              <IconRefresh aria-hidden="true" size={17} />
              다시 시도
            </OrbitButton>
          ) : null}
        </div>
      ) : null}

      <div className="ai-deck-generation-editor">
        <PreviewNavigator
          deck={preview?.deck ?? null}
          expectedSlideCountRange={
            preview?.expectedSlideCountRange ?? { min: 5, max: 8 }
          }
          onSelect={(index) => {
            if (index >= revealedCount) return;
            setSelectedIndex(index);
            if (index < revealedCount - 1) setFollowLatest(false);
          }}
          outline={preview?.outline ?? []}
          revealedCount={revealedCount}
          selectedIndex={selectedIndex}
        />
        <main className="ai-deck-generation-canvas">
          {selectedSlide && preview?.deck ? (
            <FittedSlide deck={preview.deck} slideIndex={selectedIndex} />
          ) : (
            <div className="ai-deck-generation-main-skeleton">
              <IconLoader2 aria-hidden="true" size={30} />
              <strong>
                {revealedCount === 0
                  ? "첫 번째 슬라이드를 구성하고 있습니다."
                  : "다음 슬라이드를 구성하고 있습니다."}
              </strong>
              <span>완료된 슬라이드부터 순서대로 표시합니다.</span>
            </div>
          )}
        </main>
      </div>

      {(preview?.status === "failed" || preview?.status === "cancelled") && (
        <button
          className="ai-deck-generation-back"
          onClick={() =>
            replaceRoute(`/project/${encodeURIComponent(props.projectId)}`)
          }
          type="button"
        >
          <IconArrowLeft aria-hidden="true" size={17} /> 프로젝트로 돌아가기
        </button>
      )}
    </section>
  );
}

function PreviewNavigator(props: {
  deck: Deck | null;
  expectedSlideCountRange: AiDeckPreviewResponse["expectedSlideCountRange"];
  onSelect: (index: number) => void;
  outline: AiDeckPreviewResponse["outline"];
  revealedCount: number;
  selectedIndex: number;
}) {
  const provisional = props.outline.length === 0;
  const items = provisional
    ? Array.from({ length: props.expectedSlideCountRange.max }, (_, index) => ({
        order: index + 1,
        title: "",
        message: "",
      }))
    : props.outline;
  return (
    <aside className="ai-deck-preview-navigator" aria-label="슬라이드 목차">
      <header>
        <strong>슬라이드</strong>
        <span>
          {provisional
            ? `${props.expectedSlideCountRange.min}~${props.expectedSlideCountRange.max}장 예정`
            : `${props.outline.length}장`}
        </span>
      </header>
      <ol>
        {items.map((item, index) => {
          const revealed = index < props.revealedCount;
          const slide = props.deck?.slides[index];
          return (
            <li key={`${item.order}-${item.title || "pending"}`}>
              <button
                aria-current={
                  revealed && index === props.selectedIndex ? "page" : undefined
                }
                className={revealed ? "ready" : "pending"}
                disabled={!revealed}
                onClick={() => props.onSelect(index)}
                type="button"
              >
                <span className="ai-deck-preview-number">{item.order}</span>
                <span className="ai-deck-preview-thumb">
                  {revealed && slide && props.deck ? (
                    <ReadOnlySlideCanvas
                      deck={props.deck}
                      scale={180 / props.deck.canvas.width}
                      slide={slide}
                    />
                  ) : (
                    <span className="ai-deck-preview-skeleton" />
                  )}
                </span>
                <span className="ai-deck-preview-copy">
                  {item.title ? <strong>{item.title}</strong> : null}
                  <small>
                    {revealed
                      ? "생성 완료"
                      : provisional
                        ? index < props.expectedSlideCountRange.min
                          ? "생성 예정"
                          : "구성에 따라 추가"
                        : index === props.revealedCount
                        ? "생성 중"
                        : "생성 예정"}
                  </small>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}

function FittedSlide(props: { deck: Deck; slideIndex: number }) {
  const shell = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const node = shell.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) {
        setSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const scale = useMemo(
    () =>
      getResponsiveEditorStageScale(
        props.deck.canvas.width,
        size.width,
        props.deck.canvas.height,
        size.height,
      ),
    [
      props.deck.canvas.height,
      props.deck.canvas.width,
      size.height,
      size.width,
    ],
  );
  const slide = props.deck.slides[props.slideIndex];
  return (
    <div className="ai-deck-generation-fitted-slide" ref={shell}>
      {slide ? (
        <ReadOnlySlideCanvas deck={props.deck} scale={scale} slide={slide} />
      ) : null}
    </div>
  );
}

function statusLabel(status?: AiDeckPreviewResponse["status"]) {
  if (status === "grounding") return "참고자료 확인 중";
  if (status === "composing") return "슬라이드 구성 중";
  if (status === "rendering") return "슬라이드 렌더링 중";
  if (status === "quality-check") return "최종 품질 확인 중";
  if (status === "ready") return "완료";
  if (status === "failed") return "생성 실패";
  if (status === "cancelled") return "생성 취소";
  return "슬라이드 구성 중";
}

function replaceRoute(path: string) {
  window.history.replaceState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
