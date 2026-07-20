import { createDemoDeck } from "@orbit/editor-core";
import type { SlideQuestionGuide } from "@orbit/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  findCurrentSlideQuestionGuide,
  getAdjacentQuestionId,
  getInitialQuestionId,
  getSuggestedAnswerPreview,
  isSlideQuestionGuideGenerationDisabled,
  OfficialSourceLinks,
  resolveSlideQuestionGuideRuntimeState,
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

  it("기능 비활성화와 runtime config 조회 실패를 구분한다", async () => {
    await expect(resolveSlideQuestionGuideRuntimeState(async () => ({
      slideQuestionGuidesEnabled: false,
    }))).resolves.toBe("disabled");
    await expect(resolveSlideQuestionGuideRuntimeState(async () => {
      throw new Error("runtime config unavailable");
    })).resolves.toBe("unavailable");
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

  it("shows one compact question card with progress, answer summary, and key points", () => {
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
    expect(html).toContain("추천 답변 요약");
    expect(html).toContain("AI 추천");
    expect(html).toContain("전체 답변 보기");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("핵심 포인트");
    expect(html).toContain("disabled");
  });

  it("creates a short preview without losing the full answer source", () => {
    const longAnswer = "첫 번째 문장은 핵심 요약입니다. 두 번째 문장은 자세한 설명을 이어갑니다. ".repeat(4);

    expect(getSuggestedAnswerPreview(longAnswer, 50)).toBe("첫 번째 문장은 핵심 요약입니다.");
    expect(getSuggestedAnswerPreview("짧은 답변입니다.", 50)).toBe("짧은 답변입니다.");
  });

  it("추천 답변 데이터가 없으면 재생성 안내를 표시한다", () => {
    const guide = {
      items: [{
        ...question("question-1", "답변이 없는 예상 질문", ""),
        suggestedAnswer: undefined,
      }],
    } as unknown as SlideQuestionGuide;

    const html = renderToStaticMarkup(
      <SlideQuestionGuideCarousel
        guide={guide}
        selectedQuestionId="question-1"
        onSelect={() => undefined}
      />,
    );

    expect(html).toContain("추천 답변을 불러오지 못했습니다. 다시 생성해 주세요.");
    expect(html).toContain("editor-question-answer-empty");
    expect(html).not.toContain("전체 답변 보기");
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
