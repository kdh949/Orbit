import { createDemoDeck, getElementAnimations, validateSlideAnimations } from "../../../../../../../packages/editor-core/src/index";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { SelectionQuickBar } from "./SelectionQuickBar";
import { useEditorShellUiStore } from "../editorShellUiStore";

describe("SelectionQuickBar", () => {
  it("keeps animation editing out of the visual property controls", () => {
    const deck = createDemoDeck();
    const slide = {
      ...deck.slides[0]!,
      animations: [
        {
          animationId: "anim_inline_1",
          elementId: "el_1",
          type: "appear" as const,
          order: 1,
          durationMs: 400,
          delayMs: 0,
          easing: "ease-out" as const
        }
      ]
    };
    const element = slide.elements.find((candidate) => candidate.elementId === "el_1") ?? null;
    const html = renderToString(
      <SelectionQuickBar
        animations={getElementAnimations(slide, "el_1")}
        animationDiagnostics={validateSlideAnimations(slide, "el_1")}
        canCreateAnimation
        canvas={deck.canvas}
        customShapeEditActive={false}
        element={element}
        selectedKeywordLabel="ORBIT"
        slide={slide}
        theme={deck.theme}
        showIds
        onOpenAnimationEditor={vi.fn()}
        onChangeFrame={vi.fn()}
        onChangeProps={vi.fn()}
        onConvertChartToTable={vi.fn()}
        onChangeSlideStyle={vi.fn()}
        onChangeTheme={vi.fn()}
        onDeleteAnimation={vi.fn()}
        onToggleCustomShapeClosed={vi.fn()}
        onToggleCustomShapeEdit={vi.fn()}
      />
    );

    expect(html).not.toContain("애니메이션 편집");
    expect(html).not.toContain("나타나기");
    expect(html).not.toContain("나타나기 1개가 연결되어 있습니다.");
    expect(html).not.toContain("선택 키워드: ORBIT");
    expect(html).not.toContain("재생");
    expect(html).not.toContain("지연");
    expect(html).not.toContain("잠금");
  });

  it("renders visual actions as compact icon controls", () => {
    const deck = createDemoDeck();
    const slide = deck.slides[0]!;
    const element = slide.elements.find((candidate) => candidate.elementId === "el_1") ?? null;
    const html = renderToString(
      <SelectionQuickBar
        animations={[]}
        animationDiagnostics={validateSlideAnimations(slide, "el_1")}
        canCreateAnimation
        canvas={deck.canvas}
        customShapeEditActive={false}
        element={element}
        selectedKeywordLabel={null}
        slide={slide}
        theme={deck.theme}
        showIds={false}
        onOpenAnimationEditor={vi.fn()}
        onChangeFrame={vi.fn()}
        onChangeProps={vi.fn()}
        onConvertChartToTable={vi.fn()}
        onChangeSlideStyle={vi.fn()}
        onChangeTheme={vi.fn()}
        onDeleteAnimation={vi.fn()}
        onToggleCustomShapeClosed={vi.fn()}
        onToggleCustomShapeEdit={vi.fn()}
      />
    );

    expect(html).toContain('aria-label="텍스트 맞춤 축소"');
    expect(html).toContain("위치");
    expect(html).toContain("레이아웃");
    expect(html).toContain("외형");
    expect(html).toContain('aria-label="왼쪽 정렬"');
    expect(html).toContain('aria-label="오른쪽 정렬"');
    expect(html).toContain('aria-label="위쪽 정렬"');
    expect(html).toContain('aria-label="아래쪽 정렬"');
    expect(html).toContain("불투명도 (%)");
    expect(html).toContain('aria-label="세로 가운데 정렬"');
    expect(html).toContain('aria-label="맨 앞으로 가져오기"');
    expect(html).toContain('aria-label="앞으로 가져오기"');
    expect(html).toContain('aria-label="뒤로 가져오기"');
    expect(html).toContain('aria-label="맨 뒤로 보내기"');
    expect(html).not.toContain("애니메이션 편집");
  });

  it("renders dangling animation cleanup in slide quickbar", () => {
    const deck = createDemoDeck();
    const slide = {
      ...deck.slides[0]!,
      animations: [
        {
          animationId: "anim_dangling_1",
          elementId: "el_missing",
          type: "appear" as const,
          order: 3,
          durationMs: 400,
          delayMs: 0,
          easing: "ease-out" as const
        }
      ]
    };
    const html = renderToString(
      <SelectionQuickBar
        animations={[]}
        animationDiagnostics={validateSlideAnimations(slide)}
        canCreateAnimation={false}
        canvas={deck.canvas}
        customShapeEditActive={false}
        element={null}
        selectedKeywordLabel={null}
        slide={slide}
        theme={deck.theme}
        showIds
        onOpenAnimationEditor={vi.fn()}
        onChangeFrame={vi.fn()}
        onChangeProps={vi.fn()}
        onConvertChartToTable={vi.fn()}
        onChangeSlideStyle={vi.fn()}
        onChangeTheme={vi.fn()}
        onDeleteAnimation={vi.fn()}
        onToggleCustomShapeClosed={vi.fn()}
        onToggleCustomShapeEdit={vi.fn()}
      />
    );

    expect(html).toContain("정리 필요한 애니메이션");
    expect(html).toContain("anim_dangling_1");
  });

  it("renders the crop action and exposes an imported-image disable reason", () => {
    const deck = createDemoDeck();
    const slide = deck.slides[0]!;
    const element = slide.elements.find((candidate) => candidate.type === "image")!;
    const enabledHtml = renderToString(
      <SelectionQuickBar
        animations={[]}
        animationDiagnostics={validateSlideAnimations(slide, element.elementId)}
        canCreateAnimation
        canvas={deck.canvas}
        customShapeEditActive={false}
        element={element}
        imageCropActionState={{ enabled: true, reason: null, visible: true }}
        selectedKeywordLabel={null}
        slide={slide}
        theme={deck.theme}
        showIds={false}
        onOpenAnimationEditor={vi.fn()}
        onChangeFrame={vi.fn()}
        onChangeProps={vi.fn()}
        onConvertChartToTable={vi.fn()}
        onChangeSlideStyle={vi.fn()}
        onChangeTheme={vi.fn()}
        onDeleteAnimation={vi.fn()}
        onStartImageCrop={vi.fn()}
        onToggleCustomShapeClosed={vi.fn()}
        onToggleCustomShapeEdit={vi.fn()}
      />
    );
    const reason = "이 이미지는 원본 PPTX에 안전하게 자르기를 저장할 수 없습니다.";
    const disabledHtml = renderToString(
      <SelectionQuickBar
        animations={[]}
        animationDiagnostics={validateSlideAnimations(slide, element.elementId)}
        canCreateAnimation
        canvas={deck.canvas}
        customShapeEditActive={false}
        element={element}
        imageCropActionState={{ enabled: false, reason, visible: true }}
        selectedKeywordLabel={null}
        slide={slide}
        theme={deck.theme}
        showIds={false}
        onOpenAnimationEditor={vi.fn()}
        onChangeFrame={vi.fn()}
        onChangeProps={vi.fn()}
        onConvertChartToTable={vi.fn()}
        onChangeSlideStyle={vi.fn()}
        onChangeTheme={vi.fn()}
        onDeleteAnimation={vi.fn()}
        onStartImageCrop={vi.fn()}
        onToggleCustomShapeClosed={vi.fn()}
        onToggleCustomShapeEdit={vi.fn()}
      />
    );

    expect(enabledHtml).toContain("자르기");
    expect(enabledHtml).toContain(`id="image-crop-trigger-${element.elementId}"`);
    expect(disabledHtml).toContain("disabled");
    expect(disabledHtml).toContain(reason);
    expect(disabledHtml).toContain("aria-describedby");
  });

  it("replaces raw TSV editing with selected-cell controls", () => {
    const deck = createDemoDeck();
    const slide = deck.slides[0]!;
    const element = {
      elementId: "el_table",
      height: 120,
      locked: false,
      opacity: 1,
      props: {
        borderColor: "#94A3B8",
        borderWidth: 1,
        columnWidths: [120],
        rowHeights: [120],
        rows: [[{
          align: "left" as const,
          borderColor: "#CBD5E1",
          borderWidth: 1,
          colSpan: 1,
          fill: "#FFFFFF",
          fontSize: 18,
          fontWeight: "normal" as const,
          rowSpan: 1,
          text: "A1",
          verticalAlign: "middle" as const
        }]]
      },
      rotation: 0,
      type: "table" as const,
      visible: true,
      width: 120,
      x: 100,
      y: 100,
      zIndex: 1
    };
    useEditorShellUiStore.getState().setActiveTableCell({
      cellEditDisabledReason: null,
      columnIndex: 0,
      elementId: element.elementId,
      rowIndex: 0,
      slideId: slide.slideId
    });

    const html = renderToString(
      <SelectionQuickBar
        animations={[]}
        animationDiagnostics={validateSlideAnimations(slide, element.elementId)}
        canCreateAnimation={false}
        canvas={deck.canvas}
        customShapeEditActive={false}
        element={element}
        selectedKeywordLabel={null}
        slide={slide}
        theme={deck.theme}
        showIds={false}
        onOpenAnimationEditor={vi.fn()}
        onChangeFrame={vi.fn()}
        onChangeProps={vi.fn()}
        onConvertChartToTable={vi.fn()}
        onChangeSlideStyle={vi.fn()}
        onChangeTheme={vi.fn()}
        onDeleteAnimation={vi.fn()}
        onToggleCustomShapeClosed={vi.fn()}
        onToggleCustomShapeEdit={vi.fn()}
      />
    );

    expect(html).not.toContain("표 내용");
    expect(html).not.toContain("행은 줄바꿈");
    expect(html).toContain("셀 편집");
    expect(html).toContain("캔버스에서 편집할 셀을 선택하세요.");
    expect(html).toContain("선두께");
    useEditorShellUiStore.getState().setActiveTableCell(null);
  });
});
