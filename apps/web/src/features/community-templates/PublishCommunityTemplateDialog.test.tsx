import type { CommunityTemplateSourceProject } from "@orbit/shared/community-templates";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { PublishCommunityTemplateView } from "./PublishCommunityTemplateDialog";
import { communityTemplateKeys } from "./communityTemplateApi";

const source: CommunityTemplateSourceProject = {
  projectId: "project_owner_source",
  title: "매우 긴 원본 프로젝트 제목이 레이아웃을 넘지 않고 안전하게 잘려야 합니다",
  createdAt: "2026-07-20T00:00:00.000Z",
  publishable: true,
  unavailableReason: null,
};

function renderView(
  overrides: Partial<Parameters<typeof PublishCommunityTemplateView>[0]> = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(communityTemplateKeys.categories, {
    items: [{ categoryId: "business", name: "비즈니스" }],
  });
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <PublishCommunityTemplateView
        draft={{
          sourceProjectId: "",
          title: "",
          category: "",
          tags: [],
          rightsConfirmed: false,
        }}
        errors={{}}
        onChange={vi.fn()}
        onClose={vi.fn()}
        onRetrySources={vi.fn()}
        onSubmit={vi.fn()}
        open
        publishError={null}
        sources={{ items: [source], loading: false, error: null }}
        submitting={false}
        {...overrides}
      />
    </QueryClientProvider>,
  );
}

describe("PublishCommunityTemplateDialog", () => {
  it("renders only bounded source metadata and accessible publish fields", () => {
    const html = renderView();

    expect(html).toContain("프로젝트 공유하기");
    expect(html).toContain("공개할 프로젝트");
    expect(html).toContain(
      'aria-labelledby="community-template-publish-source-heading"',
    );
    expect(html).not.toContain("<legend");
    expect(html).toContain(source.title);
    expect(html).toContain("템플릿 이름");
    expect(html).toContain("대표 주제");
    expect(html).toContain(
      "공개 가능한 디자인이며 공유할 권리를 보유하고 있습니다.",
    );
    expect(html).toContain('type="checkbox"');
    expect(html).not.toContain("checked");
    expect(html).not.toContain("speakerNotes");
    expect(html).not.toContain("transcript");
    expect(html).not.toContain("deckSnapshot");
  });

  it("renders loading, empty, and retryable source states", () => {
    expect(
      renderView({
        sources: { items: [], loading: true, error: null },
      }),
    ).toContain("공개 가능한 프로젝트를 불러오는 중");
    expect(
      renderView({
        sources: { items: [], loading: false, error: null },
      }),
    ).toContain("공개할 수 있는 프로젝트가 없습니다.");
    const errorHtml = renderView({
      sources: {
        items: [],
        loading: false,
        error: "공개할 프로젝트를 불러오지 못했습니다.",
      },
    });
    expect(errorHtml).toContain("공개할 프로젝트를 불러오지 못했습니다.");
    expect(errorHtml).toContain("다시 시도");
  });

  it("connects validation messages and locks every field while submitting", () => {
    const html = renderView({
      draft: {
        sourceProjectId: "project_owner_source",
        title: "팀 회고 템플릿",
        category: "business",
        tags: ["팀 회고"],
        rightsConfirmed: true,
      },
      errors: {
        title: "템플릿 이름은 1자 이상 60자 이하로 입력해 주세요.",
        rightsConfirmed: "공개 권리를 확인해 주세요.",
      },
      submitting: true,
    });

    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("등록 중");
    expect(html.match(/disabled=""/g)?.length).toBeGreaterThanOrEqual(5);
  });
});
