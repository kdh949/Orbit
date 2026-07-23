import { createDemoDeck } from "@orbit/editor-core";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { AnimationSlideTransitionEditor } from "./AnimationSlideTransitionEditor";

vi.mock("../../../../../rehearsal/presenter/SlideshowRenderer", () => ({
  SlideshowRenderer: () => null
}));

describe("AnimationSlideTransitionEditor", () => {
  it("renders fade duration controls for an editable transition", () => {
    const deck = createDemoDeck();
    const html = renderToString(
      <AnimationSlideTransitionEditor
        deck={deck}
        slide={deck.slides[0]!}
        transition={{ type: "fade", durationMs: 700 }}
        onUpdateMorphKey={vi.fn()}
        onUpdateTransition={vi.fn()}
      />
    );

    expect(html).toContain("슬라이드 전환");
    expect(html).toContain("전환 시간");
    expect(html).toContain("전환 제거");
    expect(html).not.toContain("disabled=\"\"");
  });

  it("disables mutation controls with the fail-closed reason", () => {
    const deck = createDemoDeck();
    const html = renderToString(
      <AnimationSlideTransitionEditor
        deck={deck}
        mutationDisabledReason="원본 OOXML에 안전하게 저장할 수 없습니다."
        slide={deck.slides[0]!}
        onUpdateMorphKey={vi.fn()}
        onUpdateTransition={vi.fn()}
      />
    );

    expect(html).toContain("원본 OOXML에 안전하게 저장할 수 없습니다.");
    expect(html).toContain("disabled=\"\"");
  });

  it("renders morph matching and preview controls", () => {
    const deck = createDemoDeck();
    const previousSlide = deck.slides[0]!;
    const slide = deck.slides[1]!;
    slide.transition = {
      type: "morph",
      durationMs: 1000,
      mode: "object"
    };
    slide.elements[0]!.morphKey = previousSlide.elements[0]!.elementId;
    const html = renderToString(
      <AnimationSlideTransitionEditor
        deck={deck}
        previousSlide={previousSlide}
        selectedElement={slide.elements[0]!}
        slide={slide}
        transition={slide.transition}
        onUpdateMorphKey={vi.fn()}
        onUpdateTransition={vi.fn()}
      />
    );

    expect(html).toContain("모핑");
    expect(html.replaceAll("<!-- -->", "")).toContain("연결된 객체 1개");
    expect(html).toContain("모핑 연결 객체");
    expect(html).toContain("연결 해제");
    expect(html).toContain("모핑 미리보기");
  });

  it("keeps fade available while disabling unsupported morph", () => {
    const deck = createDemoDeck();
    const html = renderToString(
      <AnimationSlideTransitionEditor
        deck={deck}
        morphDisabledReason="가져온 자료에서 모핑을 편집할 수 없습니다."
        slide={deck.slides[0]!}
        onUpdateMorphKey={vi.fn()}
        onUpdateTransition={vi.fn()}
      />
    );

    expect(html).toContain("가져온 자료에서 모핑을 편집할 수 없습니다.");
    expect(html).toContain("<option value=\"fade\">페이드</option>");
    expect(html).toContain("<option disabled=\"\" value=\"morph\">모핑</option>");
  });
});
