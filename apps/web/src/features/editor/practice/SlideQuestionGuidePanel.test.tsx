import { createDemoDeck } from "@orbit/editor-core";
import type { SlideQuestionGuide } from "@orbit/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  findCurrentSlideQuestionGuide,
  getAdjacentQuestionId,
  getInitialQuestionId,
  isSlideQuestionGuideGenerationDisabled,
  OfficialSourceLinks,
  SlideQuestionGuidePanel,
  SlideQuestionGuideCarousel,
} from "./SlideQuestionGuidePanel";

const source = {
  kind: "web" as const,
  sourceId: "web:official-1",
  url: "https://example.edu/program",
  title: "공식 교육과정 안내",
  authority: "official" as const,
  contentHash: "b".repeat(64),
  retrievedAt: "2026-07-17T00:00:00.000Z",
};

describe("SlideQuestionGuidePanel official sources", () => {
  it("상단 설명 없이 런타임 설정을 확인한 뒤 질문 생성 액션을 표시한다", () => {
    const deck = createDemoDeck();
    const html = renderToStaticMarkup(
      <SlideQuestionGuidePanel
        autoStatus="idle"
        canGenerate
        deck={deck}
        flushPendingSaves={vi.fn()}
        projectId={deck.projectId}
        refreshToken={0}
        slide={deck.slides[0] ?? null}
      />,
    );

    expect(html).toContain("질문 생성 준비 중…");
    expect(html).toContain("disabled");
    expect(html).toContain("redesign-button-primary");
    expect(html).not.toContain("현재 슬라이드 예상 질문");
    expect(html).not.toContain("검증된 공식 웹사이트에 근거한 질문 3개");
    expect(html).not.toContain("공식 웹 근거를 찾지 못해");
  });

  it("자동 생성 중에는 버튼을 비활성화하고 현재 상태를 표시한다", () => {
    const deck = createDemoDeck();
    const html = renderToStaticMarkup(
      <SlideQuestionGuidePanel
        autoStatus="generating"
        canGenerate
        deck={deck}
        flushPendingSaves={vi.fn()}
        projectId={deck.projectId}
        refreshToken={0}
        slide={deck.slides[0] ?? null}
      />,
    );

    expect(html).toContain("질문 생성 중…");
    expect(html).toContain("disabled");
  });

  it("자동 생성 실패 뒤에는 기존 버튼으로 수동 재시도할 수 있다", () => {
    expect(isSlideQuestionGuideGenerationDisabled({
      autoStatus: "failed",
      canGenerate: true,
      hasSlide: true,
      slideQuestionGuidesEnabled: true,
      status: "idle",
    })).toBe(false);
  });

  it("전체 덱 버전이 달라도 대상 슬라이드 hash가 같으면 현재 guide로 선택한다", () => {
    const matching = {
      deckVersion: 1,
      slideContentHash: "a".repeat(64),
    } as unknown as SlideQuestionGuide;
    const other = {
      deckVersion: 9,
      slideContentHash: "b".repeat(64),
    } as unknown as SlideQuestionGuide;

    expect(findCurrentSlideQuestionGuide([other, matching], "a".repeat(64))).toBe(matching);
    expect(findCurrentSlideQuestionGuide([matching], "b".repeat(64))).toBeNull();
  });

  it("renders a visible, clickable official citation", () => {
    const html = renderToStaticMarkup(<OfficialSourceLinks sources={[source]} />);

    expect(html).toContain("공식 출처");
    expect(html).toContain("공식 교육과정 안내");
    expect(html).toContain('href="https://example.edu/program"');
    expect(html).toContain('target="_blank"');
  });

  it("shows one question and answer with previous and next arrows", () => {
    const guide = {
      items: [
        question("question-1", "첫 번째 예상 질문", "첫 번째 추천 답변"),
        question("question-2", "두 번째 예상 질문", "두 번째 추천 답변"),
        question("question-3", "세 번째 예상 질문", "세 번째 추천 답변"),
      ],
    } as unknown as SlideQuestionGuide;

    const html = renderToStaticMarkup(
      <SlideQuestionGuideCarousel
        guide={guide}
        selectedQuestionId="question-1"
        onSelect={() => undefined}
      />,
    );

    expect(html).toContain("첫 번째 예상 질문");
    expect(html).toContain("첫 번째 추천 답변");
    expect(html).not.toContain("두 번째 예상 질문");
    expect(html).not.toContain("세 번째 예상 질문");
    expect(html).toContain('aria-label="이전 질문"');
    expect(html).toContain('aria-label="다음 질문"');
    expect(html).toContain("1 / 3");
    expect(html).toContain("disabled");
  });

  it("새로 생성한 질문은 첫 번째 질문부터 선택한다", () => {
    const guide = {
      items: [
        question("question-1", "첫 번째 예상 질문", "첫 번째 추천 답변"),
        question("question-2", "두 번째 예상 질문", "두 번째 추천 답변"),
      ],
    } as unknown as SlideQuestionGuide;

    expect(getInitialQuestionId(guide)).toBe("question-1");
    expect(getInitialQuestionId(null)).toBeNull();

    const html = renderToStaticMarkup(
      <SlideQuestionGuideCarousel
        guide={guide}
        selectedQuestionId={getInitialQuestionId(guide)}
        onSelect={() => undefined}
      />,
    );

    expect(html).toContain("첫 번째 예상 질문");
    expect(html).not.toContain("두 번째 예상 질문");
    expect(html).toContain("1 / 2");
  });

  it("moves only to an adjacent question and stops at both ends", () => {
    const guide = {
      items: [
        question("question-1", "첫 번째 예상 질문", "첫 번째 추천 답변"),
        question("question-2", "두 번째 예상 질문", "두 번째 추천 답변"),
        question("question-3", "세 번째 예상 질문", "세 번째 추천 답변"),
      ],
    } as unknown as SlideQuestionGuide;

    expect(getAdjacentQuestionId(guide, "question-1", 1)).toBe("question-2");
    expect(getAdjacentQuestionId(guide, "question-2", -1)).toBe("question-1");
    expect(getAdjacentQuestionId(guide, "question-1", -1)).toBeNull();
    expect(getAdjacentQuestionId(guide, "question-3", 1)).toBeNull();
  });
});

function question(questionId: string, questionText: string, summary: string) {
  return {
    questionId,
    questionText,
    supportState: "grounded",
    keyConcepts: [],
    suggestedAnswer: {
      summary,
      structure: ["핵심 내용을 설명합니다."],
      caveats: [],
    },
    remediation: null,
    sourceRefs: [],
  };
}
