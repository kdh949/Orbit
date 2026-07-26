import {
  aiDeckPreviewResponseSchema,
  type AiDeckPreviewResponse,
  type Deck,
} from "@orbit/shared/deck";

// 다음 슬라이드가 공개될 때까지의 간격
export const aiDeckRevealIntervalMs = 1250;
// 모든 슬라이드가 공개된 후 편집기로 이동하기 전 유지 시간
export const aiDeckFinalSlideHoldMs = 1000;

// 연출 공식
// 전체 시간(ms) = 슬라이드 수 × aiDeckRevealIntervalMs + aiDeckFinalSlideHoldMs

export function aiDeckPreviewDisplayState(
  preview: AiDeckPreviewResponse | null,
  revealedCount: number,
): Pick<AiDeckPreviewResponse, "status" | "progress"> {
  if (!preview) return { status: "planning", progress: 0 };
  const total = preview.deck?.slides.length ?? preview.outline.length;
  if (preview.status !== "ready" || total === 0 || revealedCount >= total) {
    return { status: preview.status, progress: preview.progress };
  }
  const revealedRatio = Math.max(0, Math.min(revealedCount, total)) / total;
  return {
    status: "rendering",
    progress: Math.min(96, Math.round(12 + revealedRatio * 84)),
  };
}

export function aiDeckPlaybackDurationMs(slideCount: number): number {
  return (
    Math.max(0, slideCount) * aiDeckRevealIntervalMs +
    (slideCount > 0 ? aiDeckFinalSlideHoldMs : 0)
  );
}

export function readySlidePrefix(
  deck: Deck | null,
  completedSlideIds: readonly string[],
) {
  if (!deck) return 0;
  const completed = new Set(completedSlideIds);
  let count = 0;
  for (const slide of deck.slides) {
    if (!completed.has(slide.slideId)) break;
    count += 1;
  }
  return count;
}

export function previewBannerText(preview: AiDeckPreviewResponse) {
  const base =
    "현재 화면은 슬라이드 구성 미리보기이며 검증 중 변경될 수 있습니다. Vision QA가 끝나면 편집기로 이동합니다.";
  if (preview.status === "grounding") {
    return `${base} 첨부한 참고자료를 분석하고 있습니다.`;
  }
  if (preview.status === "planning" || preview.status === "composing") {
    return `${base} 발표 목차와 슬라이드 구성을 정리하고 있습니다.`;
  }
  if (preview.status === "rendering") {
    const total = preview.outline.length || preview.expectedSlideCountRange.max;
    return `${base} 총 ${total}장 중 ${preview.completedSlideIds.length}장을 만들었습니다.`;
  }
  if (preview.status === "quality-check") {
    return `${base} 모든 슬라이드를 만들었습니다. 최종 품질을 확인하고 있어 일부 표현이 달라질 수 있습니다.`;
  }
  return base;
}

export async function requestAiDeckPreview(projectId: string, jobId: string) {
  const response = await fetch(
    `/api/v1/projects/${encodeURIComponent(projectId)}/jobs/${encodeURIComponent(jobId)}/deck-preview`,
    { credentials: "include" },
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      payload && typeof payload === "object" && "message" in payload
        ? String(payload.message)
        : "생성 상태를 불러오지 못했습니다.",
    );
  }
  return aiDeckPreviewResponseSchema.parse(payload);
}

export async function retryAiDeckGeneration(projectId: string, jobId: string) {
  const response = await fetch(
    `/api/v1/projects/${encodeURIComponent(projectId)}/jobs/${encodeURIComponent(jobId)}/retry`,
    { method: "POST", credentials: "include" },
  );
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(
      payload && typeof payload === "object" && "message" in payload
        ? String(payload.message)
        : "생성을 다시 시작하지 못했습니다.",
    );
  }
}
