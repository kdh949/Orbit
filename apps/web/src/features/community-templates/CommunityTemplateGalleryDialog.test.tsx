import { createDemoDeck, sanitizeCommunityTemplate } from "@orbit/editor-core";
import type { CommunityTemplateCard } from "@orbit/shared/community-templates";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  CommunityTemplateGalleryView,
  reduceCommunityTemplateGalleryFilters,
  type CommunityTemplateGalleryViewProps,
} from "./CommunityTemplateGalleryDialog";

const snapshot = sanitizeCommunityTemplate(createDemoDeck());
const sharedCard: CommunityTemplateCard = {
  templateId: "community_template_shared",
  title: "공통 교육 템플릿",
  category: "education",
  preview: {
    canvas: snapshot.canvas,
    theme: snapshot.theme,
    slide: snapshot.slides[0],
  },
  createdAt: "2026-07-21T00:00:00.000Z",
};

function renderGallery(
  overrides: Partial<CommunityTemplateGalleryViewProps> = {},
) {
  return renderToStaticMarkup(
    <CommunityTemplateGalleryView
      applyingInstanceKey={null}
      applyError={null}
      category={undefined}
      hasMore={false}
      list={{ items: [sharedCard], loading: false, error: null }}
      onApply={vi.fn()}
      onCategoryChange={vi.fn()}
      onClose={vi.fn()}
      onPageChange={vi.fn()}
      onOpenPublish={vi.fn()}
      onResetFilters={vi.fn()}
      onRetryApply={vi.fn()}
      onRetryList={vi.fn()}
      onRetryRecent={vi.fn()}
      onSearchInputChange={vi.fn()}
      open
      page={1}
      publishReturnFocus={false}
      recent={{ items: [sharedCard], loading: false, error: null }}
      searchInput=""
      {...overrides}
    />,
  );
}

describe("CommunityTemplateGalleryDialog", () => {
  it("renders the confirmed modal copy, filters, and recent/all card instances", () => {
    const html = renderGallery();

    expect(html).toContain("커뮤니티 템플릿");
    expect(html).toContain("디자인과 레이아웃을 골라 바로 시작하세요.");
    expect(html).toContain('placeholder="템플릿 검색"');
    expect(html).toContain("최근 사용한 템플릿");
    expect(html).toContain("모든 템플릿");
    expect(html).toContain("카드를 선택하면 바로 시작해요");
    expect(html).toContain(
      'data-template-instance-key="recent:community_template_shared"',
    );
    expect(html).toContain(
      'data-template-instance-key="all:community_template_shared"',
    );
    expect(
      html.match(/aria-label="공통 교육 템플릿 템플릿으로 바로 시작"/g),
    ).toHaveLength(2);
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('data-orbit-dialog-initial="true"');
    expect(html).toContain("내 슬라이드 올리기");
    expect(html).toContain("내 프로젝트의 디자인을 커뮤니티와 공유해 보세요.");
  });

  it("marks only the selected instance as applying and locks dismiss/actions", () => {
    const html = renderGallery({
      applyingInstanceKey: "all:community_template_shared",
    });

    expect(html.match(/템플릿 적용 중/g)).toHaveLength(1);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain(
      'data-template-instance-key="all:community_template_shared" data-applying="true"',
    );
    expect(html).toContain(
      'data-template-instance-key="recent:community_template_shared" data-applying="false"',
    );
    expect(html.match(/disabled=""/g)?.length).toBeGreaterThanOrEqual(3);
    expect(html).toMatch(/community-template-publisher-action[^>]*disabled/);
  });

  it("returns initial focus to the publish CTA after the child dialog closes", () => {
    const html = renderGallery({ publishReturnFocus: true });
    const searchMarkup = html.match(/<input[^>]+type="search"[^>]*>/)?.[0];
    const publishMarkup = html.match(
      /<button[^>]+community-template-publisher-action[^>]*>/,
    )?.[0];

    expect(searchMarkup).not.toContain("data-orbit-dialog-initial");
    expect(publishMarkup).toContain("data-orbit-dialog-initial");
  });

  it("keeps recent templates visible when the all-template query fails", () => {
    const html = renderGallery({
      list: {
        items: [],
        loading: false,
        error: "모든 템플릿을 불러오지 못했습니다.",
      },
    });

    expect(html).toContain("최근 사용한 템플릿");
    expect(html).toContain("공통 교육 템플릿");
    expect(html).toContain("모든 템플릿을 불러오지 못했습니다.");
    expect(html).toContain("다시 시도");
  });

  it("offers a full-template reset for an empty combined search", () => {
    const html = renderGallery({
      category: "education",
      list: { items: [], loading: false, error: null },
      searchInput: "찾을 수 없는 템플릿",
    });

    expect(html).toContain("조건에 맞는 템플릿이 없습니다.");
    expect(html).toContain("전체 템플릿 보기");
  });

  it("resets pagination while combining debounced search and category state", () => {
    const searched = reduceCommunityTemplateGalleryFilters(
      {
        searchInput: "",
        query: "",
        category: "business",
        page: 3,
      },
      { type: "commit-search", query: "  교육 자료  " },
    );
    const categorized = reduceCommunityTemplateGalleryFilters(searched, {
      type: "select-category",
      category: "education",
    });

    expect(categorized).toEqual({
      searchInput: "",
      query: "교육 자료",
      category: "education",
      page: 1,
    });
  });
});
