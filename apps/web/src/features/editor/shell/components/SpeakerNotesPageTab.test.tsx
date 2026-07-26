import type { PptxNotesPreview } from "@orbit/shared/deck";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  pptxNotesPreviewQueryKey,
  SpeakerNotesPagePreview,
  SpeakerNotesPageTab,
} from "./SpeakerNotesPageTab";

const slide = {
  slideId: "slide_preview_1",
} as never;

function renderTab(preview?: PptxNotesPreview) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  if (preview) {
    queryClient.setQueryData(
      pptxNotesPreviewQueryKey("project_preview_1", "slide_preview_1"),
      preview,
    );
  }

  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <SpeakerNotesPageTab
        projectId="project_preview_1"
        slide={slide}
      />
    </QueryClientProvider>,
  );
}

describe("SpeakerNotesPageTab", () => {
  it("현재 slide별 query key를 분리한다", () => {
    expect(pptxNotesPreviewQueryKey("project_preview_1", "slide_a")).toEqual([
      "pptx-notes-preview",
      "project_preview_1",
      "slide_a",
    ]);
    expect(pptxNotesPreviewQueryKey("project_preview_1", "slide_a")).not.toEqual(
      pptxNotesPreviewQueryKey("project_preview_1", "slide_b"),
    );
  });

  it("available preview를 편집 affordance 없는 현재 slide image로 렌더링한다", () => {
    const html = renderTab({
      slideId: "slide_preview_1",
      status: "available",
      assetUrl:
        "/api/v1/projects/project_preview_1/assets/file_preview_1/content",
    });

    expect(html).toContain('id="speaker-notes-notes-page-panel"');
    expect(html).toContain('role="tabpanel"');
    expect(html).toContain("읽기 전용");
    expect(html).toContain('alt="현재 슬라이드 노트 페이지 미리보기"');
    expect(html).toContain(
      'src="/api/v1/projects/project_preview_1/assets/file_preview_1/content"',
    );
    expect(html).toContain('draggable="false"');
    expect(html).not.toContain("textarea");
    expect(html).not.toContain("메모 편집");
  });

  it.each([
    ["absent", "원본 노트 페이지가 없습니다."],
    ["sync-pending", "노트 페이지를 최신 대본과 동기화하는 중입니다."],
    ["stale", "노트 페이지 미리보기가 최신 대본과 일치하지 않습니다."],
    [
      "render-unavailable",
      "노트 페이지 미리보기를 만들 수 없는 환경입니다.",
    ],
    ["unavailable", "노트 페이지 미리보기를 사용할 수 없습니다."],
  ] as const)("%s 상태를 text로 구분한다", (status, message) => {
    const html = renderTab({
      slideId: "slide_preview_1",
      status,
      assetUrl: null,
    });

    expect(html).toContain(message);
    expect(html).toContain(`data-status="${status}"`);
    expect(html).not.toContain("<img");
  });

  it("loading, request failure, image load failure를 raw error 없이 구분한다", () => {
    expect(renderTab()).toContain("노트 페이지를 불러오는 중입니다.");

    const requestErrorHtml = renderToStaticMarkup(
      <SpeakerNotesPagePreview
        hasRequestError
        imageLoadFailed={false}
        isLoading={false}
        preview={null}
        slideSelected
        onRetry={vi.fn()}
      />,
    );
    expect(requestErrorHtml).toContain("노트 페이지 상태를 불러오지 못했습니다.");
    expect(requestErrorHtml).not.toContain("private storage");

    const imageErrorHtml = renderToStaticMarkup(
      <SpeakerNotesPagePreview
        hasRequestError={false}
        imageLoadFailed
        isLoading={false}
        preview={{
          slideId: "slide_preview_1",
          status: "available",
          assetUrl:
            "/api/v1/projects/project_preview_1/assets/file_preview_1/content",
        }}
        slideSelected
        onRetry={vi.fn()}
      />,
    );
    expect(imageErrorHtml).toContain("노트 페이지 이미지를 불러오지 못했습니다.");
    expect(imageErrorHtml).toContain("다시 불러오기");
    expect(imageErrorHtml).not.toContain("<img");
  });
});
