import { createDemoDeck, sanitizeCommunityTemplate } from "@orbit/editor-core";
import type { CommunityTemplateCard } from "@orbit/shared/community-templates";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { buildCommunityTemplatePreviewDeck } from "./CommunityTemplatePreview";
import { CommunityTemplateShelf } from "./CommunityTemplateShelf";

const snapshot = sanitizeCommunityTemplate(createDemoDeck());

function createCard(index: number): CommunityTemplateCard {
  return {
    templateId: `community_template_shelf_${index}`,
    title: `선반 템플릿 ${index}`,
    category: index % 2 === 0 ? "education" : "business",
    preview: {
      canvas: snapshot.canvas,
      theme: snapshot.theme,
      slide: snapshot.slides[0],
    },
    createdAt: `2026-07-${String(index).padStart(2, "0")}T00:00:00.000Z`,
  };
}

describe("CommunityTemplateShelf", () => {
  it("renders a blank presentation and at most four community cards", () => {
    const html = renderToStaticMarkup(
      <CommunityTemplateShelf
        cards={Array.from({ length: 5 }, (_, index) => createCard(index + 1))}
        error={null}
        isCreatingBlank={false}
        loading={false}
        onCreateBlank={vi.fn()}
        onOpenGallery={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    expect(html).toContain("템플릿으로 시작하기");
    expect(html).toContain('aria-label="빈 프레젠테이션 만들기"');
    expect(html).toContain("전체보기");
    expect(html).toContain("선반 템플릿 1");
    expect(html).toContain("선반 템플릿 4");
    expect(html).not.toContain("선반 템플릿 5");
    expect(html.match(/data-template-shelf-card=/g)).toHaveLength(4);
  });

  it("keeps the blank action available while four previews are loading", () => {
    const html = renderToStaticMarkup(
      <CommunityTemplateShelf
        cards={[]}
        error={null}
        isCreatingBlank={false}
        loading
        onCreateBlank={vi.fn()}
        onOpenGallery={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    expect(html).toContain('aria-label="빈 프레젠테이션 만들기"');
    expect(html.match(/data-template-shelf-skeleton=/g)).toHaveLength(4);
  });

  it("renders a compact retry without replacing the rest of the home", () => {
    const html = renderToStaticMarkup(
      <CommunityTemplateShelf
        cards={[]}
        error="템플릿을 불러오지 못했습니다."
        isCreatingBlank={false}
        loading={false}
        onCreateBlank={vi.fn()}
        onOpenGallery={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain("템플릿 다시 불러오기");
    expect(html).toContain('aria-label="빈 프레젠테이션 만들기"');
  });

  it("builds a valid read-only Deck projection without private source fields", () => {
    const deck = buildCommunityTemplatePreviewDeck(createCard(1));
    const serialized = JSON.stringify(deck);

    expect(deck.slides).toHaveLength(1);
    expect(deck.canvas.aspectRatio).toBe("16:9");
    expect(deck.slides[0]?.speakerNotes).toBe("");
    expect(serialized).not.toContain("sourceProjectId");
    expect(serialized).not.toContain("ownerUserId");
    expect(serialized).not.toContain("snapshot");
  });
});
