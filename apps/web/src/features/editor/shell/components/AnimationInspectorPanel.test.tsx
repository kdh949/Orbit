import { createDemoDeck, getElementAnimations } from "@orbit/editor-core";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { AnimationInspectorPanel } from "./AnimationInspectorPanel";
import { toAnimationKeywordTriggerOptions } from "./animation";

describe("AnimationInspectorPanel", () => {
  it("renders animation summary cards for the selected element", () => {
    const deck = createDemoDeck();
    const slide = {
      ...deck.slides[0]!,
      animations: [
        {
          animationId: "anim_inline_1",
          elementId: "el_1",
          type: "fade-in" as const,
          order: 10,
          durationMs: 400,
          delayMs: 0,
          easing: "ease-out" as const
        },
        {
          animationId: "anim_inline_2",
          elementId: "el_2",
          type: "fade-out" as const,
          order: 20,
          durationMs: 300,
          delayMs: 100,
          easing: "ease-in" as const
        }
      ]
    };
    const element = slide.elements.find((candidate) => candidate.elementId === "el_1") ?? null;
    const keywordOptions = toAnimationKeywordTriggerOptions(slide.keywords);
    const html = renderToString(
      <AnimationInspectorPanel
        animations={getElementAnimations(slide, "el_1")}
        canCreateAnimation
        element={element}
        keywordOptions={keywordOptions}
        preferredAnimationId={null}
        selectedKeywordId={slide.keywords[0]?.keywordId ?? null}
        selectedKeywordLabel={slide.keywords[0]?.text ?? null}
        selectedKeywordOccurrenceId="kwo_slide_1_kw_1_0_5"
        slideAnimations={slide.animations}
        slideElements={slide.elements}
        onAddAnimation={vi.fn()}
        onDeleteAnimation={vi.fn()}
        onSelectKeyword={vi.fn()}
        onSelectSlideAnimation={vi.fn()}
        showIds
        onUpdateAnimation={vi.fn()}
      />
    );

    expect(html).toContain("연결된 애니메이션");
    expect(html).toContain("1번째");
    expect(html).toContain("새 효과 추가");
    expect(html).toContain("키워드 트리거");
    expect(html).toContain("애니메이션 수정");
    expect(html).toContain("재생 시간");
    expect(html).toContain("애니메이션 제거");
  });

  it("renders slide animation overview when no element is selected", () => {
    const deck = createDemoDeck();
    const slide = {
      ...deck.slides[0]!,
      animations: [
        {
          animationId: "anim_inline_1",
          elementId: "el_1",
          type: "fade-in" as const,
          order: 20,
          durationMs: 400,
          delayMs: 0,
          easing: "ease-out" as const
        },
        {
          animationId: "anim_inline_2",
          elementId: "el_2",
          type: "fade-out" as const,
          order: 10,
          durationMs: 350,
          delayMs: 100,
          easing: "ease-out" as const
        }
      ]
    };
    const keywordOptions = toAnimationKeywordTriggerOptions(slide.keywords);
    const html = renderToString(
      <AnimationInspectorPanel
        animations={[]}
        canCreateAnimation={false}
        element={null}
        keywordOptions={keywordOptions}
        preferredAnimationId={"anim_inline_1"}
        selectedKeywordId={null}
        selectedKeywordLabel={null}
        slideAnimations={slide.animations}
        slideElements={slide.elements}
        onAddAnimation={vi.fn()}
        onDeleteAnimation={vi.fn()}
        onSelectKeyword={vi.fn()}
        onSelectSlideAnimation={vi.fn()}
        showIds={false}
        onUpdateAnimation={vi.fn()}
      />
    );

    expect(html).toContain("이 슬라이드의 애니메이션");
    expect(html).toContain("페이드 인");
    expect(html).toContain("텍스트");
    expect(html).toContain("1번째");
    expect(html).toContain("2번째");
  });

  it("renders an empty property state when the slide has no animations", () => {
    const deck = createDemoDeck();
    const slide = deck.slides[0]!;
    const keywordOptions = toAnimationKeywordTriggerOptions(slide.keywords);
    const html = renderToString(
      <AnimationInspectorPanel
        animations={[]}
        canCreateAnimation={false}
        element={null}
        keywordOptions={keywordOptions}
        preferredAnimationId={null}
        selectedKeywordId={null}
        selectedKeywordLabel={null}
        slideAnimations={[]}
        slideElements={slide.elements}
        onAddAnimation={vi.fn()}
        onDeleteAnimation={vi.fn()}
        onSelectKeyword={vi.fn()}
        onSelectSlideAnimation={vi.fn()}
        showIds={false}
        onUpdateAnimation={vi.fn()}
      />
    );

    expect(html).toContain("애니메이션을 편집할 요소를 선택하세요.");
  });

  it("shows the selected keyword in the create section", () => {
    const deck = createDemoDeck();
    const slide = deck.slides[0]!;
    const element = slide.elements.find((candidate) => candidate.elementId === "el_1") ?? null;
    const keywordOptions = toAnimationKeywordTriggerOptions(slide.keywords);
    const html = renderToString(
      <AnimationInspectorPanel
        animations={[]}
        canCreateAnimation
        element={element}
        keywordOptions={keywordOptions}
        preferredAnimationId={null}
        selectedKeywordId={slide.keywords[0]?.keywordId ?? null}
        selectedKeywordLabel={slide.keywords[0]?.text ?? null}
        selectedKeywordOccurrenceId="kwo_slide_1_kw_1_0_5"
        slideAnimations={slide.animations}
        slideElements={slide.elements}
        onAddAnimation={vi.fn()}
        onDeleteAnimation={vi.fn()}
        onSelectKeyword={vi.fn()}
        onSelectSlideAnimation={vi.fn()}
        showIds={false}
        onUpdateAnimation={vi.fn()}
      />
    );

    expect(html).toContain("키워드 선택됨");
    expect(html).toContain("ORBIT");
  });

  it("protects the root of an action-linked follower chain from edit and deletion", () => {
    const deck = createDemoDeck();
    const slide = {
      ...deck.slides[0]!,
      animations: [
        {
          animationId: "anim_root",
          elementId: "el_1",
          type: "fade-in" as const,
          order: 1,
          startMode: "on-click" as const,
          durationMs: 400,
          delayMs: 0,
          easing: "ease-out" as const
        },
        {
          animationId: "anim_action_follower",
          elementId: "el_2",
          type: "fade-in" as const,
          order: 2,
          startMode: "with-previous" as const,
          durationMs: 400,
          delayMs: 0,
          easing: "ease-out" as const
        }
      ]
    };
    const element = slide.elements.find(({ elementId }) => elementId === "el_1")!;
    const html = renderToString(
      <AnimationInspectorPanel
        actionAnimationIds={["anim_action_follower"]}
        animations={getElementAnimations(slide, element.elementId)}
        canCreateAnimation
        element={element}
        keywordOptions={[]}
        preferredAnimationId="anim_root"
        selectedKeywordId={null}
        selectedKeywordLabel={null}
        slideAnimations={slide.animations}
        slideElements={slide.elements}
        onAddAnimation={vi.fn()}
        onDeleteAnimation={vi.fn()}
        onSelectKeyword={vi.fn()}
        onSelectSlideAnimation={vi.fn()}
        showIds={false}
        onUpdateAnimation={vi.fn()}
      />
    );

    expect(html).toContain("action과 연결된 재생 체인");
    expect(html).toMatch(/<select[^>]*disabled=""/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>애니메이션 제거<\/button>/);
  });

  it("disables effect selection with the slide mutation reason", () => {
    const deck = createDemoDeck();
    const slide = deck.slides[0]!;
    const element = slide.elements.find(({ elementId }) => elementId === "el_1")!;
    const reason = "원본 OOXML을 안전하게 수정할 수 없는 장표입니다.";
    const html = renderToString(
      <AnimationInspectorPanel
        animations={[]}
        canCreateAnimation
        element={element}
        keywordOptions={[]}
        mutationDisabledReason={reason}
        preferredAnimationId={null}
        selectedKeywordId={null}
        selectedKeywordLabel={null}
        slideAnimations={slide.animations}
        slideElements={slide.elements}
        onAddAnimation={vi.fn()}
        onDeleteAnimation={vi.fn()}
        onSelectKeyword={vi.fn()}
        onSelectSlideAnimation={vi.fn()}
        showIds={false}
        onUpdateAnimation={vi.fn()}
      />
    );

    expect(html).toContain(reason);
    const effectButtons =
      html.match(
        /<button class="animation-panel-effect-button[\s\S]*?<\/button>/g
      ) ?? [];
    expect(effectButtons.length).toBeGreaterThan(0);
    for (const button of effectButtons) {
      expect(button).toContain('disabled=""');
      expect(button).toContain(`title="${reason}"`);
      expect(button).toContain(reason);
    }
  });
});
