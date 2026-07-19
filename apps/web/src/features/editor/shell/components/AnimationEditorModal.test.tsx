import { createDemoDeck, getElementAnimations, validateSlideAnimations } from "../../../../../../../packages/editor-core/src/index";
import { createKeywordOccurrenceId } from "@orbit/shared";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { AnimationEditorModal } from "./AnimationEditorModal";

describe("AnimationEditorModal", () => {
  it("renders fade animation editing controls in modal", () => {
    const deck = createDemoDeck();
    const slide = {
      ...deck.slides[0]!,
      animations: [
        {
          animationId: "anim_modal_1",
          elementId: "el_1",
          type: "fade-in" as const,
          order: 1,
          durationMs: 400,
          delayMs: 0,
          easing: "ease-out" as const
        }
      ]
    };
    const element = slide.elements.find((candidate) => candidate.elementId === "el_1") ?? null;
    const html = renderToString(
      <AnimationEditorModal
        animationDiagnostics={validateSlideAnimations(slide, "el_1")}
        animationTriggerLabels={{ anim_modal_1: "키워드: ORBIT" }}
        animations={getElementAnimations(slide, "el_1")}
        canCreateAnimation
        element={element}
        isOpen
        keywords={slide.keywords}
        notes={slide.speakerNotes}
        selectedKeywordId={slide.keywords[0]?.keywordId ?? null}
        selectedKeywordLabel="ORBIT"
        selectedKeywordOccurrenceKey={createKeywordOccurrenceId(
          slide.slideId,
          "kw_1",
          0,
          5
        )}
        showIds
        slide={slide}
        onAddAnimation={vi.fn()}
        onAssignSelectedKeywordToAnimation={vi.fn()}
        onClose={vi.fn()}
        onDeleteAnimation={vi.fn()}
        onSelectKeyword={vi.fn()}
        onSelectKeywordText={vi.fn()}
        onUpdateAnimation={vi.fn()}
      />
    );

    expect(html).toContain("애니메이션 편집");
    expect(html).toContain("1. 키워드 선택");
    expect(html).toContain("2. 애니메이션 설정");
    expect(html).toContain("ORBIT");
    expect(html).toContain("페이드 인");
    expect(html).toContain("재생");
    expect(html).toContain("지연");
    expect(html).toContain("키워드: ORBIT");
    expect(html).toContain("추가하기");
    expect(html).toContain("선택한 키워드와 현재 설정으로 새 애니메이션이 추가됩니다.");
  });

  it("renders empty state when selected element has no animations", () => {
    const deck = createDemoDeck();
    const slide = deck.slides[0]!;
    const element = slide.elements.find((candidate) => candidate.elementId === "el_1") ?? null;
    const html = renderToString(
      <AnimationEditorModal
        animationDiagnostics={validateSlideAnimations(slide, "el_1")}
        animationTriggerLabels={{}}
        animations={[]}
        canCreateAnimation={false}
        element={element}
        isOpen
        keywords={slide.keywords}
        notes={slide.speakerNotes}
        selectedKeywordId={null}
        selectedKeywordLabel={null}
        showIds={false}
        slide={slide}
        onAddAnimation={vi.fn()}
        onAssignSelectedKeywordToAnimation={vi.fn()}
        onClose={vi.fn()}
        onDeleteAnimation={vi.fn()}
        onSelectKeyword={vi.fn()}
        onSelectKeywordText={vi.fn()}
        onUpdateAnimation={vi.fn()}
      />
    );

    expect(html).toContain("이 요소에 연결된 애니메이션이 없습니다.");
    expect(html).toContain("대본에서 키워드를 선택한 뒤 새 애니메이션을 추가하세요.");
    expect(html).toContain("1번에서 키워드를 먼저 선택하면 2번 설정과 추가하기가 활성화됩니다.");
  });

  it("highlights only the selected keyword occurrence in the script picker", () => {
    const deck = createDemoDeck();
    const slide = {
      ...deck.slides[0]!,
      speakerNotes: "ORBIT 흐름은 ORBIT 대본으로 설명합니다."
    };
    const element = slide.elements.find((candidate) => candidate.elementId === "el_1") ?? null;
    const html = renderToString(
      <AnimationEditorModal
        animationDiagnostics={validateSlideAnimations(slide, "el_1")}
        animationTriggerLabels={{}}
        animations={[]}
        canCreateAnimation
        element={element}
        isOpen
        keywords={slide.keywords}
        notes={slide.speakerNotes}
        selectedKeywordId="kw_1"
        selectedKeywordLabel="ORBIT"
        selectedKeywordOccurrenceKey={createKeywordOccurrenceId(
          "slide_1",
          "kw_1",
          0,
          5
        )}
        showIds={false}
        slide={slide}
        onAddAnimation={vi.fn()}
        onAssignSelectedKeywordToAnimation={vi.fn()}
        onClose={vi.fn()}
        onDeleteAnimation={vi.fn()}
        onSelectKeyword={vi.fn()}
        onSelectKeywordText={vi.fn()}
        onUpdateAnimation={vi.fn()}
      />
    );

    expect(html.match(/class="keyword-mark keyword-tone-required selected"/g)).toHaveLength(1);
    expect(html.match(/class="keyword-note-token keyword-tone-required"/g)).toHaveLength(1);
    expect(html).toContain('data-occurrence-id="kwo_slide_1_kw_1_0_5"');
  });
});
